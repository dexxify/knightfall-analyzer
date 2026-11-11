import type { InstallState, TtsEngineId, TtsVoice } from '@shared/types'
import type { CoachProfile } from '@shared/coach'

export interface SynthRequest {
  text: string
  /** Engine-specific voice id; when omitted the coach's assigned voice is used. */
  voice?: string
  speed: number
  coach?: CoachProfile | null
  quality: 'fast' | 'balanced' | 'highest'
}

export interface SynthResult {
  /** Mono float samples in [-1, 1]. */
  samples: Float32Array
  sampleRate: number
}

export interface EngineDescriptor {
  id: TtsEngineId
  name: string
  tier: 'fast' | 'balanced' | 'highest'
  license: string
  description: string
  /** Download size for the given quality mode. */
  sizeBytes(quality: SynthRequest['quality']): number
  minMemoryGb: number
  needsGpu: boolean
}

/** A speech engine. Engines are registered in tts/service.ts; adding one does not touch the UI. */
export interface TtsEngine {
  readonly descriptor: EngineDescriptor
  state(quality: SynthRequest['quality']): { state: InstallState; message?: string }
  install(quality: SynthRequest['quality']): Promise<void>
  remove(): Promise<void>
  voices(): TtsVoice[]
  /** The voice this engine uses for a coach. Must be stable: the same coach always sounds the same. */
  voiceFor(coach: CoachProfile): string
  synthesize(req: SynthRequest): Promise<SynthResult>
  unload(): Promise<void>
}

export class TtsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TtsError'
  }
}

/** Encode mono float samples as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2)
  const v = new DataView(out.buffer)
  const str = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i))
  }
  str(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return out
}
