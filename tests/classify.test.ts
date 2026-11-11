import { describe, expect, it } from 'vitest'
import { buildReview, classifyMove, gameAccuracy, moveAccuracy, scoreOf } from '@shared/classify'
import { centipawnLoss, formatScore, normalizeToWhite, winPercentFor, winPercentWhite } from '@shared/eval'
import { parseGame, START_FEN } from '@shared/pgn'
import type { EngineLine, PositionAnalysis, Score } from '@shared/types'

const cp = (value: number): Score => ({ type: 'cp', value })
const mate = (value: number): Score => ({ type: 'mate', value })
const line = (multipv: number, score: Score, first: string): EngineLine => ({ multipv, depth: 18, score, pv: [first], pvSan: [first] })
const pos = (lines: EngineLine[]): PositionAnalysis => ({ fen: START_FEN, depth: 18, lines, bestMove: lines[0]?.pv[0] ?? null })

const base = { fenBefore: START_FEN, legalMoveCount: 20 }

describe('evaluation normalisation', () => {
  it('converts side-to-move scores to White POV', () => {
    expect(normalizeToWhite(cp(50), 'w')).toEqual(cp(50))
    expect(normalizeToWhite(cp(50), 'b')).toEqual(cp(-50))
    expect(normalizeToWhite(mate(3), 'b')).toEqual(mate(-3))
    expect(normalizeToWhite(mate(-2), 'b')).toEqual(mate(2))
  })

  it('maps scores to win probability symmetrically', () => {
    expect(winPercentWhite(cp(0))).toBe(50)
    expect(winPercentWhite(cp(300)) + winPercentWhite(cp(-300))).toBeCloseTo(100)
    expect(winPercentWhite(cp(300))).toBeGreaterThan(70)
    expect(winPercentWhite(mate(4))).toBe(100)
    expect(winPercentWhite(mate(-1))).toBe(0)
    expect(winPercentFor(cp(200), 'b')).toBeCloseTo(100 - winPercentWhite(cp(200)))
    expect(winPercentWhite({ type: 'mate', value: 0, winner: 'b' })).toBe(0)
  })

  it('computes centipawn loss from the mover perspective', () => {
    expect(centipawnLoss(cp(80), cp(-40), 'w')).toBe(120)
    expect(centipawnLoss(cp(-80), cp(40), 'b')).toBe(120)
    expect(centipawnLoss(cp(80), cp(120), 'w')).toBe(0)
    expect(centipawnLoss(mate(3), cp(500), 'w')).toBeNull()
  })

  it('formats scores', () => {
    expect(formatScore(cp(125))).toBe('+1.25')
    expect(formatScore(cp(-40))).toBe('-0.40')
    expect(formatScore(mate(5))).toBe('M5')
    expect(formatScore(mate(-3))).toBe('-M3')
  })
})

