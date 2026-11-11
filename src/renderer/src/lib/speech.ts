import { create } from 'zustand'
import { SentenceStream } from '@shared/coach'
import { api, errorText } from './api'
import { useApp } from './store'

interface SpeechState {
  status: 'idle' | 'loading' | 'playing' | 'paused'
  error: string | null
  canReplay: boolean
}

export const useSpeech = create<SpeechState>(() => ({ status: 'idle', error: null, canReplay: false }))

/**
 * Speech queue. One utterance (a "generation") is active at a time. Starting a new one stops
 * the audio, empties the queue and tells the main process to drop anything still being
 * synthesised for older generations, so speech can never overlap or trail behind the board.
 */
class SpeechPlayer {
  private gen = 0
  private audio = new Audio()
  private queue: string[] = []
  private pendingSynth = 0
  private ended = true
  private chain: Promise<void> = Promise.resolve()
  private clips: string[] = []
  private clipsGen = -1
  private playing = false

  constructor() {
    this.audio.addEventListener('ended', () => {
      this.playing = false
      this.next()
    })
    this.audio.addEventListener('error', () => {
      this.playing = false
      this.next()
    })
    useApp.subscribe((s) => this.applyVolume(s.settings?.volume ?? 1, !!s.settings?.muted))
  }

  private applyVolume(volume: number, muted: boolean): void {
    this.audio.volume = Math.max(0, Math.min(1, volume))
    this.audio.muted = muted
  }

  /** Stop everything and open a new utterance. Returns its generation id. */
  begin(): number {
    this.gen++
    this.audio.pause()
    this.audio.removeAttribute('src')
    this.playing = false
    this.queue = []
    this.pendingSynth = 0
    this.ended = false
    this.chain = Promise.resolve()
    void api.tts.cancelBefore(this.gen)
    useSpeech.setState({ status: 'idle', error: null })
    return this.gen
  }

  get generation(): number {
    return this.gen
  }

  /** Queue one sentence of the given utterance. Sentences are synthesised in order. */
  say(gen: number, text: string, coachId: string | null, voice?: string): void {
    if (gen !== this.gen || !text.trim()) return
    if (this.clipsGen !== gen) {
      for (const u of this.clips) URL.revokeObjectURL(u)
      this.clips = []
      this.clipsGen = gen
      useSpeech.setState({ canReplay: false })
    }
    this.pendingSynth++
    if (!this.playing && this.queue.length === 0) useSpeech.setState({ status: 'loading' })
    this.chain = this.chain.then(async () => {
      if (gen !== this.gen) return
      try {
        const audio = await api.tts.speak({ text, coachId, voice, generation: gen })
        if (gen !== this.gen) return
        if (audio) {
          const url = URL.createObjectURL(new Blob([audio.wav as BlobPart], { type: 'audio/wav' }))
          this.clips.push(url)
          this.queue.push(url)
          useSpeech.setState({ canReplay: true })
        }
      } catch (e) {
        if (gen === this.gen) useSpeech.setState({ error: errorText(e) })
      } finally {
        if (gen === this.gen) {
          this.pendingSynth--
          this.next()
        }
      }
    })
  }

  /** No more sentences will be added to this utterance. */
  end(gen: number): void {
    if (gen !== this.gen) return
    this.ended = true
    this.next()
  }

  private next(): void {
    if (this.playing || useSpeech.getState().status === 'paused') return
    const url = this.queue.shift()
    if (!url) {
      useSpeech.setState({ status: this.pendingSynth > 0 || !this.ended ? (this.pendingSynth > 0 ? 'loading' : 'idle') : 'idle' })
      return
    }
    const s = useApp.getState().settings
    this.applyVolume(s?.volume ?? 1, !!s?.muted)
    this.audio.src = url
    this.playing = true
    useSpeech.setState({ status: 'playing' })
    void this.audio.play().catch(() => {
      this.playing = false
      this.next()
    })
  }

  pause(): void {
    if (useSpeech.getState().status !== 'playing') return
    this.audio.pause()
    useSpeech.setState({ status: 'paused' })
  }

  resume(): void {
    if (useSpeech.getState().status !== 'paused') return
    useSpeech.setState({ status: 'playing' })
    if (this.playing) void this.audio.play()
    else this.next()
  }

  /** Stop speaking and discard what is queued (also used for Skip). */
  stop(): void {
    const keep = this.clips
    const keepGen = this.clipsGen
    this.begin()
    this.ended = true
    // Keep the finished clips so Replay still works after a stop.
    this.clips = keep
    this.clipsGen = keepGen
    useSpeech.setState({ canReplay: keep.length > 0 })
  }

  /** Play the last utterance again from the audio already generated. */
  replay(): void {
    if (this.clips.length === 0) return
    const clips = this.clips
    const g = this.clipsGen
    this.begin()
    this.clips = clips
    this.clipsGen = g
    this.ended = true
    this.queue = [...clips]
    useSpeech.setState({ canReplay: true })
    this.next()
  }

  /** Speak a whole text as one utterance. */
  speakText(text: string, coachId: string | null, voice?: string): number {
    const gen = this.begin()
    const splitter = new SentenceStream()
    for (const s of [...splitter.push(text + ' '), ...splitter.flush()]) this.say(gen, s, coachId, voice)
    this.end(gen)
    return gen
  }
}

export const speech = new SpeechPlayer()
