import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AnalysisCancelled, EngineError, identifyEngine, parseBestMove, parseInfoLine, UciEngine } from '../src/main/engine/uci'
import { pickAsset } from '../src/main/engine/install'
import { EngineService } from '../src/main/engine/service'
import { parseGame, START_FEN } from '@shared/pgn'
import { winPercentWhite } from '@shared/eval'
import type { PositionAnalysis } from '@shared/types'

describe('UCI output parsing', () => {
  it('parses a full info line', () => {
    const info = parseInfoLine(
      'info depth 20 seldepth 31 multipv 2 score cp -34 wdl 60 850 90 nodes 1234567 nps 987654 hashfull 12 tbhits 0 time 1250 pv e7e5 g1f3 b8c6'
    )
    expect(info).toMatchObject({ depth: 20, seldepth: 31, multipv: 2, score: { type: 'cp', value: -34 }, wdl: [60, 850, 90], nodes: 1234567, nps: 987654 })
    expect(info!.pv).toEqual(['e7e5', 'g1f3', 'b8c6'])
  })

  it('parses mate scores and bounds', () => {
    expect(parseInfoLine('info depth 12 multipv 1 score mate -3 pv a1a2')!.score).toEqual({ type: 'mate', value: -3 })
    expect(parseInfoLine('info depth 9 score cp 50 lowerbound pv e2e4')!.bound).toBe('lower')
  })

  it('ignores lines that carry no evaluation', () => {
    expect(parseInfoLine('info depth 10 currmove e2e4 currmovenumber 1')).toBeNull()
    expect(parseInfoLine('info string NNUE evaluation using nn-xyz.nnue')).toBeNull()
    expect(parseInfoLine('readyok')).toBeNull()
    expect(parseInfoLine('info depth x score garbage')).toBeNull()
  })

  it('parses bestmove', () => {
    expect(parseBestMove('bestmove e2e4 ponder e7e5')).toBe('e2e4')
    expect(parseBestMove('bestmove (none)')).toBeNull()
    expect(parseBestMove('info depth 1')).toBeUndefined()
  })
})

describe('release asset selection', () => {
  const assets = [
    'stockfish-android-arm64-universal.tar.gz',
    'stockfish-linux-arm64-universal.tar.gz',
    'stockfish-linux-x86-64-universal.tar.gz',
    'stockfish-macos-universal.tar.gz',
    'stockfish-windows-arm64-universal.zip',
    'stockfish-windows-x86-64-universal.zip'
  ].map((name) => ({ name }))
  it('picks the right build per platform', () => {
    expect(pickAsset(assets, 'win32', 'x64')).toBe('stockfish-windows-x86-64-universal.zip')
    expect(pickAsset(assets, 'win32', 'arm64')).toBe('stockfish-windows-arm64-universal.zip')
    expect(pickAsset(assets, 'darwin', 'arm64')).toBe('stockfish-macos-universal.tar.gz')
    expect(pickAsset(assets, 'linux', 'x64')).toBe('stockfish-linux-x86-64-universal.tar.gz')
    expect(pickAsset(assets, 'linux', 'arm64')).toBe('stockfish-linux-arm64-universal.tar.gz')
    expect(pickAsset(assets, 'freebsd', 'x64')).toBeNull()
  })
  it('falls back to older naming schemes', () => {
    const old = ['stockfish-windows-x86-64-avx2.zip', 'stockfish-ubuntu-x86-64-avx2.tar', 'stockfish-macos-m1-apple-silicon.tar'].map((name) => ({ name }))
    expect(pickAsset(old, 'win32', 'x64')).toBe('stockfish-windows-x86-64-avx2.zip')
    expect(pickAsset(old, 'linux', 'x64')).toBe('stockfish-ubuntu-x86-64-avx2.tar')
    expect(pickAsset(old, 'darwin', 'arm64')).toBe('stockfish-macos-m1-apple-silicon.tar')
  })
})

// Real-engine tests. Set STOCKFISH_PATH to a Stockfish binary to run them.
const SF = process.env.STOCKFISH_PATH ?? ''
const haveEngine = !!SF && existsSync(SF)

