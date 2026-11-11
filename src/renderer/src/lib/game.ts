import { create } from 'zustand'
import { Chess } from 'chess.js'
import type { GameReview, MoveReview, PositionAnalysis, ReviewPreset, Score } from '@shared/types'
import type { LoadedGame } from '@shared/api'
import { api, errorText, onEvent } from './api'
import { useApp } from './store'

export interface VarMove {
  san: string
  uci: string
  color: 'w' | 'b'
  fenBefore: string
  fenAfter: string
}

export interface Variation {
  /** Mainline cursor the variation branches from (0 = start position). */
  basePly: number
  moves: VarMove[]
  cursor: number
}

export interface CurrentMove {
  san: string
  uci: string
  color: 'w' | 'b'
  fenBefore: string
  fenAfter: string
  /** 1-based ply in the game; null inside a variation. */
  ply: number | null
  review: MoveReview | null
}

interface GameState {
  loaded: LoadedGame | null
  cursor: number
  variation: Variation | null
  review: GameReview | null
  reviewProgress: { done: number; total: number } | null
  reviewError: string | null
  live: PositionAnalysis | null
  liveError: string | null
  /** Bumped whenever a position analysis is stored, so dependants re-check the cache. */
  analysisVersion: number
  playerColor: 'w' | 'b'
  orientation: 'white' | 'black'
  load(id: number): Promise<void>
  close(): void
  goto(ply: number): void
  step(delta: number): void
  playMove(from: string, to: string, promotion?: string): boolean
  varGoto(index: number): void
  exitVariation(): void
  startReview(preset: ReviewPreset['id']): Promise<void>
  cancelReview(): void
  setPlayerColor(c: 'w' | 'b'): void
  flip(): void
}

/** Engine results for positions seen in this session, keyed by FEN. Used for variation context. */
const analyses = new Map<string, PositionAnalysis>()
export const analysisFor = (fen: string): PositionAnalysis | null => analyses.get(fen) ?? null

let liveToken = 0
let liveTimer: ReturnType<typeof setTimeout> | null = null

export function currentFen(s: Pick<GameState, 'loaded' | 'cursor' | 'variation'>): string | null {
  if (!s.loaded) return null
  const g = s.loaded.game
  const mainFen = s.cursor === 0 ? g.startFen : g.plies[s.cursor - 1].fenAfter
  if (!s.variation) return mainFen
  return s.variation.cursor === 0 ? mainFen : s.variation.moves[s.variation.cursor - 1].fenAfter
}

export function currentMove(s: Pick<GameState, 'loaded' | 'cursor' | 'variation' | 'review'>): CurrentMove | null {
  if (!s.loaded) return null
  if (s.variation && s.variation.cursor > 0) {
    const m = s.variation.moves[s.variation.cursor - 1]
    return { ...m, ply: null, review: null }
  }
  if (s.cursor === 0) return null
  const p = s.loaded.game.plies[s.cursor - 1]
  return { san: p.san, uci: p.uci, color: p.color, fenBefore: p.fenBefore, fenAfter: p.fenAfter, ply: p.ply, review: s.review?.moves[s.cursor - 1] ?? null }
}

/** Stable key for the position under discussion; ties board, engine output and coach together. */
export function positionKey(s: Pick<GameState, 'loaded' | 'cursor' | 'variation'>): string {
  if (s.variation && s.variation.cursor > 0) return `var:${s.variation.basePly}:${s.variation.moves.slice(0, s.variation.cursor).map((m) => m.uci).join(',')}`
  return `ply:${s.cursor}`
}

/** White-POV evaluation to show for the current position (review first, then live engine). */
export function currentEval(s: GameState): Score | null {
  if (!s.variation && s.review) return s.review.evals[s.cursor] ?? null
  if (s.live?.terminal === 'checkmate') {
    const fen = currentFen(s)
    return { type: 'mate', value: 0, winner: fen?.split(' ')[1] === 'w' ? 'b' : 'w' }
  }
  if (s.live?.terminal) return { type: 'cp', value: 0 }
  return s.live?.lines[0]?.score ?? null
}

function scheduleLive(): void {
  if (liveTimer) clearTimeout(liveTimer)
  const token = ++liveToken
  useGame.setState({ live: null })
  const fen = currentFen(useGame.getState())
  if (!fen) return
  const cached = analyses.get(fen)
  if (cached) useGame.setState({ live: cached })
  // A short delay keeps the engine from thrashing while the user holds an arrow key.
  liveTimer = setTimeout(async () => {
    try {
      const result = await api.analysis.position(fen, token)
      if (token !== liveToken || !result) return
      analyses.set(fen, result)
      useGame.setState((s) => ({ live: result, liveError: null, analysisVersion: s.analysisVersion + 1 }))
    } catch (e) {
      if (token === liveToken) useGame.setState({ liveError: errorText(e) })
    }
  }, 140)
}

