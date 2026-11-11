// Builds resources/openings.json from the lichess-org/chess-openings dataset (CC0-1.0).
// Run: node scripts/build-openings.mjs
import { writeFileSync } from 'node:fs'
import { Chess } from 'chess.js'

const base = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master/'
const out = {}
let count = 0
for (const f of ['a', 'b', 'c', 'd', 'e']) {
  const res = await fetch(`${base}${f}.tsv`)
  if (!res.ok) throw new Error(`${f}.tsv: ${res.status}`)
  const lines = (await res.text()).split('\n').slice(1)
  for (const line of lines) {
    const [eco, name, pgn] = line.split('\t')
    if (!pgn) continue
    const chess = new Chess()
    try {
      chess.loadPgn(pgn)
    } catch {
      continue
    }
    // EPD = FEN without the move counters; en-passant square normalised by chess.js.
    const epd = chess.fen().split(' ').slice(0, 4).join(' ')
    out[epd] = [eco, name]
    count++
  }
}
writeFileSync(new URL('../resources/openings.json', import.meta.url), JSON.stringify(out))
console.log(`wrote ${count} openings`)
