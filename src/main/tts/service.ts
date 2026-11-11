import type { HardwareInfo, Recommendation, TtsAudio, TtsEngineId, TtsEngineInfo, TtsVoice } from '@shared/types'
import type { CoachProfile } from '@shared/coach'
import { textForSpeech } from '@shared/coach'
import { encodeWav, TtsError, type SynthRequest, type TtsEngine } from './engine'
import { KokoroEngine } from './kokoro'
import { memoryBudgetGb } from '../system/hardware'

export interface SpeakRequest {
  text: string
  engine: TtsEngineId
  quality: SynthRequest['quality']
  speed: number
  coach: CoachProfile | null
  voice?: string
  /** Requests carry the generation they belong to; anything older than the newest cancel is dropped. */
  generation: number
}

const BENCH_TEXT = 'Knight to f3 develops a piece and controls the centre. A calm, sensible move that keeps every option open.'

/**
 * Speech synthesis front door. The renderer owns playback (queue, pause, volume); this service
 * owns the engines. Stale requests are discarded here so that audio for a move the user has
 * already left is never produced, let alone played.
 */
export class TtsService {
  private engines = new Map<TtsEngineId, TtsEngine>()
  private cancelledBelow = 0
  private measured = new Map<string, number>()

  constructor(
    private readonly loadMeasured: () => Record<string, number>,
    private readonly saveMeasured: (m: Record<string, number>) => void
  ) {
    this.register(new KokoroEngine())
    for (const [k, v] of Object.entries(this.loadMeasured())) this.measured.set(k, v)
  }

  register(engine: TtsEngine): void {
    this.engines.set(engine.descriptor.id, engine)
  }

  private engine(id: TtsEngineId): TtsEngine {
    const e = this.engines.get(id)
    if (!e) throw new TtsError(`The voice engine "${id}" is not available in this build.`)
    return e
  }

  list(quality: SynthRequest['quality']): TtsEngineInfo[] {
    return [...this.engines.values()].map((e) => {
      const s = e.state(quality)
      const d = e.descriptor
      return {
        id: d.id,
        name: d.name,
        tier: d.tier,
        license: d.license,
        description: d.description,
        sizeBytes: d.sizeBytes(quality),
        minMemoryGb: d.minMemoryGb,
        needsGpu: d.needsGpu,
        state: s.state,
        message: s.message,
        measuredSpeed: this.measured.get(`${d.id}:${quality}`) ?? null
      }
    })
  }

  voices(id: TtsEngineId): TtsVoice[] {
    return this.engine(id).voices()
  }

  voiceFor(id: TtsEngineId, coach: CoachProfile): string {
    return this.engine(id).voiceFor(coach)
  }

  install(id: TtsEngineId, quality: SynthRequest['quality']): Promise<void> {
    return this.engine(id).install(quality)
  }

  remove(id: TtsEngineId): Promise<void> {
    return this.engine(id).remove()
  }

  /** Everything queued or in flight for generations below this one is abandoned. */
  cancelBefore(generation: number): void {
    this.cancelledBelow = Math.max(this.cancelledBelow, generation)
  }

  async speak(req: SpeakRequest): Promise<TtsAudio | null> {
    if (req.generation < this.cancelledBelow) return null
    const text = textForSpeech(req.text)
    if (!text) return null
    const started = Date.now()
    const r = await this.engine(req.engine).synthesize({ text, voice: req.voice, speed: req.speed, coach: req.coach, quality: req.quality })
    if (req.generation < this.cancelledBelow) return null
    const durationSec = r.samples.length / r.sampleRate
    return { wav: encodeWav(r.samples, r.sampleRate), sampleRate: r.sampleRate, durationSec, generationMs: Date.now() - started }
  }

  /** Measure real generation speed on this machine (seconds of audio per second of compute). */
  async benchmark(id: TtsEngineId, quality: SynthRequest['quality']): Promise<number> {
    const e = this.engine(id)
    // First run includes model loading; measure the second.
    await e.synthesize({ text: 'Warm up.', speed: 1, quality })
    const t = Date.now()
    const r = await e.synthesize({ text: BENCH_TEXT, speed: 1, quality })
    const speed = Math.round((r.samples.length / r.sampleRate / ((Date.now() - t) / 1000)) * 10) / 10
    this.measured.set(`${id}:${quality}`, speed)
    this.saveMeasured(Object.fromEntries(this.measured))
    return speed
  }

  /** Suggest an engine and quality mode for this hardware. No speed numbers are claimed here. */
  recommend(hw: HardwareInfo): Recommendation[] {
    const budget = memoryBudgetGb(hw)
    const out: Recommendation[] = []
    const hasQwen = this.engines.has('qwen3')
    const strongGpu = budget.kind === 'vram' && budget.gb >= 8
    if (hasQwen && strongGpu) {
      out.push({ id: 'qwen3:highest', role: 'Highest quality', reason: `Your graphics card has ${budget.gb.toFixed(0)} GB of memory, enough for the most expressive voices. It is a large download.` })
    }
    if (hw.cpuCores >= 8 && hw.ramGb >= 8) {
      out.push({ id: 'kokoro:balanced', role: strongGpu && hasQwen ? 'Balanced' : 'Recommended', reason: 'Full-precision Kokoro: natural speech that runs comfortably on this processor.' })
      out.push({ id: 'kokoro:fast', role: 'Fast', reason: 'The compact Kokoro model: smallest download and lowest memory use.' })
    } else {
      out.push({ id: 'kokoro:fast', role: 'Recommended', reason: 'The compact Kokoro model suits this processor best and uses the least memory.' })
      out.push({ id: 'kokoro:balanced', role: 'Balanced', reason: 'Full-precision Kokoro; may take longer to start speaking on this computer.' })
    }
    return out
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.engines.values()].map((e) => e.unload().catch(() => undefined)))
  }
}
