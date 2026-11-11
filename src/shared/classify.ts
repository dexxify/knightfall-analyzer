import type {
  Classification,
  ClassificationThresholds,
  GameReview,
  MoveReview,
  Ply,
  PositionAnalysis,
  ReviewPreset,
  Score
} from './types'
import { centipawnLoss, forPlayer, formatScore, winPercentFor, winPercentWhite } from './eval'
import { sacrificedMaterial } from './material'

export const DEFAULT_THRESHOLDS: ClassificationThresholds = {
  excellent: 2,
  good: 5,
  inaccuracy: 10,
  mistake: 20,
  winningAt: 80,
  greatGap: 10
}

export const CLASSIFICATIONS: Classification[] = [
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'book',
  'inaccuracy',
  'mistake',
  'missed_win',
  'blunder',
  'forced'
]

export const CLASS_LABEL: Record<Classification, string> = {
  brilliant: 'Brilliant',
  great: 'Great',
  best: 'Best',
  excellent: 'Excellent',
  good: 'Good',
  book: 'Book',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  missed_win: 'Missed win',
  blunder: 'Blunder',
  forced: 'Forced'
}

export interface ClassifyInput {
  color: 'w' | 'b'
  uci: string
  fenBefore: string
  legalMoveCount: number
  /** Engine analysis of the position BEFORE the move (best line first, White POV). */
  before: PositionAnalysis
  /** White-POV evaluation of the position AFTER the move. */
  evalAfter: Score
  /** UCI of the previous move in the game, to recognise plain recaptures. */
  prevUci?: string | null
  /** True when the resulting position is a known opening position. */
  inBook?: boolean
  thresholds?: ClassificationThresholds
}

export interface ClassifyResult {
  classification: Classification
  reason: string
  winBefore: number
  winAfter: number
  winLoss: number
  cpLoss: number | null
  isSacrifice: boolean
}

const round1 = (n: number): string => n.toFixed(1)

/**
 * Classify one move purely from engine output and the rules of chess.
 *
 * The measure is the drop in the mover's win probability between the engine's best line and
 * the move actually played. Centipawns are not compared directly because 100cp matters a lot
 * at 0.00 and not at all at +9.00; the win-probability curve absorbs that. Mate scores are
 * certain outcomes (100 / 0) and get their own distance comparison.
 */