export const useGame = create<GameState>((set, get) => ({
  loaded: null,
  cursor: 0,
  variation: null,
  review: null,
  reviewProgress: null,
  reviewError: null,
  live: null,
  liveError: null,
  analysisVersion: 0,
  playerColor: 'w',
  orientation: 'white',

  async load(id) {
    const loaded = await api.games.get(id)
    if (!loaded) throw new Error('That game could not be found.')
    analyses.clear()
    set({ loaded, cursor: 0, variation: null, review: loaded.review, reviewProgress: null, reviewError: null, live: null, liveError: null, playerColor: 'w', orientation: 'white' })
    scheduleLive()
  },

  close() {
    liveToken++
    void api.analysis.stop()
    set({ loaded: null, cursor: 0, variation: null, review: null, reviewProgress: null, live: null })
  },

  goto(ply) {
    const g = get().loaded
    if (!g) return
    const cursor = Math.max(0, Math.min(g.game.plies.length, ply))
    if (cursor === get().cursor && !get().variation) return
    set({ cursor, variation: null })
    scheduleLive()
  },

  step(delta) {
    const s = get()
    if (s.variation) {
      const next = s.variation.cursor + delta
      if (next < 0) return get().exitVariation()
      get().varGoto(Math.min(s.variation.moves.length, next))
      return
    }
    get().goto(s.cursor + delta)
  },

  playMove(from, to, promotion) {
    const s = get()
    const fen = currentFen(s)
    if (!fen || !s.loaded) return false
    const chess = new Chess(fen)
    let m
    try {
      m = chess.move({ from, to, promotion })
    } catch {
      return false
    }
    const uci = m.from + m.to + (m.promotion ?? '')
    // Playing the game move simply advances the game; anything else starts or extends a variation.
    if (!s.variation) {
      const next = s.loaded.game.plies[s.cursor]
      if (next && next.uci === uci) {
        get().goto(s.cursor + 1)
        return true
      }
    }
    const move: VarMove = { san: m.san, uci, color: m.color, fenBefore: fen, fenAfter: chess.fen() }
    const base = s.variation ?? { basePly: s.cursor, moves: [], cursor: 0 }
    const existing = base.moves[base.cursor]
    const moves = existing && existing.uci === uci ? base.moves : [...base.moves.slice(0, base.cursor), move]
    set({ variation: { basePly: base.basePly, moves, cursor: base.cursor + 1 } })
    scheduleLive()
    return true
  },

  varGoto(index) {
    const v = get().variation
    if (!v) return
    set({ variation: { ...v, cursor: Math.max(0, Math.min(v.moves.length, index)) } })
    scheduleLive()
  },

  exitVariation() {
    const v = get().variation
    if (!v) return
    set({ variation: null, cursor: v.basePly })
    scheduleLive()
  },

  async startReview(preset) {
    const g = get().loaded
    if (!g || get().reviewProgress) return
    const id = g.record.id
    set({ reviewProgress: { done: 0, total: g.game.plies.length + 1 }, reviewError: null })
    try {
      const review = await api.review.start(id, preset)
      if (get().loaded?.record.id === id) set({ review, reviewProgress: null })
    } catch (e) {
      const msg = errorText(e)
      if (get().loaded?.record.id === id) set({ reviewProgress: null, reviewError: /cancel/i.test(msg) ? null : msg })
      if (!/cancel/i.test(msg)) useApp.getState().toast('error', msg)
    }
  },

  cancelReview() {
    const g = get().loaded
    if (g) void api.review.cancel(g.record.id)
  },

  setPlayerColor(c) {
    set({ playerColor: c, orientation: c === 'w' ? 'white' : 'black' })
  },
  flip() {
    set((s) => ({ orientation: s.orientation === 'white' ? 'black' : 'white' }))
  }
}))

onEvent('review:progress', (p) => {
  const s = useGame.getState()
  if (s.loaded?.record.id === p.gameId && s.reviewProgress) useGame.setState({ reviewProgress: { done: p.done, total: p.total } })
})

onEvent('analysis:update', ({ token, analysis }) => {
  if (token === liveToken) useGame.setState({ live: analysis, liveError: null })
})
