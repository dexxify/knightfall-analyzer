import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { unzipSync } from 'fflate'
import type { EngineInfo } from '@shared/types'
import { paths } from '../system/paths'
import { downloadFiles, fetchJson, reportProgress, DownloadError } from '../system/download'
import { identifyEngine } from './uci'

/**
 * Stockfish acquisition. The engine always comes from the official GitHub releases of
 * official-stockfish/Stockfish; the version is whatever "latest stable release" is at the
 * moment the user clicks Install, never a number baked into this file. Every download is
 * checked against the SHA-256 digest GitHub publishes for the release asset before anything
 * is extracted or executed.
 */

const RELEASE_API = 'https://api.github.com/repos/official-stockfish/Stockfish/releases/latest'
const ID = 'stockfish'

interface GithubAsset {
  name: string
  size: number
  digest?: string | null
  browser_download_url: string
}
interface GithubRelease {
  tag_name: string
  name: string
  prerelease: boolean
  draft: boolean
  assets: GithubAsset[]
}

interface Manifest {
  source: 'managed' | 'manual'
  path: string
  tag: string | null
  name: string | null
  version: string | null
  installedAt: string
}

const manifestPath = (): string => join(paths.engines(), 'engine.json')

function readManifest(): Manifest | null {
  try {
    return JSON.parse(readFileSync(manifestPath(), 'utf8')) as Manifest
  } catch {
    return null
  }
}

/** Pick the release asset for this machine. Exported for tests. */
export function pickAsset(assets: { name: string }[], platform: string, arch: string): string | null {
  const names = assets.map((a) => a.name)
  const want = (re: RegExp): string | null => names.find((n) => re.test(n)) ?? null
  if (platform === 'win32') {
    return arch === 'arm64'
      ? want(/windows-arm(v8|64).*\.zip$/)
      : (want(/windows-x86-64-universal\.zip$/) ?? want(/windows-x86-64-avx2\.zip$/) ?? want(/windows-x86-64(-sse41-popcnt)?\.zip$/))
  }
  if (platform === 'darwin') {
    return (
      want(/macos-universal\.tar(\.gz)?$/) ??
      (arch === 'arm64' ? want(/macos-m1.*\.tar(\.gz)?$/) : want(/macos-x86-64.*\.tar(\.gz)?$/))
    )
  }
  if (platform === 'linux') {
    if (arch === 'arm64') return want(/linux-arm64-universal\.tar(\.gz)?$/) ?? want(/linux-armv8.*\.tar(\.gz)?$/) ?? want(/android-armv8.*\.tar(\.gz)?$/)
    return want(/linux-x86-64-universal\.tar(\.gz)?$/) ?? want(/ubuntu-x86-64-avx2\.tar(\.gz)?$/) ?? want(/ubuntu-x86-64.*\.tar(\.gz)?$/)
  }
  return null
}

/** Minimal tar reader (ustar): enough for release archives, with path-traversal protection. */
export function untar(buf: Uint8Array, destDir: string): string[] {
  const written: string[] = []
  const dec = new TextDecoder()
  let off = 0
  let longName: string | null = null
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512)
    if (header.every((b) => b === 0)) break
    const str = (s: number, l: number): string => dec.decode(header.subarray(s, s + l)).replace(/\0.*$/, '')
    let name = str(0, 100)
    const prefix = str(345, 155)
    if (prefix) name = `${prefix}/${name}`
    const size = parseInt(str(124, 12).trim() || '0', 8)
    const mode = parseInt(str(100, 8).trim() || '644', 8)
    const type = String.fromCharCode(header[156] || 48)
    const data = buf.subarray(off + 512, off + 512 + size)
    off += 512 + Math.ceil(size / 512) * 512
    if (type === 'L') {
      longName = dec.decode(data).replace(/\0.*$/, '')
      continue
    }
    if (longName) {
      name = longName
      longName = null
    }
    if (name.split(/[\\/]/).includes('..') || /^([a-zA-Z]:|[\\/])/.test(name)) continue
    const target = join(destDir, name)
    if (type === '5') mkdirSync(target, { recursive: true })
    else if (type === '0' || type === '\0') {
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, data)
      if (process.platform !== 'win32') chmodSync(target, mode & 0o777)
      written.push(target)
    }
  }
  return written
}

function unzipTo(buf: Uint8Array, destDir: string): string[] {
  const written: string[] = []
  const files = unzipSync(buf)
  for (const [name, data] of Object.entries(files)) {
    if (name.split(/[\\/]/).includes('..') || /^([a-zA-Z]:|[\\/])/.test(name)) continue
    const target = join(destDir, name)
    if (name.endsWith('/')) {
      mkdirSync(target, { recursive: true })
      continue
    }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, data)
    written.push(target)
  }
  return written
}

function findBinary(files: string[]): string | null {
  const candidates = files.filter((f) => {
    const base = f.split(/[\\/]/).pop()!.toLowerCase()
    if (!base.startsWith('stockfish')) return false
    if (process.platform === 'win32') return base.endsWith('.exe')
    return !/\.(md|txt|sh|cff|nnue|h|cpp)$/.test(base)
  })
  candidates.sort((a, b) => statSync(b).size - statSync(a).size)
  return candidates[0] ?? null
}