export function classifyMove(input: ClassifyInput): ClassifyResult {
  const t = input.thresholds ?? DEFAULT_THRESHOLDS
  const { color, before, evalAfter, uci } = input
  const best = before.lines[0]
  const evalBefore: Score = best ? best.score : { type: 'cp', value: 0 }
  const playedIsBest = !!best && best.pv[0] === uci

  const winBefore = winPercentFor(evalBefore, color)
  const winAfterRaw = winPercentFor(evalAfter, color)
  // The best move cannot lose anything by definition; ignore search-depth noise between plies.
  const winAfter = playedIsBest ? Math.max(winAfterRaw, winBefore) : winAfterRaw
  const winLoss = Math.max(0, winBefore - winAfter)
  const cpLoss = playedIsBest ? 0 : centipawnLoss(evalBefore, evalAfter, color)
  const sac = sacrificedMaterial(input.fenBefore, uci)
  const base = { winBefore, winAfter, winLoss, cpLoss, isSacrifice: sac > 0 }

  if (input.legalMoveCount === 1) {
    return { ...base, classification: 'forced', reason: 'This was the only legal move.' }
  }

  const mBefore = forPlayer(evalBefore, color)
  const mAfter = forPlayer(evalAfter, color)
  const hadMate = mBefore.type === 'mate' && mBefore.value > 0
  const keptMate = mAfter.type === 'mate' && (mAfter.value > 0 || (mAfter.value === 0 && winAfterRaw === 100))

  // Second-best candidate, used for "great" and "brilliant".
  const second = before.lines[1]
  const secondWin = second ? winPercentFor(second.score, color) : null
  const gapToSecond = secondWin === null ? null : winBefore - secondWin

  const isRecapture =
    !!input.prevUci && input.prevUci.slice(2, 4) === uci.slice(2, 4)

  if (playedIsBest || winLoss <= 1) {
    const sound = winAfter >= 45
    const notAlreadyWon = winBefore <= 95 || hadMate
    const matters = gapToSecond === null ? false : gapToSecond >= 2
    if (sac > 0 && sound && notAlreadyWon && matters && playedIsBest) {
      return {
        ...base,
        classification: 'brilliant',
        reason: `Best move, and it offers ${sac} point${sac === 1 ? '' : 's'} of material. The engine confirms the sacrifice is sound (${formatScore(evalAfter)}) and the next-best move was ${round1(gapToSecond!)} points worse.`
      }
    }
    if (
      playedIsBest &&
      gapToSecond !== null &&
      gapToSecond >= t.greatGap &&
      winAfter >= 40 &&
      !isRecapture &&
      !(winBefore >= 97 && secondWin !== null && secondWin >= 90)
    ) {
      return {
        ...base,
        classification: 'great',
        reason: `The only move that keeps the evaluation: every alternative loses at least ${round1(gapToSecond)} points of win probability.`
      }
    }
    if (input.inBook) {
      return { ...base, classification: 'book', reason: 'A known opening move.' }
    }
    if (playedIsBest) {
      return { ...base, classification: 'best', reason: "This is the engine's first choice." }
    }
  }

  if (input.inBook && winLoss <= t.good) {
    return { ...base, classification: 'book', reason: 'A known opening move.' }
  }

  if (hadMate && keptMate && mBefore.type === 'mate' && mAfter.type === 'mate') {
    // After the best move the count drops by one; anything else is a slower mate.
    const slower = mAfter.value - (mBefore.value - 1)
    if (slower <= 0) return { ...base, classification: 'best', reason: 'Keeps the fastest forced mate.' }
    return {
      ...base,
      classification: slower <= 2 ? 'excellent' : 'good',
      reason: `Still a forced mate, but ${slower} move${slower === 1 ? '' : 's'} slower than the fastest one.`
    }
  }

  let classification: Classification
  if (winLoss <= t.excellent) classification = 'excellent'
  else if (winLoss <= t.good) classification = 'good'
  else if (winLoss <= t.inaccuracy) classification = 'inaccuracy'
  else if (winLoss <= t.mistake) classification = 'mistake'
  else classification = 'blunder'

  const lossText = `Win probability fell from ${round1(winBefore)}% to ${round1(winAfter)}%`
  let reason =
    cpLoss !== null
      ? `${lossText} (${(cpLoss / 100).toFixed(2)} pawns worse than the best move).`
      : `${lossText}.`

  const bad = classification === 'inaccuracy' || classification === 'mistake' || classification === 'blunder'
  if (bad && winBefore >= t.winningAt && winAfter < t.winningAt && winAfter >= 40) {
    classification = 'missed_win'
    reason = hadMate
      ? `There was a forced mate in ${Math.abs((mBefore as { value: number }).value)}; after this move it is gone. ${lossText}.`
      : `The position was winning and no longer is. ${lossText}.`
  } else if (mAfter.type === 'mate' && mAfter.value < 0 && !(mBefore.type === 'mate' && mBefore.value < 0)) {
    reason = `This allows a forced mate in ${Math.abs(mAfter.value)}. ${lossText}.`
  }

  return { ...base, classification, reason }
}

/** Per-move accuracy, Lichess's published formula over win-probability loss. */
export function moveAccuracy(winLoss: number): number {
  const raw = 103.1668 * Math.exp(-0.04354 * winLoss) - 3.1669
  return Math.max(0, Math.min(100, raw))
}

function stddev(xs: number[]): number {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length)
}

/**
 * Game accuracy per colour. Methodology (documented in docs/ARCHITECTURE.md):
 * each move's accuracy is weighted by how volatile the position was (std-dev of win% in a
 * sliding window), and the final number is the mean of that weighted average and the harmonic
 * mean, so a few terrible moves pull the score down. This follows Lichess's open-source method.
 */
export function gameAccuracy(evals: Score[], moves: Pick<MoveReview, 'color' | 'accuracy'>[]): { white: number; black: number } {
  if (moves.length === 0) return { white: 0, black: 0 }
  const wins = evals.map(winPercentWhite)
  const windowSize = Math.max(2, Math.min(8, Math.floor(moves.length / 10)))
  const weights = moves.map((_, i) => {
    const start = Math.max(0, Math.min(i, wins.length - windowSize))
    const win = wins.slice(start, start + windowSize)
    return Math.max(0.5, Math.min(12, win.length > 1 ? stddev(win) : 0.5))
  })
  const forColor = (color: 'w' | 'b'): number => {
    let wSum = 0
    let wAcc = 0
    let hSum = 0
    let n = 0
    moves.forEach((m, i) => {
      if (m.color !== color) return
      wSum += weights[i]
      wAcc += weights[i] * m.accuracy
      hSum += 1 / Math.max(m.accuracy, 0.1)
      n++
    })
    if (n === 0) return 0
    const weighted = wAcc / wSum
    const harmonic = n / hSum
    return Math.round(((weighted + harmonic) / 2) * 10) / 10
  }
  return { white: forColor('w'), black: forColor('b') }
}

