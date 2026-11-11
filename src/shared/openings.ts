import type { Ply } from './types'

export type OpeningTable = Record<string, [eco: string, name: string]>

const epd = (fen: string): string => fen.split(' ').slice(0, 4).join(' ')

export interface OpeningInfo {
  eco: string
  name: string
  /** Last ply that is still a named opening position. */
  lastBookPly: number
  /** inBook[i] is true when the position after plies[i] is a known opening position. */
  inBook: boolean[]
}

/** Identify the opening by walking the game and keeping the deepest known position. */
export function identifyOpening(plies: Ply[], table: OpeningTable): OpeningInfo | null {
  let found: OpeningInfo | null = null
  const inBook: boolean[] = plies.map(() => false)
  const limit = Math.min(plies.length, 40)
  for (let i = 0; i < limit; i++) {
    const hit = table[epd(plies[i].fenAfter)]
    if (hit) {
      inBook[i] = true
      found = { eco: hit[0], name: hit[1], lastBookPly: plies[i].ply, inBook }
    }
  }
  if (!found) return null
  // Moves before the deepest named position are theory too (transpositions without their own name).
  for (let i = 0; i < found.lastBookPly; i++) inBook[i] = true
  return found
}
