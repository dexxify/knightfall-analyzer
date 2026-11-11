import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Database } from '../src/main/db'
import { parseGame } from '@shared/pgn'
import { parseImportUrl } from '@shared/import-urls'
import { identifyOpening, type OpeningTable } from '@shared/openings'
import { annotatedPgn } from '@shared/export'
import { buildReview } from '@shared/classify'
import { untar } from '../src/main/engine/install'
import { assertAllowedUrl } from '../src/main/system/download'
import type { PositionAnalysis } from '@shared/types'

const dir = mkdtempSync(join(tmpdir(), 'knightfall-test-'))
let db: Database
const game = parseGame('[White "Ann"]\n[Black "Bob"]\n[WhiteElo "1500"]\n[Date "2026.01.02"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1')

function fakeReview() {
  const a = (cp: number, best: string): PositionAnalysis => ({ fen: '', depth: 10, bestMove: best, lines: [{ multipv: 1, depth: 10, score: { type: 'cp', value: cp }, pv: [best], pvSan: [best] }] })
  return buildReview({
    plies: game.plies,
    analyses: [a(30, 'e2e4'), a(-60, 'e7e5'), a(-70, 'd2d4'), { fen: '', depth: 10, bestMove: 'd8h4', lines: [{ multipv: 1, depth: 10, score: { type: 'mate', value: -1 }, pv: ['d8h4'], pvSan: ['Qh4#'] }] }, { fen: '', depth: 0, lines: [], bestMove: null, terminal: 'checkmate' }],
    legalMoveCounts: [20, 20, 19, 30],
    preset: { id: 'quick', label: 'Quick', depth: 10, movetimeMs: 100, multipv: 1 },
    engineName: 'Test engine'
  })
}

