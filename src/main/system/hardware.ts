import os from 'node:os'
import { statfsSync } from 'node:fs'
import type { HardwareInfo } from '@shared/types'
import { paths } from './paths'

let cached: HardwareInfo | null = null

/**
 * Detect what this computer can run. GPU information comes from the bundled llama.cpp runtime,
 * which probes CUDA / Vulkan / Metal directly, so nothing external (nvidia-smi, drivers tools)
 * has to be installed for detection to work.
 */
export async function detectHardware(force = false): Promise<HardwareInfo> {
  if (cached && !force) return cached
  const cpus = os.cpus()
  let freeDiskGb = 0
  try {
    const s = statfsSync(paths.root())
    freeDiskGb = (s.bavail * s.bsize) / 1024 ** 3
  } catch {
    freeDiskGb = 0
  }
  const info: HardwareInfo = {
    platform: process.platform,
    arch: process.arch,
    cpuModel: cpus[0]?.model.trim() ?? 'Unknown CPU',
    cpuCores: cpus.length,
    ramGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    freeDiskGb: Math.round(freeDiskGb * 10) / 10,
    gpus: [],
    acceleration: ['cpu']
  }
  try {
    const { getLlama } = await import('node-llama-cpp')
    const llama = await getLlama({ gpu: 'auto', build: 'never', progressLogs: false })
    if (llama.gpu) {
      info.acceleration = [llama.gpu as 'cuda' | 'vulkan' | 'metal', 'cpu']
      const names = await llama.getGpuDeviceNames()
      const vram = await llama.getVramState()
      // With an integrated GPU present, the runtime also counts its shared system memory.
      // Only dedicated memory is a realistic budget, so subtract the shared part.
      const unified = (vram as { unifiedSize?: number }).unifiedSize ?? 0
      const dedicated = unified > 0 && unified < vram.total ? vram.total - unified : vram.total
      const total = Math.round((dedicated / 1024 ** 3) * 10) / 10
      info.gpus = names.length ? names.map((name, i) => ({ name, vramGb: i === 0 ? total : null })) : [{ name: 'GPU', vramGb: total }]
    }
  } catch {
    // No usable prebuilt runtime for this machine: the app still works with CPU inference or an external provider.
  }
  cached = info
  return info
}

/** Memory a model may use: dedicated VRAM when there is a GPU, otherwise a share of system RAM. */
export function memoryBudgetGb(hw: HardwareInfo): { gb: number; kind: 'vram' | 'ram' } {
  const vram = hw.gpus[0]?.vramGb ?? 0
  if (hw.acceleration[0] !== 'cpu' && vram >= 3) return { gb: vram, kind: 'vram' }
  return { gb: Math.max(0, hw.ramGb - 4) * 0.6, kind: 'ram' }
}
