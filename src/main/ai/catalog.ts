import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { HardwareInfo, InstallStatus, LlmCatalogEntry, Recommendation } from '@shared/types'
import { paths } from '../system/paths'
import { downloadFiles, isDownloading, reportProgress, sha256File } from '../system/download'
import { memoryBudgetGb } from '../system/hardware'

/**
 * Curated local models for the built-in runtime. Sizes and SHA-256 digests are the values
 * published by Hugging Face for these exact files (checked 2026-11); every download is
 * verified against them. Memory figures are estimates (file size plus working memory for an
 * 8k context) and are labelled as estimates in the UI.
 */
const HF = 'https://huggingface.co'
const est = (bytes: number): number => Math.round(((bytes * 1.12) / 1024 ** 3 + 1) * 10) / 10

function entry(id: string, name: string, params: string, repo: string, file: string, sizeBytes: number, sha256: string, notes: string): LlmCatalogEntry {
  return {
    id,
    name,
    family: 'Qwen3.5',
    params,
    quant: 'Q4_K_M',
    license: 'Apache-2.0',
    sizeBytes,
    minMemoryGb: est(sizeBytes),
    contextLength: 0,
    languages: 'Multilingual',
    notes,
    file: { url: `${HF}/${repo}/resolve/main/${file}`, path: file, sizeBytes, sha256 }
  }
}

export const LLM_CATALOG: LlmCatalogEntry[] = [
  entry('qwen3.5-2b-q4', 'Qwen3.5 2B', '2B', 'unsloth/Qwen3.5-2B-GGUF', 'Qwen3.5-2B-Q4_K_M.gguf', 1280835840, 'aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223',
    'Smallest option. Fast on almost any computer; explanations are simpler and it follows personalities less faithfully.'),
  entry('qwen3.5-4b-q4', 'Qwen3.5 4B', '4B', 'unsloth/Qwen3.5-4B-GGUF', 'Qwen3.5-4B-Q4_K_M.gguf', 2740937888, '00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4',
    'Lightweight. A good fit for laptops and computers without a dedicated graphics card.'),
  entry('qwen3.5-9b-q4', 'Qwen3.5 9B', '9B', 'unsloth/Qwen3.5-9B-GGUF', 'Qwen3.5-9B-Q4_K_M.gguf', 5680522464, '03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8',
    'The recommended starting point for chess explanations: clear reasoning and good personality range at a moderate size.'),
  entry('qwen3.5-27b-q4', 'Qwen3.5 27B', '27B', 'unsloth/Qwen3.5-27B-GGUF', 'Qwen3.5-27B-Q4_K_M.gguf', 16740812704, '84b5f7f112156d63836a01a69dc3f11a6ba63b10a23b8ca7a7efaf52d5a2d806',
    'Strongest reasoning in the list, for graphics cards with 24 GB or more. Noticeably slower to start and to answer.')
]

export function llmPath(e: LlmCatalogEntry): string {
  return join(paths.llmModels(), e.file.path)
}

export function llmStatus(hw: HardwareInfo): InstallStatus[] {
  const budget = memoryBudgetGb(hw)
  return LLM_CATALOG.map((e) => {
    const file = llmPath(e)
    const id = `llm:${e.id}`
    if (isDownloading(id)) return { id: e.id, state: 'downloading', sizeBytes: e.sizeBytes }
    if (existsSync(file)) {
      const ok = statSync(file).size === e.sizeBytes
      return { id: e.id, state: ok ? 'installed' : 'broken', sizeBytes: e.sizeBytes, message: ok ? undefined : 'The model file is incomplete. Use Repair to download it again.' }
    }
    if (e.minMemoryGb > Math.max(budget.gb, hw.ramGb - 2)) {
      return { id: e.id, state: 'incompatible', sizeBytes: e.sizeBytes, message: `Needs about ${e.minMemoryGb} GB of memory; this computer has ${budget.gb.toFixed(1)} GB available for a model.` }
    }
    return { id: e.id, state: 'not_installed', sizeBytes: e.sizeBytes }
  })
}

