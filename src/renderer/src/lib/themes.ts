import cburnettCss from '@lichess-org/chessground/assets/chessground.cburnett.css?raw'

/**
 * Board and piece themes. The "Knightfall" piece shapes below are original artwork made for
 * this project (GPL-3.0-or-later, like the rest of the code). "Cburnett" is the classic set by
 * Colin M.L. Burnett (GPLv2+), shipped with Chessground. New sets register here.
 */

export interface BoardTheme {
  id: string
  name: string
  light: string
  dark: string
}

export const BOARD_THEMES: BoardTheme[] = [
  { id: 'walnut', name: 'Walnut', light: '#e8d9bd', dark: '#a67c52' },
  { id: 'slate', name: 'Slate', light: '#d9dee3', dark: '#6f8296' },
  { id: 'forest', name: 'Forest', light: '#e6e8d4', dark: '#6b8f5b' },
  { id: 'sand', name: 'Sand', light: '#f1e7d0', dark: '#c4a574' },
  { id: 'midnight', name: 'Midnight', light: '#a9b3c4', dark: '#4a5670' },
  { id: 'paper', name: 'Paper', light: '#f4f1ea', dark: '#b9b3a6' }
]

const BASE = 'M22 87h56v-7c0-3-2-5-5-5H27c-3 0-5 2-5 5z'
const SHAPES: Record<string, string> = {
  pawn: `<circle cx="50" cy="29" r="13"/><path d="M37 44h26l-3 6c2 9 6 16 9 25H31c3-9 7-16 9-25z"/><path d="${BASE}"/>`,
  rook: `<path d="M27 18h11v8h7v-8h10v8h7v-8h11v21H27z"/><path d="M33 39h34l3 36H30z"/><path d="${BASE}"/>`,
  bishop: `<circle cx="50" cy="10" r="4.5"/><path d="M50 14c9 9 15 18 15 27 0 8-6 13-15 13s-15-5-15-13c0-9 6-18 15-27z"/><path d="M45 26l10 12" fill="none"/><path d="M36 54h28v6H36z"/><path d="M40 60h20c1 6 5 10 8 15H32c3-5 7-9 8-15z"/><path d="${BASE}"/>`,
  knight: `<path d="M34 75c0-14 4-22 10-30-6 2-10 5-14 9l-6-6c3-10 10-18 20-24l-2-10 10 7c14 2 24 14 24 32v22z"/><circle cx="45" cy="33" r="2.6" class="eye"/><path d="${BASE}"/>`,
  queen: `<path d="M22 33L34 59H66L78 33L66 46L62 23L54 44L50 19L46 44L38 23L34 46Z"/><circle cx="22" cy="31" r="4"/><circle cx="38" cy="21" r="4"/><circle cx="50" cy="16" r="4"/><circle cx="62" cy="21" r="4"/><circle cx="78" cy="31" r="4"/><path d="M34 59h32l3 16H31z"/><path d="${BASE}"/>`,
  king: `<path d="M46 6h8v8h8v8h-8v9h-8v-9h-8v-8h8z"/><path d="M28 41c0-6 6-9 12-9h20c6 0 12 3 12 9 0 8-6 14-8 20H36c-2-6-8-12-8-20z"/><path d="M34 61h32l3 14H31z"/><path d="${BASE}"/>`
}

function pieceSvg(role: string, fill: string, stroke: string, eye: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><style>.eye{fill:${eye};stroke:none}</style><g fill="${fill}" stroke="${stroke}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">${SHAPES[role]}</g></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

function shapeSetCss(white: [string, string], black: [string, string]): string {
  return Object.keys(SHAPES)
    .map(
      (role) =>
        `.cg-wrap piece.${role}.white{background-image:${pieceSvg(role, white[0], white[1], white[1])}}` +
        `.cg-wrap piece.${role}.black{background-image:${pieceSvg(role, black[0], black[1], black[0] === '#2f2c2a' ? '#d8d2c6' : white[0])}}`
    )
    .join('\n')
}

export interface PieceSet {
  id: string
  name: string
  credit: string
  css: string
}

export const PIECE_SETS: PieceSet[] = [
  { id: 'knightfall', name: 'Knightfall', credit: 'Original set made for this application', css: shapeSetCss(['#f4eee2', '#2a2622'], ['#2f2c2a', '#0e0d0c']) },
  { id: 'slate', name: 'Slate', credit: 'Original set made for this application', css: shapeSetCss(['#ffffff', '#3d4857'], ['#4a5564', '#141a22']) },
  { id: 'cburnett', name: 'Cburnett', credit: 'Colin M.L. Burnett, GPLv2+ (via Chessground)', css: cburnettCss }
]

/** A piece image for use outside the board (promotion picker, avatars). */
export function pieceImage(role: 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn', color: 'white' | 'black' = 'white'): string {
  return color === 'white' ? pieceSvg(role, '#f4eee2', '#2a2622', '#2a2622') : pieceSvg(role, '#2f2c2a', '#0e0d0c', '#d8d2c6')
}

export function glyphMask(role: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g fill="#000">${SHAPES[role]}</g></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

function boardImage(dark: string): string {
  let rects = ''
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) if ((r + f) % 2 === 1) rects += `<rect x="${f}" y="${r}" width="1" height="1"/>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges"><g fill="${dark}">${rects}</g></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

/** Apply themes by swapping one <style> element and a few CSS variables. */
export function applyThemes(theme: 'dark' | 'light', boardId: string, pieceId: string): void {
  document.documentElement.dataset.theme = theme
  const b = BOARD_THEMES.find((x) => x.id === boardId) ?? BOARD_THEMES[0]
  const root = document.documentElement.style
  root.setProperty('--sq-light', b.light)
  root.setProperty('--sq-dark', b.dark)
  root.setProperty('--board-image', boardImage(b.dark))
  const set = PIECE_SETS.find((x) => x.id === pieceId) ?? PIECE_SETS[0]
  let el = document.getElementById('piece-set') as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = 'piece-set'
    document.head.appendChild(el)
  }
  if (el.dataset.set !== set.id) {
    el.textContent = set.css
    el.dataset.set = set.id
  }
}