describe('move classification', () => {
  it('labels the engine move as best', () => {
    const r = classifyMove({ ...base, color: 'w', uci: 'e2e4', before: pos([line(1, cp(30), 'e2e4'), line(2, cp(25), 'd2d4')]), evalAfter: cp(28) })
    expect(r.classification).toBe('best')
    expect(r.winLoss).toBe(0)
  })

  it('grades by win-probability loss: excellent / good / inaccuracy / mistake / blunder', () => {
    const before = pos([line(1, cp(50), 'e2e4'), line(2, cp(40), 'd2d4')])
    const grade = (after: number): string => classifyMove({ ...base, color: 'w', uci: 'a2a3', before, evalAfter: cp(after) }).classification
    expect(grade(45)).toBe('excellent')
    expect(grade(15)).toBe('good')
    expect(grade(-20)).toBe('inaccuracy')
    expect(grade(-80)).toBe('mistake')
    expect(grade(-400)).toBe('blunder')
  })

  it('uses the mover perspective for Black', () => {
    // Black is better by 2 pawns (White POV -200) and throws it away.
    const before = pos([line(1, cp(-200), 'e7e5'), line(2, cp(-180), 'd7d5')])
    const r = classifyMove({ ...base, color: 'b', uci: 'a7a6', before, evalAfter: cp(300) })
    expect(r.classification).toBe('blunder')
    expect(r.winBefore).toBeGreaterThan(60)
    expect(r.cpLoss).toBe(500)
    // The same numbers are fine for White if White made the improving move.
    const w = classifyMove({ ...base, color: 'w', uci: 'a2a3', before: pos([line(1, cp(300), 'e2e4')]), evalAfter: cp(300) })
    expect(w.winLoss).toBe(0)
  })

  it('detects a missed win', () => {
    const before = pos([line(1, cp(600), 'e2e4'), line(2, cp(100), 'd2d4')])
    const r = classifyMove({ ...base, color: 'w', uci: 'a2a3', before, evalAfter: cp(60) })
    expect(r.classification).toBe('missed_win')
  })

  it('detects a missed forced mate', () => {
    const before = pos([line(1, mate(2), 'e2e4'), line(2, cp(150), 'd2d4')])
    const r = classifyMove({ ...base, color: 'w', uci: 'a2a3', before, evalAfter: cp(120) })
    expect(r.classification).toBe('missed_win')
    expect(r.reason).toMatch(/forced mate in 2/)
    expect(r.cpLoss).toBeNull()
  })

  it('treats a slower mate as still good, and a kept mate as best', () => {
    const before = pos([line(1, mate(3), 'e2e4'), line(2, mate(5), 'd2d4')])
    expect(classifyMove({ ...base, color: 'w', uci: 'd2d4', before, evalAfter: mate(4) }).classification).toBe('excellent')
    expect(classifyMove({ ...base, color: 'w', uci: 'g1f3', before, evalAfter: mate(2) }).classification).toBe('best')
  })

  it('flags walking into mate as a blunder', () => {
    const before = pos([line(1, cp(0), 'e2e4'), line(2, cp(-10), 'd2d4')])
    const r = classifyMove({ ...base, color: 'w', uci: 'g2g4', before, evalAfter: mate(-1) })
    expect(r.classification).toBe('blunder')
    expect(r.reason).toMatch(/forced mate in 1/)
  })

  it('marks an only-legal move as forced', () => {
    const r = classifyMove({ ...base, legalMoveCount: 1, color: 'w', uci: 'e1d1', before: pos([line(1, cp(-500), 'e1d1')]), evalAfter: cp(-500) })
    expect(r.classification).toBe('forced')
  })

  it('marks the only good move as great, but not a plain recapture', () => {
    const before = pos([line(1, cp(20), 'e2e4'), line(2, cp(-300), 'd2d4')])
    expect(classifyMove({ ...base, color: 'w', uci: 'e2e4', before, evalAfter: cp(20) }).classification).toBe('great')
    expect(classifyMove({ ...base, color: 'w', uci: 'e2e4', prevUci: 'd5e4', before, evalAfter: cp(20) }).classification).toBe('best')
  })

  it('requires engine evidence for brilliant: a sound sacrifice that is clearly best', () => {
    const fen = 'r1bq1rk1/pppn1ppp/4pn2/3p4/3P4/3BPN2/PPP2PPP/RNBQ1RK1 w - - 0 1'
    const sound = pos([line(1, cp(250), 'd3h7'), line(2, cp(30), 'c2c4')])
    expect(classifyMove({ fenBefore: fen, legalMoveCount: 30, color: 'w', uci: 'd3h7', before: sound, evalAfter: cp(250) }).classification).toBe('brilliant')
    // Same sacrifice, but the engine says it just loses a piece: never brilliant.
    const unsound = pos([line(1, cp(30), 'c2c4'), line(2, cp(20), 'b1d2')])
    const r = classifyMove({ fenBefore: fen, legalMoveCount: 30, color: 'w', uci: 'd3h7', before: unsound, evalAfter: cp(-250) })
    expect(r.classification).toBe('blunder')
    expect(r.isSacrifice).toBe(true)
  })

  it('labels opening theory as book', () => {
    const r = classifyMove({ ...base, color: 'w', uci: 'e2e4', inBook: true, before: pos([line(1, cp(30), 'e2e4'), line(2, cp(28), 'd2d4')]), evalAfter: cp(30) })
    expect(r.classification).toBe('book')
  })
})