beforeAll(() => {
  db = new Database(join(dir, 'test.db'))
})
afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('database', () => {
  it('runs migrations', () => {
    expect(db.schemaVersion).toBe(1)
  })

  it('stores games with metadata and refuses duplicates', () => {
    const first = db.addGame(game, { source: 'pgn', eco: 'A00', opening: 'Barnes Opening' })
    expect(first.inserted).toBe(true)
    expect(first.record).toMatchObject({ white: 'Ann', black: 'Bob', whiteElo: '1500', result: '0-1', date: '2026.01.02', plyCount: 4, opening: 'Barnes Opening', hasReview: false })
    const again = db.addGame(game, { source: 'pgn' })
    expect(again.inserted).toBe(false)
    expect(again.record.id).toBe(first.record.id)
  })

  it('filters by search, result, folder and tag', () => {
    db.addGame(parseGame('[White "Cy"]\n[Black "Di"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Ke7 3. Qxe5# 1-0'), { source: 'lichess' })
    const ann = db.listGames({ search: 'Ann' })
    expect(ann).toHaveLength(1)
    db.updateGame(ann[0].id, { folder: 'Club', tags: ['blunders', ' blunders ', 'short'] })
    expect(db.getGame(ann[0].id)!.tags).toEqual(['blunders', 'short'])
    expect(db.listGames({ folder: 'Club' })).toHaveLength(1)
    expect(db.listGames({ tag: 'short' })).toHaveLength(1)
    expect(db.listGames({ tag: 'nope' })).toHaveLength(0)
    expect(db.listGames({ result: '1-0' })).toHaveLength(1)
    expect(db.listGames({ source: 'lichess' })[0].white).toBe('Cy')
    expect(db.folders()).toEqual(['Club'])
    expect(db.tags()).toEqual(['blunders', 'short'])
    expect(db.listGames({ search: "x' OR 1=1 --" })).toHaveLength(0)
  })

  it('saves and reloads a review, and drops stale explanations when re-reviewed', () => {
    const id = db.listGames({ search: 'Ann' })[0].id
    const review = fakeReview()
    db.saveExplanation(id, 'mentor', 'ply:3', 'm', 'old text')
    db.saveReview(id, review)
    expect(db.getReview(id)!.moves[2].classification).toBe('blunder')
    expect(db.getGame(id)).toMatchObject({ hasReview: true, accuracyWhite: review.accuracy.white })
    expect(db.getExplanation(id, 'mentor', 'ply:3', 'm')).toBeNull()
    expect(db.stats()).toMatchObject({ games: 2, reviewed: 1 })
  })

  it('keeps conversation history and cached explanations per coach and model', () => {
    const id = db.listGames({ search: 'Ann' })[0].id
    db.addMessage(id, 'mentor', 'ply:3', { role: 'user', content: 'Why?' })
    db.addMessage(id, 'mentor', 'ply:3', { role: 'assistant', content: 'Because g4 opens the diagonal.' })
    expect(db.getMessages(id).map((m) => m.role)).toEqual(['user', 'assistant'])
    db.saveExplanation(id, 'mentor', 'ply:3', 'builtin:a', 'A')
    expect(db.getExplanation(id, 'mentor', 'ply:3', 'builtin:a')).toBe('A')
    expect(db.getExplanation(id, 'mentor', 'ply:3', 'builtin:b')).toBeNull()
    expect(db.getExplanation(id, 'rival', 'ply:3', 'builtin:a')).toBeNull()
  })

  it('caches engine output and stores settings', () => {
    const a: PositionAnalysis = { fen: 'x', depth: 12, lines: [], bestMove: 'e2e4' }
    db.cacheSet('k', a)
    expect(db.cacheGet('k')).toEqual(a)
    expect(db.cacheGet('missing')).toBeNull()
    db.setSetting('s', { a: 1 })
    expect(db.getSetting('s')).toEqual({ a: 1 })
  })

  it('backs up and restores, and rejects files that are not backups', () => {
    const backup = join(dir, 'backup.db')
    db.backupTo(backup)
    const id = db.listGames({ search: 'Ann' })[0].id
    db.deleteGame(id)
    expect(db.listGames({})).toHaveLength(1)
    expect(db.getReview(id)).toBeNull()
    db.restoreFrom(backup)
    expect(db.listGames({})).toHaveLength(2)
    expect(db.getReview(id)).not.toBeNull()
    expect(() => db.restoreFrom(join(dir, 'nope.db'))).toThrow(/does not exist/)
    expect(() => db.restoreFrom(join(import.meta.dirname, 'data.test.ts'))).toThrow(/not a valid backup|not a backup/)
    expect(db.listGames({})).toHaveLength(2)
  })

  it('cascades deletes', () => {
    const id = db.listGames({ search: 'Ann' })[0].id
    db.deleteGame(id)
    expect(db.getMessages(id)).toHaveLength(0)
    expect(db.getReview(id)).toBeNull()
  })
})

describe('import links', () => {
  it('recognises Chess.com game links', () => {
    expect(parseImportUrl('https://www.chess.com/game/live/123456789')).toEqual({ site: 'chesscom', kind: 'game', gameId: '123456789', gameType: 'live' })
    expect(parseImportUrl('chess.com/game/daily/555')).toMatchObject({ gameId: '555', gameType: 'daily' })
    expect(parseImportUrl('https://www.chess.com/analysis/game/live/42?tab=review')).toMatchObject({ gameId: '42' })
    expect(parseImportUrl('https://www.chess.com/member/Hikaru')).toEqual({ site: 'chesscom', kind: 'player', username: 'hikaru' })
  })
  it('recognises Lichess games, studies and players', () => {
    expect(parseImportUrl('https://lichess.org/AbCdEfGh')).toEqual({ site: 'lichess', kind: 'game', gameId: 'AbCdEfGh' })
    expect(parseImportUrl('https://lichess.org/AbCdEfGh/black#34')).toMatchObject({ gameId: 'AbCdEfGh' })
    expect(parseImportUrl('https://lichess.org/AbCdEfGhIjKl')).toMatchObject({ gameId: 'AbCdEfGh' })
    expect(parseImportUrl('https://lichess.org/study/abcdefgh/ijklmnop')).toEqual({ site: 'lichess', kind: 'study', studyId: 'abcdefgh', chapterId: 'ijklmnop' })
    expect(parseImportUrl('https://lichess.org/@/DrNykterstein')).toEqual({ site: 'lichess', kind: 'player', username: 'DrNykterstein' })
  })
  it('rejects everything else', () => {
    for (const bad of ['', 'not a url at all', 'https://example.com/game/live/1', 'https://lichess.org/training', 'https://lichess.org/tv', 'javascript:alert(1)', 'https://www.chess.com/play'])
      expect(parseImportUrl(bad)).toBeNull()
  })
})

