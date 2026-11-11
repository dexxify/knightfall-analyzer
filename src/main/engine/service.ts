import type {
  ClassificationThresholds,
  EngineOptions,
  GameReview,
  Ply,
  PositionAnalysis,
  ReviewPreset,
  SearchLimits
} from '@shared/types'
import { buildReview } from '@shared/classify'
import { legalMoveCount } from '@shared/pgn'
import { AnalysisCancelled, EngineError, UciEngine } from './uci'

export interface AnalysisCache {
  get(key: string): PositionAnalysis | null
  set(key: string, value: PositionAnalysis): void
}

export interface ReviewProgress {
  gameId: number
  done: number
  total: number
  /** Ply whose position was just analysed, so the UI can fill the eval graph live. */
  ply: number
}

const cacheKey = (engine: string, fen: string, l: SearchLimits): string =>
  `${engine}|${fen}|d${l.depth ?? 0}|t${l.movetimeMs ?? 0}|pv${l.multipv}`

/**
 * Owns the engine processes. Two engines run side by side so a full-game review in the
 * background never blocks the live analysis of the position the user is looking at.
 */
export class EngineService {
  private reviewEngine: UciEngine | null = null
  private liveEngine: UciEngine | null = null
  private liveAbort: AbortController | null = null
  private reviewAborts = new Map<number, AbortController>()

  constructor(
    private readonly getBinary: () => string | null,
    private readonly getOptions: () => EngineOptions,
    private readonly cache: AnalysisCache
  ) {}

  private async open(kind: 'review' | 'live'): Promise<UciEngine> {
    const existing = kind === 'review' ? this.reviewEngine : this.liveEngine
    if (existing?.running) return existing
    const bin = this.getBinary()
    if (!bin) throw new EngineError('Stockfish is not installed yet. Install it from Settings → Engine.')
    const engine = new UciEngine(bin)
    await engine.start()
    const o = this.getOptions()
    await engine.configure(
      kind === 'review' ? o : { threads: Math.max(1, Math.min(4, Math.floor(o.threads / 2))), hashMb: Math.max(16, Math.floor(o.hashMb / 4)) }
    )
    if (kind === 'review') this.reviewEngine = engine
    else this.liveEngine = engine
    return engine
  }

  /** Apply changed thread/hash settings or a newly installed binary. */
  async restart(): Promise<void> {
    this.cancelAll()
    await Promise.all([this.reviewEngine?.quit(), this.liveEngine?.quit()])
    this.reviewEngine = null
    this.liveEngine = null
  }

  async engineName(): Promise<string> {
    return (await this.open('review')).name
  }

  /** Smoke test used by the "Test Stockfish" button: handshake plus a short real search. */
  async selfTest(): Promise<{ name: string; bestMove: string; depth: number; nps: number; ms: number }> {
    const engine = await this.open('live')
    const started = Date.now()
    const a = await engine.analyze('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', { depth: 14, multipv: 1 })
    if (!a.bestMove) throw new EngineError('The engine returned no move for the starting position')
    return { name: engine.name, bestMove: a.lines[0].pvSan[0] ?? a.bestMove, depth: a.depth, nps: a.lines[0].nps ?? 0, ms: Date.now() - started }
  }

  /** Analyse every position of a game and classify every move. */
  async reviewGame(
    gameId: number,
    plies: Ply[],
    preset: ReviewPreset,
    extra: { inBook?: boolean[]; thresholds?: ClassificationThresholds; onProgress?: (p: ReviewProgress) => void }
  ): Promise<GameReview> {
    this.reviewAborts.get(gameId)?.abort()
    const abort = new AbortController()
    this.reviewAborts.set(gameId, abort)
    try {
      const engine = await this.open('review')
      await engine.newGame()
      const fens = [...plies.map((p) => p.fenBefore), plies[plies.length - 1].fenAfter]
      const limits: SearchLimits = { depth: preset.depth, movetimeMs: preset.movetimeMs, multipv: preset.multipv }
      const analyses: PositionAnalysis[] = []
      for (let i = 0; i < fens.length; i++) {
        if (abort.signal.aborted) throw new AnalysisCancelled()
        const key = cacheKey(engine.name, fens[i], limits)
        let a = this.cache.get(key)
        if (!a) {
          a = await engine.analyze(fens[i], limits, { signal: abort.signal })
          this.cache.set(key, a)
        }
        analyses.push(a)
        extra.onProgress?.({ gameId, done: i + 1, total: fens.length, ply: i })
      }
      return buildReview({
        plies,
        analyses,
        legalMoveCounts: plies.map((p) => legalMoveCount(p.fenBefore)),
        inBook: extra.inBook,
        preset,
        engineName: engine.name,
        thresholds: extra.thresholds
      })
    } finally {
      if (this.reviewAborts.get(gameId) === abort) this.reviewAborts.delete(gameId)
    }
  }

  cancelReview(gameId: number): void {
    this.reviewAborts.get(gameId)?.abort()
  }

  /**
   * Live analysis of a single position (the board the user is looking at, or a variation).
   * Starting a new one cancels the previous one, so results can never arrive out of order.
   */
  async analyzePosition(fen: string, limits: SearchLimits, onUpdate?: (a: PositionAnalysis) => void): Promise<PositionAnalysis | null> {
    this.liveAbort?.abort()
    const abort = new AbortController()
    this.liveAbort = abort
    const engine = await this.open('live')
    const key = cacheKey(engine.name, fen, limits)
    const cached = this.cache.get(key)
    if (cached) return cached
    try {
      const a = await engine.analyze(fen, limits, { signal: abort.signal, onUpdate })
      if (!a.terminal) this.cache.set(key, a)
      return a
    } catch (e) {
      if (e instanceof AnalysisCancelled) return null
      throw e
    }
  }

  stopLive(): void {
    this.liveAbort?.abort()
  }

  cancelAll(): void {
    this.liveAbort?.abort()
    for (const a of this.reviewAborts.values()) a.abort()
  }

  async shutdown(): Promise<void> {
    this.cancelAll()
    await Promise.all([this.reviewEngine?.quit(), this.liveEngine?.quit()])
  }
}
