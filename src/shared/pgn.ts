import { Chess } from 'chess.js'
import type { GameHeaders, ParsedGame, Ply } from './types'

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export class PgnError extends Error {
  constructor(
    message: string,
    public readonly gameIndex?: number
  ) {
    super(message)
    this.name = 'PgnError'
  }
}

/** Split a multi-game PGN into individual game strings. */
export function splitPgn(text: string): string[] {
  const normalized = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim()
  if (!normalized) return []
  const games: string[] = []
  let current: string[] = []
  let sawMoves = false
  for (const line of normalized.split('\n')) {
    const isHeader = /^\s*\[[A-Za-z0-9_]+\s+"/.test(line)
    if (isHeader && sawMoves) {
      games.push(current.join('\n').trim())
      current = []
      sawMoves = false
    }
    if (!isHeader && line.trim() !== '') sawMoves = true
    current.push(line)
  }
  const last = current.join('\n').trim()
  if (last) games.push(last)
  return games
}

/** Remove recursive variations "( ... )" outside of comments; used only as a parsing fallback. */
export function stripVariations(pgn: string): string {
  let out = ''
  let depth = 0
  let inComment = false
  for (const ch of pgn) {
    if (inComment) {
      if (ch === '}') inComment = false
      if (depth === 0) out += ch
      continue
    }
    if (ch === '{') {
      inComment = true
      if (depth === 0) out += ch
      continue
    }
    if (ch === '(') {
      depth++
      continue
    }
    if (ch === ')') {
      if (depth > 0) depth--
      continue
    }
    if (depth === 0) out += ch
  }
  return out
}

function tryLoad(pgn: string): Chess | null {
  const chess = new Chess()
  try {
    chess.loadPgn(pgn, { strict: false })
    return chess
  } catch {
    return null
  }
}

/**
 * Parse one game. The original PGN text is preserved verbatim (comments, variations, clock
 * annotations); the mainline is reconstructed position by position through the rules engine,
 * so every stored FEN is known to be legal.
 */
export function parseGame(pgn: string, gameIndex?: number): ParsedGame {
  const text = pgn.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim()
  if (!text) throw new PgnError('The PGN is empty.', gameIndex)
  if (text.length > 2_000_000) throw new PgnError('This PGN is larger than 2 MB, which is not a single chess game.', gameIndex)

  const cleaned = text.replace(/\$\d+/g, '')
  const chess =
    tryLoad(text) ??
    tryLoad(cleaned) ??
    tryLoad(stripVariations(cleaned)) ??
    // Last resort: drop a broken trailing fragment (e.g. a truncated final move).
    tryLoad(stripVariations(cleaned).replace(/\s+\S*$/, ''))
  if (!chess) {
    let detail = 'the move text could not be read'
    try {
      new Chess().loadPgn(stripVariations(cleaned), { strict: false })
    } catch (e) {
      detail = e instanceof Error ? e.message : String(e)
    }
    throw new PgnError(`Invalid PGN: ${detail}.`, gameIndex)
  }

  const rawHeaders = chess.getHeaders() as Record<string, string | null>
  const headers: GameHeaders = {}
  for (const [k, v] of Object.entries(rawHeaders)) if (v != null && v !== '' && v !== '?') headers[k] = v
  const history = chess.history({ verbose: true })
  if (history.length === 0) throw new PgnError('This PGN contains no moves.', gameIndex)

  const comments = new Map(chess.getComments().map((c) => [c.fen, c.comment]))
  const plies: Ply[] = history.map((m, i) => {
    const moveNumber = Number(m.before.split(' ')[5]) || Math.floor(i / 2) + 1
    return {
      ply: i + 1,
      color: m.color,
      moveNumber,
      san: m.san,
      uci: m.from + m.to + (m.promotion ?? ''),
      fenBefore: m.before,
      fenAfter: m.after,
      comment: comments.get(m.after)
    }
  })

  let result = headers.Result ?? '*'
  if (result === '*') {
    if (chess.isCheckmate()) result = chess.turn() === 'w' ? '0-1' : '1-0'
    else if (chess.isDraw()) result = '1/2-1/2'
  }
  return { headers, startFen: plies[0].fenBefore, plies, pgn: text, result }
}

export interface ParseManyResult {
  games: ParsedGame[]
  errors: string[]
}

export function parseMany(text: string): ParseManyResult {
  const games: ParsedGame[] = []
  const errors: string[] = []
  splitPgn(text).forEach((chunk, i) => {
    try {
      games.push(parseGame(chunk, i))
    } catch (e) {
      errors.push(`Game ${i + 1}: ${e instanceof Error ? e.message : String(e)}`)
    }
  })
  if (games.length === 0 && errors.length === 0) errors.push('No games were found in this text.')
  return { games, errors }
}

/** Convert an engine principal variation (UCI) into SAN, stopping at the first illegal move. */
export function pvToSan(fen: string, pv: string[], max = 12): string[] {
  const chess = new Chess(fen)
  const out: string[] = []
  for (const uci of pv.slice(0, max)) {
    try {
      const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
      out.push(m.san)
    } catch {
      break
    }
  }
  return out
}

export function legalMoveCount(fen: string): number {
  return new Chess(fen).moves().length
}

export function terminalState(fen: string): 'checkmate' | 'stalemate' | 'draw' | null {
  const c = new Chess(fen)
  if (c.isCheckmate()) return 'checkmate'
  if (c.isStalemate()) return 'stalemate'
  if (c.isInsufficientMaterial()) return 'draw'
  return null
}

/** Number SAN moves for display: "12. Nf3 Nc6 13. d4" starting from the given FEN. */
export function numberLine(fen: string, sans: string[]): string {
  const parts = fen.split(' ')
  let turn = parts[1] as 'w' | 'b'
  let n = Number(parts[5]) || 1
  const out: string[] = []
  sans.forEach((san, i) => {
    if (turn === 'w') out.push(`${n}. ${san}`)
    else {
      out.push(i === 0 ? `${n}... ${san}` : san)
      n++
    }
    turn = turn === 'w' ? 'b' : 'w'
  })
  return out.join(' ')
}

export function moveLabel(p: Pick<Ply, 'moveNumber' | 'color' | 'san'>): string {
  return `${p.moveNumber}${p.color === 'w' ? '.' : '...'} ${p.san}`
}