describe('openings, export, archives, downloads', () => {
  it('identifies the opening from the bundled table', () => {
    const table = JSON.parse(readFileSync(join(import.meta.dirname, '../resources/openings.json'), 'utf8')) as OpeningTable
    const g = parseGame('1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be3 e5 7. Nb3 Be6 8. h4 h5 *')
    const op = identifyOpening(g.plies, table)!
    expect(op.name).toMatch(/Najdorf/)
    expect(op.eco).toMatch(/^B9/)
    expect(op.inBook[0]).toBe(true)
    expect(op.inBook[g.plies.length - 1]).toBe(false)
    expect(identifyOpening(parseGame('[FEN "8/8/8/8/8/k7/8/K6R w - - 0 1"]\n[SetUp "1"]\n\n1. Rh3+ *').plies, table)).toBeNull()
  })

  it('exports an annotated PGN that parses back to the same game', () => {
    const text = annotatedPgn(game, fakeReview(), 'Knightfall Analyzer')
    expect(text).toContain('[Annotator "Knightfall Analyzer (Test engine, depth 10)"]')
    expect(text).toContain('[%eval #-1]')
    expect(text).toMatch(/g4 \$4 \{ \[%eval #-1\] Blunder\. Best was d2d4/)
    expect(parseGame(text).plies.map((p) => p.san)).toEqual(game.plies.map((p) => p.san))
    expect(parseGame(annotatedPgn(game, null, 'Knightfall Analyzer')).plies).toHaveLength(4)
  })

  it('extracts tar archives and ignores path traversal entries', () => {
    const block = (name: string, data: string, type = '0'): Uint8Array => {
      const h = new Uint8Array(512)
      const enc = new TextEncoder()
      h.set(enc.encode(name), 0)
      h.set(enc.encode('0000755'), 100)
      h.set(enc.encode(data.length.toString(8).padStart(11, '0')), 124)
      h[156] = type.charCodeAt(0)
      const body = new Uint8Array(Math.ceil(data.length / 512) * 512)
      body.set(enc.encode(data))
      const out = new Uint8Array(512 + body.length)
      out.set(h)
      out.set(body, 512)
      return out
    }
    const parts = [block('stockfish/', '', '5'), block('stockfish/readme.txt', 'hello'), block('../evil.txt', 'nope'), new Uint8Array(1024)]
    const tar = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let off = 0
    for (const p of parts) {
      tar.set(p, off)
      off += p.length
    }
    const dest = join(dir, 'untar')
    const files = untar(tar, dest)
    expect(files).toHaveLength(1)
    expect(readFileSync(join(dest, 'stockfish', 'readme.txt'), 'utf8')).toBe('hello')
  })

  it('only allows HTTPS downloads from the known hosts', () => {
    expect(() => assertAllowedUrl('https://github.com/official-stockfish/Stockfish/releases/download/x/y.zip')).not.toThrow()
    expect(() => assertAllowedUrl('https://huggingface.co/a/b/resolve/main/c.gguf')).not.toThrow()
    expect(() => assertAllowedUrl('http://github.com/x')).toThrow(/HTTPS/)
    expect(() => assertAllowedUrl('https://evil.example/x')).toThrow(/not allowed/)
    expect(() => assertAllowedUrl('https://github.com.evil.example/x')).toThrow(/not allowed/)
    expect(() => assertAllowedUrl('nonsense')).toThrow()
  })
})