/** Hardware-aware recommendations. Never "the biggest model": the largest one that fits with headroom. */
export function recommendLlm(hw: HardwareInfo): Recommendation[] {
  const budget = memoryBudgetGb(hw)
  const fits = LLM_CATALOG.filter((e) => e.minMemoryGb <= budget.gb * 0.9)
  const where = budget.kind === 'vram' ? `${budget.gb.toFixed(0)} GB of graphics memory` : `about ${budget.gb.toFixed(0)} GB of usable system memory (no supported graphics card detected, so it will run on the processor)`
  const out: Recommendation[] = []
  const byId = (id: string): LlmCatalogEntry => LLM_CATALOG.find((e) => e.id === id)!
  if (fits.length === 0) {
    out.push({ id: LLM_CATALOG[0].id, role: 'Best overall for this computer', reason: `This computer has ${where}. The smallest model is the only realistic choice and may still be slow.` })
    return out
  }
  // Prefer the 9B when it fits; a larger model is only "best overall" when it fits with real headroom.
  const comfortable = fits.filter((e) => e.minMemoryGb <= budget.gb * 0.7)
  const overall = comfortable.includes(byId('qwen3.5-9b-q4')) && !comfortable.includes(byId('qwen3.5-27b-q4')) ? byId('qwen3.5-9b-q4') : (comfortable.at(-1) ?? fits.at(-1)!)
  out.push({ id: overall.id, role: 'Best overall for this computer', reason: `Fits in ${where} with room to spare (needs an estimated ${overall.minMemoryGb} GB). ${overall.notes}` })
  const speed = budget.kind === 'ram' ? (fits.find((e) => e.id === 'qwen3.5-4b-q4') ?? fits[0]) : (fits.find((e) => e.id === 'qwen3.5-9b-q4') ?? fits.at(-1)!)
  out.push({ id: speed.id, role: 'Best balance of speed and quality', reason: budget.kind === 'ram' ? 'Without a graphics card, a 4B model keeps answers arriving at a comfortable pace.' : 'Answers start quickly on a graphics card and the explanations stay solid.' })
  out.push({ id: 'qwen3.5-4b-q4', role: 'Best lightweight model', reason: 'Small download, quick answers, and it leaves memory free for the voice engine.' })
  out.push({ id: 'qwen3.5-2b-q4', role: 'Best for low-memory computers', reason: 'Runs in under 3 GB. Use it when nothing larger fits.' })
  const big = byId('qwen3.5-27b-q4')
  out.push({
    id: big.id,
    role: 'Best for powerful graphics cards',
    reason: fits.includes(big) ? 'Your graphics card can hold it. Expect the most careful explanations and the slowest responses.' : `Needs an estimated ${big.minMemoryGb} GB; not recommended on this computer.`
  })
  return out
}

export async function installLlm(id: string): Promise<void> {
  const e = LLM_CATALOG.find((x) => x.id === id)
  if (!e) throw new Error('Unknown model')
  await downloadFiles(`llm:${e.id}`, e.name, [{ url: e.file.url, dest: llmPath(e), sizeBytes: e.sizeBytes, sha256: e.file.sha256 }])
  reportProgress({ id: `llm:${e.id}`, label: e.name, receivedBytes: e.sizeBytes, totalBytes: e.sizeBytes, phase: 'done', message: `${e.name} is installed` })
}

export function removeLlm(id: string): void {
  const e = LLM_CATALOG.find((x) => x.id === id)
  if (e) rmSync(llmPath(e), { force: true })
}

/** Re-hash an installed model; used by "Repair". Returns true when the file is intact. */
export async function verifyLlm(id: string): Promise<boolean> {
  const e = LLM_CATALOG.find((x) => x.id === id)
  if (!e || !existsSync(llmPath(e))) return false
  return (await sha256File(llmPath(e))) === e.file.sha256
}

/** GGUF files the user dropped into the models folder themselves are usable too. */
export function listLocalGguf(): { id: string; name: string; path: string; sizeBytes: number }[] {
  const dir = paths.llmModels()
  const known = new Map(LLM_CATALOG.map((e) => [e.file.path, e]))
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.gguf'))
    .map((f) => {
      const k = known.get(f)
      const p = join(dir, f)
      return { id: k?.id ?? `file:${f}`, name: k?.name ?? f.replace(/\.gguf$/i, ''), path: p, sizeBytes: statSync(p).size }
    })
    .filter((m) => !known.has(m.path.split(/[\\/]/).pop()!) || known.get(m.path.split(/[\\/]/).pop()!)!.sizeBytes === m.sizeBytes)
}
