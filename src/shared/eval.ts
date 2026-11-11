import type { Score } from './types'

/**
 * Evaluation helpers.
 *
 * Convention: every Score stored or passed around the application is from WHITE's point of
 * view. UCI engines report scores from the side to move, so the UCI layer converts once
 * (see normalizeToWhite) and nothing else in the codebase has to think about it.
 */

export function normalizeToWhite(score: Score, sideToMove: 'w' | 'b'): Score {
  if (sideToMove === 'w') return score
  return { ...score, value: -score.value || 0 } as Score
}

/** Re-express a White-POV score from one player's point of view. */
export function forPlayer(score: Score, color: 'w' | 'b'): Score {
  if (color === 'w') return score
  // `winner` is absolute (a colour), so only the numeric value changes sign.
  return { ...score, value: -score.value || 0 } as Score
}

/**
 * Win probability (0..100) for White from a White-POV score.
 * Centipawn mapping is the logistic model published by Lichess
 * (https://lichess.org/page/accuracy): 50 + 50 * (2 / (1 + e^(-0.00368208 * cp)) - 1).
 * Mate scores are certain results and bypass the curve entirely.
 */
export function winPercentWhite(score: Score): number {
  if (score.type === 'mate') {
    if (score.value === 0) return score.winner === 'w' ? 100 : score.winner === 'b' ? 0 : 50
    return score.value > 0 ? 100 : 0
  }
  const cp = Math.max(-1500, Math.min(1500, score.value))
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1)
}

export function winPercentFor(score: Score, color: 'w' | 'b'): number {
  const w = winPercentWhite(score)
  return color === 'w' ? w : 100 - w
}

/** Centipawns clamped for charts; mates map to +/-1000 scaled slightly by distance. */
export function scoreToCpForDisplay(score: Score): number {
  if (score.type === 'cp') return Math.max(-1000, Math.min(1000, score.value))
  if (score.value === 0) return score.winner === 'w' ? 1000 : score.winner === 'b' ? -1000 : 0
  return score.value > 0 ? 1000 : -1000
}

/** "+1.25", "-0.40", "M5", "-M3" — from White's point of view. */
export function formatScore(score: Score): string {
  if (score.type === 'mate') {
    if (score.value === 0) return score.winner === 'w' ? '1-0' : score.winner === 'b' ? '0-1' : '#'
    return `${score.value < 0 ? '-' : ''}M${Math.abs(score.value)}`
  }
  const pawns = score.value / 100
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(2)}`
}

/** A sentence-friendly description used in AI context, always naming the side. */
export function describeScore(score: Score): string {
  if (score.type === 'mate') {
    if (score.value === 0) return `checkmate on the board${score.winner ? ` (${score.winner === 'w' ? 'White' : 'Black'} won)` : ''}`
    const side = score.value > 0 ? 'White' : 'Black'
    return `${side} has a forced mate in ${Math.abs(score.value)}`
  }
  const v = score.value
  const abs = Math.abs(v)
  const side = v > 0 ? 'White' : 'Black'
  const pawns = (abs / 100).toFixed(2)
  if (abs < 25) return `equal (${formatScore(score)})`
  if (abs < 70) return `${side} is slightly better (${formatScore(score)})`
  if (abs < 160) return `${side} is clearly better (${formatScore(score)})`
  if (abs < 400) return `${side} has a winning advantage of about ${pawns} pawns`
  return `${side} is completely winning (${formatScore(score)})`
}

/** Mover-POV centipawn loss; null if either score is a mate (mates are handled separately). */
export function centipawnLoss(best: Score, played: Score, color: 'w' | 'b'): number | null {
  if (best.type === 'mate' || played.type === 'mate') return null
  const b = color === 'w' ? best.value : -best.value
  const p = color === 'w' ? played.value : -played.value
  return Math.max(0, b - p)
}
