import { currentMove, positionKey, useGame } from './game'
import { useApp } from './store'

/**
 * Board sounds, synthesised with the Web Audio API. Nothing is sampled or bundled: every
 * sound is generated from short noise bursts and tones, so there are no audio assets to
 * license. They follow the app's volume and mute settings.
 */
export type BoardSound = 'move' | 'capture' | 'check' | 'castle' | 'promote' | 'end'

let ctx: AudioContext | null = null
const audio = (): AudioContext => (ctx ??= new AudioContext())

/** A filtered noise burst: the "wood on wood" part of a piece landing. */
function knock(at: number, gain: number, freq: number, length = 0.07): void {
  const ac = audio()
  const frames = Math.floor(ac.sampleRate * length)
  const buffer = ac.createBuffer(1, frames, ac.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, 3)
  const src = ac.createBufferSource()
  src.buffer = buffer
  const filter = ac.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = freq
  filter.Q.value = 1.4
  const g = ac.createGain()
  g.gain.value = gain
  src.connect(filter).connect(g).connect(ac.destination)
  src.start(at)
}

/** A short decaying tone: the body of the knock, and the notes of check / game over. */
function tone(at: number, gain: number, freq: number, length: number, type: OscillatorType = 'sine', glideTo?: number): void {
  const ac = audio()
  const osc = ac.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(freq, at)
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, at + length)
  const g = ac.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(gain, at + 0.006)
  g.gain.exponentialRampToValueAtTime(0.0001, at + length)
  osc.connect(g).connect(ac.destination)
  osc.start(at)
  osc.stop(at + length + 0.02)
}

export function playSound(kind: BoardSound, volume = 1): void {
  if (volume <= 0) return
  let ac: AudioContext
  try {
    ac = audio()
    if (ac.state === 'suspended') void ac.resume()
  } catch {
    return
  }
  const t = ac.currentTime + 0.005
  const v = Math.min(1, volume)
  switch (kind) {
    case 'move':
      knock(t, 0.55 * v, 1500)
      tone(t, 0.28 * v, 190, 0.09, 'sine', 120)
      break
    case 'capture':
      knock(t, 0.75 * v, 2400, 0.05)
      knock(t + 0.045, 0.6 * v, 1100, 0.09)
      tone(t + 0.045, 0.34 * v, 150, 0.12, 'sine', 90)
      break
    case 'castle':
      knock(t, 0.5 * v, 1500)
      tone(t, 0.25 * v, 190, 0.08, 'sine', 120)
      knock(t + 0.11, 0.5 * v, 1300)
      tone(t + 0.11, 0.25 * v, 170, 0.09, 'sine', 110)
      break
    case 'check':
      knock(t, 0.5 * v, 1700)
      tone(t + 0.02, 0.2 * v, 880, 0.16, 'triangle')
      tone(t + 0.02, 0.12 * v, 1320, 0.14, 'sine')
      break
    case 'promote':
      knock(t, 0.5 * v, 1500)
      tone(t + 0.03, 0.16 * v, 523, 0.12, 'triangle')
      tone(t + 0.11, 0.16 * v, 784, 0.2, 'triangle')
      break
    case 'end':
      knock(t, 0.6 * v, 1300, 0.09)
      tone(t + 0.04, 0.16 * v, 392, 0.5, 'triangle')
      tone(t + 0.04, 0.13 * v, 494, 0.5, 'triangle')
      tone(t + 0.16, 0.15 * v, 587, 0.6, 'triangle')
      break
  }
}

/** Which sound a move makes, from its SAN: mate and check outrank capture and castling. */
export function soundForSan(san: string): BoardSound {
  if (san.endsWith('#')) return 'end'
  if (san.endsWith('+')) return 'check'
  if (san.includes('=')) return 'promote'
  if (san.startsWith('O-O')) return 'castle'
  if (san.includes('x')) return 'capture'
  return 'move'
}

let started = false
export function startBoardSounds(): void {
  if (started) return
  started = true
  let last = ''
  useGame.subscribe((g) => {
    const key = `${g.loaded?.record.id ?? ''}|${positionKey(g)}`
    if (key === last) return
    const opening = last.split('|')[0] !== key.split('|')[0]
    last = key
    const s = useApp.getState().settings
    const move = currentMove(g)
    // No sound for opening a game or jumping back to the start position.
    if (!s?.sounds || s.muted || opening || !move) return
    playSound(soundForSan(move.san), s.volume)
  })
}