describe('accuracy and full review', () => {
  it('maps zero loss to 100 and large loss to near zero', () => {
    expect(moveAccuracy(0)).toBeCloseTo(100, 0)
    expect(moveAccuracy(50)).toBeLessThan(10)
    expect(moveAccuracy(5)).toBeGreaterThan(75)
  })

  it('gives a perfect game 100 and punishes blunders', () => {
    const evals = [cp(20), cp(20), cp(20), cp(20), cp(20)]
    const perfect = gameAccuracy(evals, [
      { color: 'w', accuracy: 100 },
      { color: 'b', accuracy: 100 },
      { color: 'w', accuracy: 100 },
      { color: 'b', accuracy: 100 }
    ])
    expect(perfect).toEqual({ white: 100, black: 100 })
    const bad = gameAccuracy(evals, [
      { color: 'w', accuracy: 100 },
      { color: 'b', accuracy: 100 },
      { color: 'w', accuracy: 10 },
      { color: 'b', accuracy: 100 }
    ])
    expect(bad.white).toBeLessThan(60)
    expect(bad.black).toBe(100)
  })

  it('scores a delivered checkmate for the right side', () => {
    expect(winPercentWhite(scoreOf({ fen: '', depth: 0, lines: [], bestMove: null, terminal: 'checkmate' }, 'b'))).toBe(100)
    expect(winPercentWhite(scoreOf({ fen: '', depth: 0, lines: [], bestMove: null, terminal: 'stalemate' }, 'b'))).toBe(50)
  })

  it('builds a review for a whole game from per-position analyses', () => {
    const g = parseGame('1. f3 e5 2. g4 Qh4# 0-1')
    const a = (score: Score, best: string, second?: [Score, string]): PositionAnalysis =>
      pos([line(1, score, best), ...(second ? [line(2, second[0], second[1])] : [])])
    const analyses: PositionAnalysis[] = [
      a(cp(30), 'e2e4', [cp(25), 'd2d4']),
      a(cp(-60), 'e7e5', [cp(-50), 'd7d5']),
      a(cp(-70), 'd2d4', [cp(-90), 'b1c3']),
      a(mate(-1), 'd8h4', [cp(-150), 'd7d5']),
      { fen: g.plies[3].fenAfter, depth: 0, lines: [], bestMove: null, terminal: 'checkmate' }
    ]
    const review = buildReview({
      plies: g.plies,
      analyses,
      legalMoveCounts: [20, 20, 19, 30],
      preset: { id: 'quick', label: 'Quick', depth: 12, movetimeMs: 300, multipv: 2 },
      engineName: 'Stockfish test'
    })
    expect(review.moves.map((m) => m.classification)).toEqual(['inaccuracy', 'best', 'blunder', 'great'])
    expect(review.moves[2].reason).toMatch(/forced mate in 1/)
    expect(review.evals[4]).toEqual({ type: 'mate', value: 0, winner: 'b' })
    expect(review.counts.white.blunder).toBe(1)
    expect(review.keyMoments).toContain(3)
    expect(review.accuracy.black).toBeGreaterThan(review.accuracy.white)
    expect(() => buildReview({ plies: g.plies, analyses: analyses.slice(1), legalMoveCounts: [], preset: { id: 'quick', label: '', depth: 1, movetimeMs: 1, multipv: 1 }, engineName: '' })).toThrow()
  })
})