function emptyCounts(): Record<Classification, number> {
  return Object.fromEntries(CLASSIFICATIONS.map((c) => [c, 0])) as Record<Classification, number>
}

export interface BuildReviewInput {
  plies: Ply[]
  /** analyses[i] is the engine's view of the position before plies[i]; the final entry is the last position. */
  analyses: PositionAnalysis[]
  legalMoveCounts: number[]
  inBook?: boolean[]
  preset: ReviewPreset
  engineName: string
  thresholds?: ClassificationThresholds
}

export function scoreOf(a: PositionAnalysis | undefined, sideToMove: 'w' | 'b'): Score {
  if (!a) return { type: 'cp', value: 0 }
  if (a.terminal === 'checkmate') return { type: 'mate', value: 0, winner: sideToMove === 'w' ? 'b' : 'w' }
  if (a.terminal) return { type: 'cp', value: 0 }
  return a.lines[0]?.score ?? { type: 'cp', value: 0 }
}

/** Turn raw per-position engine output into a complete, classified game review. */
export function buildReview(input: BuildReviewInput): GameReview {
  const { plies, analyses } = input
  if (analyses.length !== plies.length + 1) {
    throw new Error(`Expected ${plies.length + 1} position analyses, received ${analyses.length}`)
  }
  const sideAt = (i: number): 'w' | 'b' => (i < plies.length ? plies[i].color : plies[i - 1].color === 'w' ? 'b' : 'w')
  const evals = analyses.map((a, i) => scoreOf(a, sideAt(i)))
  const moves: MoveReview[] = plies.map((p, i) => {
    const before = analyses[i]
    const after = analyses[i + 1]
    const evalAfter = evals[i + 1]
    const r = classifyMove({
      color: p.color,
      uci: p.uci,
      fenBefore: p.fenBefore,
      legalMoveCount: input.legalMoveCounts[i],
      before,
      evalAfter,
      prevUci: i > 0 ? plies[i - 1].uci : null,
      inBook: input.inBook?.[i],
      thresholds: input.thresholds
    })
    const best = before.lines[0]
    return {
      ply: p.ply,
      color: p.color,
      san: p.san,
      uci: p.uci,
      fenBefore: p.fenBefore,
      fenAfter: p.fenAfter,
      evalBefore: evals[i],
      evalAfter,
      winBefore: r.winBefore,
      winAfter: r.winAfter,
      winLoss: r.winLoss,
      cpLoss: r.cpLoss,
      bestUci: best?.pv[0] ?? null,
      bestSan: best?.pvSan[0] ?? null,
      bestLineSan: best?.pvSan ?? [],
      playedLineSan: after?.lines[0]?.pvSan ?? [],
      alternatives: before.lines.slice(1).map((l) => ({
        san: l.pvSan[0] ?? l.pv[0],
        uci: l.pv[0],
        score: l.score,
        lineSan: l.pvSan
      })),
      classification: r.classification,
      reason: r.reason,
      accuracy: r.classification === 'forced' || r.classification === 'book' ? 100 : moveAccuracy(r.winLoss),
      legalMoveCount: input.legalMoveCounts[i],
      isSacrifice: r.isSacrifice,
      depth: before.depth
    }
  })

  const counts = { white: emptyCounts(), black: emptyCounts() }
  for (const m of moves) counts[m.color === 'w' ? 'white' : 'black'][m.classification]++

  const notable: Classification[] = ['blunder', 'mistake', 'missed_win', 'brilliant', 'great']
  const keyMoments = moves
    .filter((m) => notable.includes(m.classification))
    .sort((a, b) => b.winLoss - a.winLoss || a.ply - b.ply)
    .slice(0, 10)
    .map((m) => m.ply)
    .sort((a, b) => a - b)

  return {
    presetId: input.preset.id,
    engineName: input.engineName,
    depth: input.preset.depth,
    createdAt: new Date().toISOString(),
    moves,
    evals,
    accuracy: gameAccuracy(evals, moves),
    counts,
    keyMoments
  }
}