export async function latestRelease(): Promise<{ tag: string; version: string; asset: GithubAsset | null }> {
  const rel = await fetchJson<GithubRelease>(RELEASE_API)
  if (rel.prerelease || rel.draft) throw new DownloadError('The newest Stockfish release is a pre-release; refusing to install a development build.')
  const name = pickAsset(rel.assets, process.platform, process.arch)
  return {
    tag: rel.tag_name,
    version: rel.tag_name.replace(/^sf_/, ''),
    asset: rel.assets.find((a) => a.name === name) ?? null
  }
}

export async function getEngineInfo(checkLatest = false): Promise<EngineInfo> {
  const m = readManifest()
  const info: EngineInfo = {
    installed: !!m && existsSync(m.path),
    path: m?.path ?? null,
    name: m?.name ?? null,
    version: m?.version ?? null,
    source: m?.source ?? null
  }
  if (checkLatest) {
    try {
      const latest = await latestRelease()
      info.latestVersion = latest.version
      info.updateAvailable = info.installed && info.source === 'managed' && m?.tag !== latest.tag
    } catch {
      info.latestVersion = null
    }
  }
  return info
}

export function enginePath(): string | null {
  const m = readManifest()
  return m && existsSync(m.path) ? m.path : null
}

/** Download, verify, extract and smoke-test the latest stable Stockfish for this machine. */
export async function installStockfish(): Promise<EngineInfo> {
  const label = 'Stockfish'
  const latest = await latestRelease()
  if (!latest.asset) {
    throw new DownloadError(
      `Stockfish ${latest.version} has no official build for ${process.platform}/${process.arch}. Use "Choose engine file" to select a UCI engine you already have.`
    )
  }
  const asset = latest.asset
  const sha = asset.digest?.startsWith('sha256:') ? asset.digest.slice(7) : undefined
  if (!sha) throw new DownloadError('GitHub did not publish a checksum for this Stockfish build, so it cannot be verified. Nothing was downloaded.')

  const archive = join(paths.cache(), asset.name)
  await downloadFiles(ID, `${label} ${latest.version}`, [
    { url: asset.browser_download_url, dest: archive, sizeBytes: asset.size, sha256: sha }
  ])

  reportProgress({ id: ID, label, receivedBytes: asset.size, totalBytes: asset.size, phase: 'extracting' })
  const dir = join(paths.engines(), `stockfish-${latest.tag}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  try {
    const buf = readFileSync(archive)
    const files = asset.name.endsWith('.zip') ? unzipTo(buf, dir) : untar(asset.name.endsWith('.gz') ? gunzipSync(buf) : buf, dir)
    const bin = findBinary(files)
    if (!bin) throw new DownloadError('The Stockfish archive did not contain an engine binary.')
    if (process.platform !== 'win32') chmodSync(bin, 0o755)
    const id = await identifyEngine(bin)
    const manifest: Manifest = {
      source: 'managed',
      path: bin,
      tag: latest.tag,
      name: id.name,
      version: id.version ?? latest.version,
      installedAt: new Date().toISOString()
    }
    writeFileSync(manifestPath(), JSON.stringify(manifest, null, 2))
    // Remove older managed versions; the GPL text and source snapshot stay next to the binary.
    for (const d of readdirSync(paths.engines())) {
      if (d.startsWith('stockfish-') && join(paths.engines(), d) !== dir) rmSync(join(paths.engines(), d), { recursive: true, force: true })
    }
    reportProgress({ id: ID, label, receivedBytes: asset.size, totalBytes: asset.size, phase: 'done', message: `${id.name} is ready` })
  } catch (e) {
    rmSync(dir, { recursive: true, force: true })
    const message = e instanceof Error ? e.message : String(e)
    reportProgress({ id: ID, label, receivedBytes: 0, totalBytes: asset.size, phase: 'error', message })
    throw e
  } finally {
    rmSync(archive, { force: true })
  }
  return getEngineInfo()
}

/** Register an engine binary the user picked themselves, after confirming it speaks UCI. */
export async function useManualEngine(file: string): Promise<EngineInfo> {
  if (!existsSync(file) || !statSync(file).isFile()) throw new DownloadError('That file does not exist.')
  let id
  try {
    id = await identifyEngine(file)
  } catch (e) {
    throw new DownloadError(`That file did not respond as a UCI chess engine (${e instanceof Error ? e.message : e}).`)
  }
  const manifest: Manifest = { source: 'manual', path: file, tag: null, name: id.name, version: id.version, installedAt: new Date().toISOString() }
  writeFileSync(manifestPath(), JSON.stringify(manifest, null, 2))
  return getEngineInfo()
}

export function removeEngine(): void {
  const m = readManifest()
  if (m?.source === 'managed') {
    for (const d of readdirSync(paths.engines())) {
      if (d.startsWith('stockfish-')) rmSync(join(paths.engines(), d), { recursive: true, force: true })
    }
  }
  rmSync(manifestPath(), { force: true })
}
