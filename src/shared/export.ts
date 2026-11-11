import type { Classification, GameReview, ParsedGame } from './types'
import { formatScore } from './eval'
import { CLASS_LABEL } from './classify'

const NAG: Partial<Record<Classification, string>> = {
  brilliant: '$3',
  great: '$1',
  inaccuracy: '$6',
  mistake: '$2',
  blunder: '$4',
  missed_win: '$2'
}

function wrap(text: string, width = 88): string {
  const out: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > width) {
      out.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) out.push(line)
  return out.join('\n')
}

/**
 * Export a game as PGN with the engine review embedded in standard form: [%eval] comments
 * (readable by Lichess, ChessBase, Scid…), NAG glyphs, and the best move for errors.
 */
export function annotatedPgn(game: ParsedGame, review: GameReview | null, appName: string): string {
  const headers = { ...game.headers }
  if (!headers.Result) headers.Result = game.result
  if (review) {
    headers.Annotator = `${appName} (${review.engineName}, depth ${review.depth})`
    headers.WhiteAccuracy = review.accuracy.white.toFixed(1)
    headers.BlackAccuracy = review.accuracy.black.toFixed(1)
  }
  const order = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result']
  const keys = [...order.filter((k) => k in headers), ...Object.keys(headers).filter((k) => !order.includes(k))]
  const head = keys.map((k) => `[${k} "${String(headers[k]).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`).join('\n')

  const tokens: string[] = []
  game.plies.forEach((p, i) => {
    const m = review?.moves[i]
    const needNumber = p.color === 'w' || i === 0 || tokens[tokens.length - 1]?.endsWith('}')
    if (needNumber) tokens.push(`${p.moveNumber}${p.color === 'w' ? '.' : '...'}`)
    tokens.push(p.san)
    if (m) {
      const nag = NAG[m.classification]
      if (nag) tokens.push(nag)
      const ev = m.evalAfter.type === 'mate' ? `#${m.evalAfter.value}` : (m.evalAfter.value / 100).toFixed(2)
      let comment = `[%eval ${ev}]`
      if (['inaccuracy', 'mistake', 'blunder', 'missed_win', 'brilliant', 'great'].includes(m.classification)) {
        comment += ` ${CLASS_LABEL[m.classification]}.`
        if (m.bestSan && m.bestUci !== m.uci) comment += ` Best was ${m.bestSan} (${formatScore(m.evalBefore)}).`
      }
      tokens.push(`{ ${comment} }`)
    } else if (p.comment) {
      tokens.push(`{ ${p.comment.replace(/[{}]/g, '')} }`)
    }
  })
  tokens.push(headers.Result ?? game.result)
  return `${head}\n\n${wrap(tokens.join(' '))}\n`
}
