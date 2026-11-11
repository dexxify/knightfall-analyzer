import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js'

export const PIECE_VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

export interface MaterialBalance {
  white: number
  black: number
  /** Positive = White is ahead. */
  diff: number
  whitePieces: Record<PieceSymbol, number>
  blackPieces: Record<PieceSymbol, number>
}

export function materialBalance(fen: string): MaterialBalance {
  const empty = (): Record<PieceSymbol, number> => ({ p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 })
  const whitePieces = empty()
  const blackPieces = empty()
  const board = fen.split(' ')[0]
  for (const ch of board) {
    const lower = ch.toLowerCase() as PieceSymbol
    if (!(lower in PIECE_VALUE)) continue
    if (ch === lower) blackPieces[lower]++
    else whitePieces[lower]++
  }
  const sum = (p: Record<PieceSymbol, number>): number =>
    (Object.keys(p) as PieceSymbol[]).reduce((s, k) => s + p[k] * PIECE_VALUE[k], 0)
  const white = sum(whitePieces)
  const black = sum(blackPieces)
  return { white, black, diff: white - black, whitePieces, blackPieces }
}

export function describeMaterial(fen: string): string {
  const m = materialBalance(fen)
  if (m.diff === 0) return 'Material is level.'
  const side = m.diff > 0 ? 'White' : 'Black'
  return `${side} is ahead by ${Math.abs(m.diff)} point${Math.abs(m.diff) === 1 ? '' : 's'} of material.`
}

function leastValuableAttacker(chess: Chess, square: Square, by: Color): { from: Square; value: number } | null {
  let best: { from: Square; value: number } | null = null
  for (const from of chess.attackers(square, by)) {
    const piece = chess.get(from)
    if (!piece) continue
    // The king can only "attack" if the square is not defended; treat it as a very expensive attacker.
    const value = piece.type === 'k' ? 100 : PIECE_VALUE[piece.type]
    if (!best || value < best.value) best = { from, value }
  }
  return best
}

/**
 * Does the move leave real material hanging?
 *
 * Returns the material (in points) the mover puts at stake: after the move, the opponent has a
 * capture that wins at least a minor piece on a simple exchange count, and the mover did not
 * already bank that much by capturing on this move. This is deliberately a *necessary* condition
 * only — the classifier additionally requires the engine to confirm the move is sound.
 */
export function sacrificedMaterial(fenBefore: string, uci: string): number {
  const chess = new Chess(fenBefore)
  const mover = chess.turn()
  const opp: Color = mover === 'w' ? 'b' : 'w'
  let move
  try {
    move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
  } catch {
    return 0
  }
  const gained = move.captured ? PIECE_VALUE[move.captured] : 0
  let worst = 0
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== mover || cell.type === 'k' || cell.type === 'p') continue
      const attacker = leastValuableAttacker(chess, cell.square, opp)
      if (!attacker) continue
      const value = PIECE_VALUE[cell.type]
      const defended = chess.attackers(cell.square, mover).length > 0
      // Undefended piece: the whole piece is lost. Defended: lost only if a cheaper piece takes it.
      const loss = !defended ? value : attacker.value < value ? value - attacker.value : 0
      // A king can only capture an undefended piece.
      if (attacker.value === 100 && defended) continue
      if (loss > worst) worst = loss
    }
  }
  const net = worst - gained
  return net >= 2 ? net : 0
}
