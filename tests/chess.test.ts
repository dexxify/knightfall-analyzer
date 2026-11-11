import { describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import { legalMoveCount, numberLine, parseGame, parseMany, PgnError, pvToSan, splitPgn, START_FEN, stripVariations, terminalState } from '@shared/pgn'
import { materialBalance, sacrificedMaterial } from '@shared/material'

const OPERA = `[Event "Paris"]
[Site "Paris FRA"]
[Date "1858.??.??"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]
[WhiteElo "2690"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 {a weak move} 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7
8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6
15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`

describe('PGN parsing', () => {
  it('parses headers, moves and comments', () => {
    const g = parseGame(OPERA)
    expect(g.headers.White).toBe('Paul Morphy')
    expect(g.headers.WhiteElo).toBe('2690')
    expect(g.result).toBe('1-0')
    expect(g.plies).toHaveLength(33)
    expect(g.plies[0]).toMatchObject({ ply: 1, color: 'w', san: 'e4', uci: 'e2e4', moveNumber: 1, fenBefore: START_FEN })
    expect(g.plies[5].comment).toBe('a weak move')
    expect(g.plies[32].san).toBe('Rd8#')
  })

  it('reconstructs every FEN consistently', () => {
    const g = parseGame(OPERA)
    for (let i = 1; i < g.plies.length; i++) expect(g.plies[i].fenBefore).toBe(g.plies[i - 1].fenAfter)
    const replay = new Chess()
    for (const p of g.plies) replay.move(p.san)
    expect(replay.fen()).toBe(g.plies.at(-1)!.fenAfter)
  })

  it('converts SAN to UCI for castling, promotion and en passant', () => {
    expect(parseGame(OPERA).plies[22]).toMatchObject({ san: 'O-O-O', uci: 'e1c1' })
    const promo = parseGame('[FEN "8/P6k/8/8/8/8/7K/8 w - - 0 1"]\n[SetUp "1"]\n\n1. a8=Q 1-0')
    expect(promo.plies[0]).toMatchObject({ san: 'a8=Q', uci: 'a7a8q' })
    const ep = parseGame('1. e4 a6 2. e5 d5 3. exd6 *')
    expect(ep.plies[4]).toMatchObject({ san: 'exd6', uci: 'e5d6' })
    expect(ep.plies[4].fenAfter.split(' ')[0]).toBe('rnbqkbnr/1pp1pppp/p2P4/8/8/8/PPPP1PPP/RNBQKBNR')
  })

  it('keeps the mainline when the PGN has variations and NAGs', () => {
    const g = parseGame('1. e4 e5 (1... c5 2. Nf3 (2. c3)) 2. Nf3 $1 Nc6 {good (really)} 3. Bb5 *')
    expect(g.plies.map((p) => p.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'])
    expect(g.pgn).toContain('(1... c5')
  })

  it('strips variations but not parentheses inside comments', () => {
    expect(stripVariations('1. e4 (1. d4) e5 {a (b) c}')).toBe('1. e4  e5 {a (b) c}')
  })

  it('splits and parses multi-game files, reporting the bad ones', () => {
    const text = `${OPERA}\n\n[Event "B"]\n[White "x"]\n\n1. d4 d5 *\n\n[Event "Broken"]\n\n1. e4 Qh5 2. Zz9 *\n`
    expect(splitPgn(text)).toHaveLength(3)
    const r = parseMany(text)
    expect(r.games).toHaveLength(2)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toMatch(/^Game 3:/)
  })

  it('rejects empty and move-less input with clear errors', () => {
    expect(() => parseGame('')).toThrow(PgnError)
    expect(() => parseGame('[Event "x"]\n\n*')).toThrow(/no moves/)
    expect(parseMany('   ').errors[0]).toMatch(/No games/)
  })

  it('handles missing metadata', () => {
    const g = parseGame('1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#')
    expect(g.headers.White).toBeUndefined()
    expect(g.result).toBe('1-0')
  })
})

describe('rules helpers', () => {
  it('detects check, checkmate and stalemate', () => {
    expect(new Chess('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3').isCheckmate()).toBe(true)
    expect(terminalState('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3')).toBe('checkmate')
    expect(terminalState('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).toBe('stalemate')
    expect(terminalState(START_FEN)).toBeNull()
    expect(new Chess('rnbqkbnr/ppp2ppp/8/1B1pp3/4P3/8/PPPP1PPP/RNBQK1NR b KQkq - 1 3').isCheck()).toBe(true)
  })

  it('rejects illegal moves', () => {
    const c = new Chess()
    expect(() => c.move({ from: 'e2', to: 'e5' })).toThrow()
    expect(legalMoveCount(START_FEN)).toBe(20)
  })

  it('converts engine PVs to SAN and stops at an illegal move', () => {
    expect(pvToSan(START_FEN, ['e2e4', 'e7e5', 'g1f3'])).toEqual(['e4', 'e5', 'Nf3'])
    expect(pvToSan(START_FEN, ['e2e4', 'e2e4'])).toEqual(['e4'])
    expect(numberLine('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', ['e5', 'Nf3', 'Nc6'])).toBe('1... e5 2. Nf3 Nc6')
  })

  it('counts material', () => {
    expect(materialBalance(START_FEN).diff).toBe(0)
    expect(materialBalance('rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1').diff).toBe(9)
  })

  it('recognises a real sacrifice and ignores an even trade', () => {
    // Bxh7+ : bishop takes a pawn and can be captured by the king, undefended.
    expect(sacrificedMaterial('r1bq1rk1/pppn1ppp/4pn2/3p4/3P4/3BPN2/PPP2PPP/RNBQ1RK1 w - - 0 1', 'd3h7')).toBe(2)
    // Bxc6 dxc6 is a bishop-for-knight trade, not a sacrifice.
    expect(sacrificedMaterial('r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4', 'b5c6')).toBe(0)
    expect(sacrificedMaterial(START_FEN, 'e2e4')).toBe(0)
  })
})
