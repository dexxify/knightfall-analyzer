import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { EngineLine, EngineOptions, PositionAnalysis, Score, SearchLimits } from '@shared/types'
import { normalizeToWhite } from '@shared/eval'
import { pvToSan, terminalState } from '@shared/pgn'

/**
 * UCI protocol layer. Knows nothing about Electron, the UI, or the AI coach: it takes a path
 * to a UCI engine binary and answers "analyse this FEN".
 */

export interface ParsedInfo {
  depth: number
  seldepth?: number
  multipv: number
  /** Side-to-move point of view, exactly as the engine printed it. */
  score: Score
  bound?: 'upper' | 'lower'
  wdl?: [number, number, number]
  nodes?: number
  nps?: number
  pv: string[]
}

/** Parse one "info ..." line. Returns null for lines without a score + pv (currmove, strings). */
export function parseInfoLine(line: string): ParsedInfo | null {
  if (!line.startsWith('info ')) return null
  const t = line.trim().split(/\s+/)
  let depth = 0
  let seldepth: number | undefined
  let multipv = 1
  let score: Score | null = null
  let bound: 'upper' | 'lower' | undefined
  let wdl: [number, number, number] | undefined
  let nodes: number | undefined
  let nps: number | undefined
  let pv: string[] = []
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'depth':
        depth = Number(t[++i])
        break
      case 'seldepth':
        seldepth = Number(t[++i])
        break
      case 'multipv':
        multipv = Number(t[++i])
        break
      case 'score': {
        const kind = t[++i]
        const value = Number(t[++i])
        if ((kind === 'cp' || kind === 'mate') && Number.isFinite(value)) score = { type: kind, value }
        if (t[i + 1] === 'upperbound') (bound = 'upper'), i++
        else if (t[i + 1] === 'lowerbound') (bound = 'lower'), i++
        break
      }
      case 'wdl':
        wdl = [Number(t[i + 1]), Number(t[i + 2]), Number(t[i + 3])]
        i += 3
        break
      case 'nodes':
        nodes = Number(t[++i])
        break
      case 'nps':
        nps = Number(t[++i])
        break
      case 'pv':
        pv = t.slice(i + 1)
        i = t.length
        break
      case 'string':
        return null
      default:
        break
    }
  }
  if (!score || pv.length === 0 || !Number.isFinite(depth)) return null
  return { depth, seldepth, multipv, score, bound, wdl, nodes, nps, pv }
}

export function parseBestMove(line: string): string | null | undefined {
  if (!line.startsWith('bestmove')) return undefined
  const mv = line.split(/\s+/)[1]
  return !mv || mv === '(none)' ? null : mv
}

const FEN_RE = /^[1-8pnbrqkPNBRQK/]+ [wb] (-|[KQkqA-Ha-h]{1,4}) (-|[a-h][36]) \d+ \d+$/

export class EngineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EngineError'
  }
}

export class AnalysisCancelled extends Error {
  constructor() {
    super('Analysis cancelled')
    this.name = 'AnalysisCancelled'
  }
}

type LineHandler = (line: string) => void

export class UciEngine {
  private proc: ChildProcessWithoutNullStreams | null = null
  private handlers = new Set<LineHandler>()
  private queue: Promise<unknown> = Promise.resolve()
  private exited = false
  private lastError = ''
  name = ''
  author = ''
  options = new Map<string, string>()

  constructor(private readonly binaryPath: string) {}

  get running(): boolean {
    return !!this.proc && !this.exited
  }

  /** Launch the engine and complete the "uci" / "uciok" handshake. */
  async start(timeoutMs = 15_000): Promise<void> {
    if (this.running) return
    this.exited = false
    let proc: ChildProcessWithoutNullStreams
    try {
      // No shell: the path is passed as argv[0] verbatim, so nothing in it can be interpreted.
      proc = spawn(this.binaryPath, [], { stdio: 'pipe', windowsHide: true })
    } catch (e) {
      throw new EngineError(`Could not start the engine: ${e instanceof Error ? e.message : String(e)}`)
    }
    this.proc = proc
    proc.on('error', (e) => {
      this.lastError = e.message
      this.exited = true
      this.emit('__exit__')
    })
    proc.on('exit', (code, signal) => {
      this.exited = true
      if (code && code !== 0) this.lastError = `engine exited with code ${code}`
      if (signal) this.lastError = `engine was terminated (${signal})`
      this.emit('__exit__')
    })
    proc.stdin.on('error', () => undefined)
    createInterface({ input: proc.stdout }).on('line', (l) => this.emit(l.trim()))
    createInterface({ input: proc.stderr }).on('line', (l) => (this.lastError = l.trim() || this.lastError))

    await this.waitFor(
      (line) => {
        if (line.startsWith('id name ')) this.name = line.slice(8).trim()
        else if (line.startsWith('id author ')) this.author = line.slice(10).trim()
        else if (line.startsWith('option name ')) {
          const m = /^option name (.+?) type (\S+)/.exec(line)
          if (m) this.options.set(m[1], m[2])
        }
        return line === 'uciok'
      },
      timeoutMs,
      'The engine did not answer the UCI handshake',
      () => this.send('uci')
    )
    if (this.options.has('UCI_ShowWDL')) this.send('setoption name UCI_ShowWDL value true')
    await this.ready()
  }

  private emit(line: string): void {
    for (const h of [...this.handlers]) h(line)
  }

  private send(cmd: string): void {
    if (!this.proc || this.exited) throw new EngineError(`The engine is not running${this.lastError ? `: ${this.lastError}` : ''}`)
    this.proc.stdin.write(cmd + '\n')
  }

