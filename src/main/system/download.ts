import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { EventEmitter } from 'node:events'
import type { DownloadProgress } from '@shared/types'

/** Every installer in the app reports through this one channel, so the UI has one progress model. */
export const progressBus = new EventEmitter()
progressBus.setMaxListeners(50)

const active = new Map<string, AbortController>()

export function reportProgress(p: DownloadProgress): void {
  progressBus.emit('progress', p)
}

export function cancelDownload(id: string): boolean {
  const c = active.get(id)
  if (!c) return false
  c.abort()
  return true
}

export function isDownloading(id: string): boolean {
  return active.has(id)
}

export class DownloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DownloadError'
  }
}

const ALLOWED_HOSTS = [
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'raw.githubusercontent.com',
  'huggingface.co',
  'astral.sh',
  'pypi.org',
  'files.pythonhosted.org'
]

/** Downloads are only ever made from a short allow-list of hosts, over HTTPS. */
export function assertAllowedUrl(url: string): URL {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new DownloadError(`Not a valid URL: ${url}`)
  }
  if (u.protocol !== 'https:') throw new DownloadError('Only HTTPS downloads are allowed')
  const ok = ALLOWED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h))
  if (!ok) throw new DownloadError(`Downloads from ${u.hostname} are not allowed`)
  return u
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export interface DownloadItem {
  url: string
  dest: string
  sizeBytes?: number
  sha256?: string
}

/**
 * Download one or more files as a single user-visible operation.
 * Files are written to "<dest>.part", hashed while streaming, verified, then renamed, so a
 * half-finished or tampered download can never be mistaken for an installed file.
 */
export async function downloadFiles(id: string, label: string, items: DownloadItem[]): Promise<void> {
  if (active.has(id)) throw new DownloadError(`${label} is already downloading`)
  const controller = new AbortController()
  active.set(id, controller)
  const pending = items.filter((it) => !(existsSync(it.dest) && it.sizeBytes && statSync(it.dest).size === it.sizeBytes && !it.sha256))
  let totalBytes = items.reduce((s, it) => s + (it.sizeBytes ?? 0), 0)
  let receivedBytes = items.filter((it) => !pending.includes(it)).reduce((s, it) => s + (it.sizeBytes ?? 0), 0)
  let lastReport = 0
  const report = (phase: DownloadProgress['phase'], message?: string, force = false): void => {
    const now = Date.now()
    if (!force && now - lastReport < 120) return
    lastReport = now
    reportProgress({ id, label, receivedBytes, totalBytes, phase, message })
  }
  try {
    report('downloading', undefined, true)
    for (const item of pending) {
      assertAllowedUrl(item.url)
      mkdirSync(dirname(item.dest), { recursive: true })
      const part = item.dest + '.part'
      // Resume an interrupted download: keep what is already on disk and ask for the rest.
      const hash = createHash('sha256')
      let have = existsSync(part) ? statSync(part).size : 0
      if (have > 0 && item.sizeBytes && have < item.sizeBytes) {
        for await (const chunk of createReadStream(part)) hash.update(chunk as Buffer)
      } else if (have > 0) {
        rmSync(part, { force: true })
        have = 0
      }
      let res: Response
      try {
        res = await fetch(item.url, {
          signal: controller.signal,
          redirect: 'follow',
          headers: { 'User-Agent': 'chess-review-app', ...(have > 0 ? { Range: `bytes=${have}-` } : {}) }
        })
      } catch (e) {
        if (controller.signal.aborted) throw e
        throw new DownloadError(`Could not reach ${new URL(item.url).hostname}. Check your internet connection and try again.`)
      }
      if (!res.ok || !res.body) throw new DownloadError(`The server answered ${res.status} ${res.statusText} for ${new URL(item.url).pathname.split('/').pop()}`)
      let resumed = have > 0 && res.status === 206
      const fresh = createHash('sha256')
      if (have > 0 && !resumed) have = 0
      const declared = Number(res.headers.get('content-length') ?? 0) + (resumed ? have : 0)
      if (!item.sizeBytes && declared) totalBytes += declared
      const digestOf = resumed ? hash : fresh
      const out = createWriteStream(part, { flags: resumed ? 'a' : 'w' })
      let got = have
      receivedBytes += have
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          digestOf.update(chunk)
          got += chunk.byteLength
          receivedBytes += chunk.byteLength
          if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()))
          report('downloading')
        }
      } finally {
        await new Promise<void>((r) => out.end(() => r()))
      }
      resumed = false
      report('verifying', undefined, true)
      if (item.sizeBytes && got !== item.sizeBytes && declared && got !== declared) {
        rmSync(part, { force: true })
        throw new DownloadError(`Download was incomplete (${got} of ${item.sizeBytes} bytes). Try again.`)
      }
      if (item.sha256) {
        const digest = digestOf.digest('hex')
        if (digest.toLowerCase() !== item.sha256.toLowerCase()) {
          rmSync(part, { force: true })
          throw new DownloadError('The downloaded file failed its integrity check and was deleted. Nothing was installed.')
        }
      }
      rmSync(item.dest, { force: true })
      renameSync(part, item.dest)
    }
  } catch (e) {
    // Partial files are kept so the next attempt can resume; a failed integrity check deletes its own file above.
    if (controller.signal.aborted) {
      report('cancelled', 'Cancelled', true)
      throw new DownloadError('Download cancelled')
    }
    const message = e instanceof Error ? e.message : String(e)
    report('error', message, true)
    throw e instanceof DownloadError ? e : new DownloadError(message)
  } finally {
    active.delete(id)
  }
}

export async function fetchJson<T>(url: string, timeoutMs = 20_000): Promise<T> {
  assertAllowedUrl(url)
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': 'chess-review-app', Accept: 'application/json' }
  })
  if (!res.ok) throw new DownloadError(`${new URL(url).hostname} answered ${res.status} ${res.statusText}`)
  return (await res.json()) as T
}