describe.skipIf(!haveEngine)('Stockfish over UCI (real engine)', () => {
  let engine: UciEngine
  beforeAll(async () => {
    engine = new UciEngine(SF)
    await engine.start()
    await engine.configure({ threads: 2, hashMb: 64 })
  })
  afterAll(async () => {
    await engine.quit()
  })

  it('identifies the engine and its version', async () => {
    expect(engine.name).toMatch(/Stockfish/)
    const id = await identifyEngine(SF)
    expect(id.version).toBeTruthy()
  })

  it('analyses the start position with MultiPV, SAN lines and WDL', async () => {
    const a = await engine.analyze(START_FEN, { depth: 12, multipv: 3 })
    expect(a.lines).toHaveLength(3)
    expect(a.depth).toBeGreaterThanOrEqual(12)
    expect(a.bestMove).toBe(a.lines[0].pv[0])
    expect(a.lines[0].pvSan.length).toBeGreaterThan(0)
    expect(a.lines[0].wdl).toBeDefined()
    expect(Math.abs((a.lines[0].score as { value: number }).value)).toBeLessThan(150)
  })

  it('reports scores from White POV when Black is to move', async () => {
    // Black to move, Black is a queen up.
    const a = await engine.analyze('4k3/8/8/8/8/8/q7/4K3 b - - 0 1', { depth: 10, multipv: 1 })
    expect(winPercentWhite(a.lines[0].score)).toBeLessThan(20)
  })

  it('finds mate in one and reports it as a mate score', async () => {
    const a = await engine.analyze('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1', { depth: 8, multipv: 1 })
    expect(a.lines[0].score).toEqual({ type: 'mate', value: 1 })
    expect(a.lines[0].pvSan[0]).toBe('Ra8#')
  })

  it('short-circuits terminal positions', async () => {
    const a = await engine.analyze('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3', { depth: 8, multipv: 1 })
    expect(a.terminal).toBe('checkmate')
  })

  it('can be cancelled mid-search and used again', async () => {
    const abort = new AbortController()
    const p = engine.analyze(START_FEN, { depth: 60, multipv: 1 }, { signal: abort.signal })
    setTimeout(() => abort.abort(), 200)
    await expect(p).rejects.toBeInstanceOf(AnalysisCancelled)
    const again = await engine.analyze(START_FEN, { depth: 6, multipv: 1 })
    expect(again.bestMove).toBeTruthy()
  })

  it('rejects malformed FENs without talking to the engine', async () => {
    await expect(engine.analyze('not a fen\nquit', { depth: 5, multipv: 1 })).rejects.toBeInstanceOf(EngineError)
  })

  it('reviews a whole game and classifies every move', async () => {
    const cache = new Map<string, PositionAnalysis>()
    const service = new EngineService(
      () => SF,
      () => ({ threads: 2, hashMb: 64 }),
      { get: (k) => cache.get(k) ?? null, set: (k, v) => void cache.set(k, v) }
    )
    const g = parseGame('1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0')
    const seen: number[] = []
    const review = await service.reviewGame(1, g.plies, { id: 'quick', label: 'Quick', depth: 10, movetimeMs: 400, multipv: 2 }, { onProgress: (p) => seen.push(p.done) })
    expect(review.moves).toHaveLength(7)
    expect(seen.at(-1)).toBe(8)
    // 3...Nf6 allows mate in one.
    expect(review.moves[5].classification).toBe('blunder')
    expect(review.moves[5].bestSan).toBeTruthy()
    expect(review.moves[6].san).toBe('Qxf7#')
    expect(['best', 'great']).toContain(review.moves[6].classification)
    expect(review.accuracy.white).toBeGreaterThan(review.accuracy.black)
    // Second run is served from cache.
    const size = cache.size
    await service.reviewGame(1, g.plies, { id: 'quick', label: 'Quick', depth: 10, movetimeMs: 400, multipv: 2 }, {})
    expect(cache.size).toBe(size)
    await service.shutdown()
  })
})

describe('engine failure handling', () => {
  it('fails clearly when the binary does not exist', async () => {
    const e = new UciEngine('Z:/definitely/not/here/stockfish.exe')
    await expect(e.start(3000)).rejects.toBeInstanceOf(EngineError)
  })
  it('fails clearly when the program is not a UCI engine', async () => {
    const e = new UciEngine(process.execPath)
    await expect(e.start(1500)).rejects.toBeInstanceOf(EngineError)
    await e.quit()
  })
})