  private waitFor(pred: (line: string) => boolean, timeoutMs: number, what: string, kickoff?: () => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const done = (err?: Error): void => {
        clearTimeout(timer)
        this.handlers.delete(handler)
        if (err) reject(err)
        else resolve()
      }
      const handler: LineHandler = (line) => {
        if (line === '__exit__') return done(new EngineError(`The engine stopped unexpectedly${this.lastError ? `: ${this.lastError}` : ''}`))
        try {
          if (pred(line)) done()
        } catch (e) {
          done(e as Error)
        }
      }
      const timer = setTimeout(() => done(new EngineError(`${what} within ${Math.round(timeoutMs / 1000)}s`)), timeoutMs)
      this.handlers.add(handler)
      try {
        kickoff?.()
      } catch (e) {
        done(e as Error)
      }
    })
  }

  ready(timeoutMs = 30_000): Promise<void> {
    return this.waitFor((l) => l === 'readyok', timeoutMs, 'The engine did not become ready', () => this.send('isready'))
  }

  async configure(opts: EngineOptions): Promise<void> {
    await this.enqueue(async () => {
      if (this.options.has('Threads')) this.send(`setoption name Threads value ${Math.max(1, Math.floor(opts.threads))}`)
      if (this.options.has('Hash')) this.send(`setoption name Hash value ${Math.max(16, Math.floor(opts.hashMb))}`)
      await this.ready()
    })
  }

  async newGame(): Promise<void> {
    await this.enqueue(async () => {
      this.send('ucinewgame')
      await this.ready()
    })
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job)
    this.queue = run.catch(() => undefined)
    return run
  }

  /**
   * Analyse a position. Scores in the result are from White's point of view.
   * Aborting the signal stops the search and rejects with AnalysisCancelled.
   */
  analyze(
    fen: string,
    limits: SearchLimits,
    opts: { signal?: AbortSignal; onUpdate?: (a: PositionAnalysis) => void } = {}
  ): Promise<PositionAnalysis> {
    if (!FEN_RE.test(fen.trim())) return Promise.reject(new EngineError('Refusing to analyse an invalid FEN'))
    const terminal = terminalState(fen)
    if (terminal) return Promise.resolve({ fen, depth: 0, lines: [], bestMove: null, terminal })
    const side = fen.split(' ')[1] as 'w' | 'b'

    return this.enqueue(async () => {
      if (opts.signal?.aborted) throw new AnalysisCancelled()
      const lines = new Map<number, EngineLine>()
      let bestMove: string | null = null
      let cancelled = false
      const snapshot = (): PositionAnalysis => {
        const sorted = [...lines.values()].sort((a, b) => a.multipv - b.multipv)
        return { fen, depth: sorted[0]?.depth ?? 0, lines: sorted, bestMove: bestMove ?? sorted[0]?.pv[0] ?? null }
      }
      const onAbort = (): void => {
        cancelled = true
        try {
          this.send('stop')
        } catch {
          /* engine already gone */
        }
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true })
      let lastEmit = 0
      try {
        const multipv = Math.max(1, Math.min(10, Math.floor(limits.multipv)))
        const go = ['go']
        if (limits.depth) go.push('depth', String(Math.max(1, Math.floor(limits.depth))))
        if (limits.movetimeMs) go.push('movetime', String(Math.max(10, Math.floor(limits.movetimeMs))))
        if (go.length === 1) go.push('depth', '16')
        const budget = (limits.movetimeMs ?? 0) + 120_000
        await this.waitFor(
          (line) => {
            const bm = parseBestMove(line)
            if (bm !== undefined) {
              bestMove = bm
              return true
            }
            const info = parseInfoLine(line)
            // Bound lines are intermediate aspiration-window results, not evaluations.
            if (!info || info.bound) return false
            lines.set(info.multipv, {
              multipv: info.multipv,
              depth: info.depth,
              seldepth: info.seldepth,
              score: normalizeToWhite(info.score, side),
              wdl: info.wdl ? (side === 'w' ? info.wdl : [info.wdl[2], info.wdl[1], info.wdl[0]]) : undefined,
              nodes: info.nodes,
              nps: info.nps,
              pv: info.pv,
              pvSan: []
            })
            if (opts.onUpdate && info.multipv === 1 && Date.now() - lastEmit > 150) {
              lastEmit = Date.now()
              const snap = snapshot()
              for (const l of snap.lines) l.pvSan = pvToSan(fen, l.pv)
              opts.onUpdate(snap)
            }
            return false
          },
          budget,
          'The engine did not finish its search',
          () => {
            this.send(`setoption name MultiPV value ${multipv}`)
            this.send(`position fen ${fen.trim()}`)
            this.send(go.join(' '))
          }
        )
      } finally {
        opts.signal?.removeEventListener('abort', onAbort)
      }
      if (cancelled) throw new AnalysisCancelled()
      const result = snapshot()
      for (const l of result.lines) l.pvSan = pvToSan(fen, l.pv)
      if (result.lines.length === 0) throw new EngineError('The engine returned no evaluation for this position')
      return result
    })
  }

  async quit(): Promise<void> {
    const proc = this.proc
    if (!proc || this.exited) return
    try {
      proc.stdin.write('stop\nquit\n')
    } catch {
      /* ignore */
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        proc.kill()
        resolve()
      }, 1500)
      proc.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    this.proc = null
  }
}

/** Start an engine just long enough to read its name; used to validate and identify binaries. */
export async function identifyEngine(binaryPath: string): Promise<{ name: string; version: string | null }> {
  const engine = new UciEngine(binaryPath)
  try {
    await engine.start(10_000)
    const m = /stockfish\s+([\w.\-]+)/i.exec(engine.name)
    return { name: engine.name, version: m ? m[1] : null }
  } finally {
    await engine.quit()
  }
}
