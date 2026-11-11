import { existsSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { InstallState, TtsVoice } from '@shared/types'
import type { CoachProfile } from '@shared/coach'
import { paths } from '../system/paths'
import { downloadFiles, isDownloading, reportProgress } from '../system/download'
import { TtsError, type EngineDescriptor, type SynthRequest, type SynthResult, type TtsEngine } from './engine'

/**
 * Kokoro-82M (Apache-2.0 code and weights) running in-process on ONNX Runtime.
 * The model is pinned to an exact Hugging Face revision and verified by SHA-256. The voice
 * style vectors ship inside the kokoro-js package, so only the network weights are downloaded.
 */
const REPO = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const REV = '1939ad2a8e416c0acfeecc08a694d14ef25f2231'
const BASE = `https://huggingface.co/${REPO}/resolve/${REV}`

const COMMON = [
  { path: 'config.json', sizeBytes: 44, sha256: 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f' },
  { path: 'tokenizer.json', sizeBytes: 3497, sha256: '77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34' },
  { path: 'tokenizer_config.json', sizeBytes: 113, sha256: 'be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20' }
]
const WEIGHTS = {
  // 8-bit quantised: smallest download.
  fast: { path: 'onnx/model_quantized.onnx', sizeBytes: 92361116, sha256: 'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478', dtype: 'q8' as const },
  // Full-precision weights: the reference quality for this model.
  balanced: { path: 'onnx/model.onnx', sizeBytes: 325532232, sha256: '8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb', dtype: 'fp32' as const }
}
const weightsFor = (q: SynthRequest['quality']): (typeof WEIGHTS)['fast'] | (typeof WEIGHTS)['balanced'] => (q === 'fast' ? WEIGHTS.fast : WEIGHTS.balanced)

const VOICE_NOTES: Record<string, string> = {
  af_heart: 'Warm and reassuring', af_alloy: 'Neutral and even', af_aoede: 'Light and melodic', af_bella: 'Bright and energetic',
  af_jessica: 'Friendly and casual', af_kore: 'Dry and composed', af_nicole: 'Soft, close whisper', af_nova: 'Crisp and confident',
  af_river: 'Relaxed and low', af_sarah: 'Clear and professional', af_sky: 'Young and airy', am_adam: 'Gravelly and forceful',
  am_echo: 'Fast and animated', am_eric: 'Loud and expressive', am_fenrir: 'Deep and cold', am_liam: 'Confident and sharp',
  am_michael: 'Firm and steady', am_onyx: 'Low and flat', am_puck: 'Easygoing and upbeat', am_santa: 'Elderly and warm',
  bf_alice: 'Bright British', bf_emma: 'Crisp British', bf_isabella: 'Thoughtful British', bf_lily: 'Gentle British',
  bm_daniel: 'Articulate British', bm_fable: 'Theatrical British', bm_george: 'Deep, mature British', bm_lewis: 'Dry, observant British'
}

type Kokoro = import('kokoro-js').KokoroTTS

export class KokoroEngine implements TtsEngine {
  readonly descriptor: EngineDescriptor = {
    id: 'kokoro',
    name: 'Kokoro',
    tier: 'balanced',
    license: 'Apache-2.0 (code and weights)',
    description: 'Natural, clear English speech from a small model that runs on any modern processor. 28 distinct voices, so every coach has their own.',
    sizeBytes: (q) => weightsFor(q).sizeBytes + COMMON.reduce((s, f) => s + f.sizeBytes, 0),
    minMemoryGb: 1,
    needsGpu: false
  }
  private tts: Kokoro | null = null
  private loadedDtype = ''
  private queue: Promise<unknown> = Promise.resolve()

  private dir(): string {
    return join(paths.ttsModels(), 'kokoro')
  }
  private repoDir(): string {
    return join(this.dir(), ...REPO.split('/'))
  }

  state(quality: SynthRequest['quality']): { state: InstallState; message?: string } {
    if (isDownloading('tts:kokoro')) return { state: 'downloading' }
    const w = weightsFor(quality)
    const files = [...COMMON, w]
    const present = files.filter((f) => existsSync(join(this.repoDir(), f.path)))
    if (present.length === 0) return { state: 'not_installed' }
    const intact = files.every((f) => existsSync(join(this.repoDir(), f.path)) && statSync(join(this.repoDir(), f.path)).size === f.sizeBytes)
    return intact ? { state: 'installed' } : { state: 'broken', message: 'Some voice model files are missing or incomplete. Use Repair to fix it.' }
  }

  async install(quality: SynthRequest['quality']): Promise<void> {
    const w = weightsFor(quality)
    const total = this.descriptor.sizeBytes(quality)
    await downloadFiles(
      'tts:kokoro',
      'Kokoro voice engine',
      [...COMMON, w].map((f) => ({ url: `${BASE}/${f.path}`, dest: join(this.repoDir(), f.path), sizeBytes: f.sizeBytes, sha256: f.sha256 }))
    )
    await this.unload()
    reportProgress({ id: 'tts:kokoro', label: 'Kokoro voice engine', receivedBytes: total, totalBytes: total, phase: 'done', message: 'Kokoro is installed' })
  }

  async remove(): Promise<void> {
    await this.unload()
    rmSync(this.dir(), { recursive: true, force: true })
  }

  voices(): TtsVoice[] {
    return Object.entries(VOICE_NOTES).map(([id, description]) => ({
      id,
      engine: 'kokoro' as const,
      name: id.slice(3).replace(/^./, (c) => c.toUpperCase()),
      gender: id[1] === 'm' ? ('male' as const) : ('female' as const),
      accent: id[0] === 'b' ? 'British' : 'American',
      description
    }))
  }

  voiceFor(coach: CoachProfile): string {
    return coach.voice.kokoro in VOICE_NOTES ? coach.voice.kokoro : 'af_heart'
  }

  private async load(quality: SynthRequest['quality']): Promise<Kokoro> {
    const w = weightsFor(quality)
    if (this.tts && this.loadedDtype === w.dtype) return this.tts
    if (this.state(quality).state !== 'installed') throw new TtsError('The Kokoro voice engine is not installed. Install it from Settings → Voice.')
    const { env } = await import('@huggingface/transformers')
    // Strictly offline: the runtime may only read the files this app downloaded and verified.
    env.localModelPath = this.dir()
    env.allowRemoteModels = false
    env.allowLocalModels = true
    const { KokoroTTS } = await import('kokoro-js')
    try {
      this.tts = await KokoroTTS.from_pretrained(REPO, { dtype: w.dtype, device: 'cpu' })
      this.loadedDtype = w.dtype
    } catch (e) {
      throw new TtsError(`Kokoro could not be loaded: ${e instanceof Error ? e.message : e}`)
    }
    return this.tts
  }

  synthesize(req: SynthRequest): Promise<SynthResult> {
    const job = async (): Promise<SynthResult> => {
      const tts = await this.load(req.quality)
      const voice = req.voice && req.voice in VOICE_NOTES ? req.voice : req.coach ? this.voiceFor(req.coach) : 'af_heart'
      const speed = Math.max(0.5, Math.min(2, req.speed))
      const audio = await tts.generate(req.text, { voice: voice as never, speed })
      return { samples: audio.audio as Float32Array, sampleRate: audio.sampling_rate }
    }
    const run = this.queue.then(job, job)
    this.queue = run.catch(() => undefined)
    return run
  }

  async unload(): Promise<void> {
    const t = this.tts
    this.tts = null
    this.loadedDtype = ''
    try {
      await (t as unknown as { model?: { dispose?: () => Promise<void> } })?.model?.dispose?.()
    } catch {
      /* already released */
    }
  }
}
