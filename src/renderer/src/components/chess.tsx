import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Chess, type Square } from 'chess.js'
import { Chessground } from '@lichess-org/chessground'
import type { Api as CgApi } from '@lichess-org/chessground/api'
import type { DrawShape } from '@lichess-org/chessground/draw'
import type { Key } from '@lichess-org/chessground/types'
import type { Classification, Score } from '@shared/types'
import { CLASS_LABEL } from '@shared/classify'
import { formatScore, scoreToCpForDisplay, winPercentWhite } from '@shared/eval'
import type { CoachProfile } from '@shared/coach'
import { glyphMask, pieceImage } from '../lib/themes'
import { cx } from './ui'

// ---------- Classification icons (original artwork: one distinct shape per class) ----------

export const CLASS_COLOR: Record<Classification, string> = {
  brilliant: '#1fb8a4',
  great: '#4f8fd6',
  best: '#6fae58',
  excellent: '#8dbb62',
  good: '#93a889',
  book: '#b08d5c',
  inaccuracy: '#e2b53a',
  mistake: '#e68a2e',
  missed_win: '#d66a97',
  blunder: '#d64b47',
  forced: '#8a9099'
}

const SHAPE: Record<Classification, ReactNode> = {
  // four-point star
  brilliant: <path d="M12 1l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" />,
  // hexagon
  great: <path d="M12 1.5l9 5.2v10.6l-9 5.2-9-5.2V6.7z" />,
  // circle
  best: <circle cx="12" cy="12" r="10.5" />,
  // rounded square
  excellent: <rect x="2" y="2" width="20" height="20" rx="6" />,
  // pill
  good: <rect x="1.5" y="5" width="21" height="14" rx="7" />,
  // book tab
  book: <path d="M3 3h18v15l-9 4-9-4z" />,
  // triangle
  inaccuracy: <path d="M12 2l11 19H1z" />,
  // diamond
  mistake: <path d="M12 1l11 11-11 11L1 12z" />,
  // shield
  missed_win: <path d="M12 1.5l9.5 3.5v7c0 5.2-3.9 9-9.5 10.5C6.4 21 2.500 17.200 2.500 12V5z" />,
  // octagon
  blunder: <path d="M7.5 1.5h9l6 6v9l-6 6h-9l-6-6v-9z" />,
  // square
  forced: <rect x="2.5" y="2.5" width="19" height="19" rx="2" />
}

const GLYPH: Record<Classification, string> = {
  brilliant: '!!',
  great: '!',
  best: '★',
  excellent: '✓',
  good: '+',
  book: '≡',
  inaccuracy: '?!',
  mistake: '?',
  missed_win: '×',
  blunder: '??',
  forced: '→'
}

export function ClassIcon({ c, size = 16, className }: { c: Classification; size?: number; className?: string }): ReactNode {
  const glyph = GLYPH[c]
  const dy = c === 'inaccuracy' ? 18.5 : c === 'book' ? 15 : 16.2
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} role="img" aria-label={CLASS_LABEL[c]}>
      <title>{CLASS_LABEL[c]}</title>
      <g fill={CLASS_COLOR[c]}>{SHAPE[c]}</g>
      <text x="12" y={dy} textAnchor="middle" fontSize={glyph.length > 1 ? (c === 'inaccuracy' ? 8.5 : 11) : 12} fontWeight="800" fill="#fff" fontFamily="system-ui, sans-serif">
        {glyph}
      </text>
    </svg>
  )
}

// ---------- Board ----------

export interface Arrow {
  from: string
  to: string
  brush: 'best' | 'alt' | 'played' | 'threat'
}

interface BoardProps {
  fen: string
  orientation: 'white' | 'black'
  lastMove?: string | null
  arrows?: Arrow[]
  badge?: { square: string; classification: Classification } | null
  coordinates?: boolean
  interactive?: boolean
  onMove?: (from: string, to: string, promotion?: string) => boolean
}

function dests(chess: Chess): Map<Key, Key[]> {
  const map = new Map<Key, Key[]>()
  for (const m of chess.moves({ verbose: true })) {
    const list = map.get(m.from as Key) ?? []
    list.push(m.to as Key)
    map.set(m.from as Key, list)
  }
  return map
}

const BRUSHES = {
  best: { key: 'best', color: '#4f9d5d', opacity: 0.85, lineWidth: 11 },
  alt: { key: 'alt', color: '#5b8fd9', opacity: 0.55, lineWidth: 8 },
  played: { key: 'played', color: '#d9534f', opacity: 0.6, lineWidth: 9 },
  threat: { key: 'threat', color: '#e68a2e', opacity: 0.6, lineWidth: 8 },
  // user-drawn (right-click) brushes
  green: { key: 'g', color: '#15781B', opacity: 1, lineWidth: 10 },
  red: { key: 'r', color: '#882020', opacity: 1, lineWidth: 10 },
  blue: { key: 'b', color: '#003088', opacity: 1, lineWidth: 10 },
  yellow: { key: 'y', color: '#e68f00', opacity: 1, lineWidth: 10 }
}

export function Board({ fen, orientation, lastMove, arrows = [], badge, coordinates = true, interactive = true, onMove }: BoardProps): ReactNode {
  const host = useRef<HTMLDivElement>(null)
  const cg = useRef<CgApi | null>(null)
  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove
  const fenRef = useRef(fen)
  fenRef.current = fen
  const [promo, setPromo] = useState<{ from: string; to: string; color: 'w' | 'b' } | null>(null)

  const sync = (): void => {
    const api = cg.current
    if (!api) return
    const f = fenRef.current
    const chess = new Chess(f)
    const turn = chess.turn() === 'w' ? 'white' : 'black'
    api.set({
      fen: f,
      turnColor: turn,
      check: chess.isCheck() ? turn : false,
      movable: { color: interactive ? turn : undefined, dests: interactive ? dests(chess) : new Map() }
    })
  }

  useEffect(() => {
    if (!host.current) return
    cg.current = Chessground(host.current, {
      fen,
      orientation,
      coordinates,
      animation: { enabled: true, duration: 170 },
      highlight: { lastMove: true, check: true },
      movable: { free: false, showDests: true },
      premovable: { enabled: false },
      draggable: { enabled: true, showGhost: true },
      drawable: { enabled: true, visible: true, brushes: BRUSHES as never },
      events: {
        move: (orig, dest) => {
          const chess = new Chess(fenRef.current)
          const piece = chess.get(orig as Square)
          const isPromo = piece?.type === 'p' && (dest[1] === '8' || dest[1] === '1')
          if (isPromo) {
            setPromo({ from: orig, to: dest, color: piece.color })
            return
          }
          const ok = onMoveRef.current?.(orig, dest) ?? false
          if (!ok) sync()
        }
      }
    })
    sync()
    return () => {
      cg.current?.destroy()
      cg.current = null
    }
    // The board instance is created once; later changes go through set().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setPromo(null)
    sync()
    cg.current?.set({ lastMove: lastMove ? [lastMove.slice(0, 2) as Key, lastMove.slice(2, 4) as Key] : undefined })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, lastMove, interactive])

  useEffect(() => {
    cg.current?.set({ orientation, coordinates })
  }, [orientation, coordinates])

  const shapeKey = arrows.map((a) => a.from + a.to + a.brush).join('|')
  useEffect(() => {
    const shapes: DrawShape[] = arrows.map((a) => ({ orig: a.from as Key, dest: a.to as Key, brush: a.brush }))
    cg.current?.setAutoShapes(shapes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeKey, fen])

  const badgePos = useMemo(() => {
    if (!badge) return null
    const file = badge.square.charCodeAt(0) - 97
    const rank = Number(badge.square[1]) - 1
    const x = orientation === 'white' ? file : 7 - file
    const y = orientation === 'white' ? 7 - rank : rank
    return { left: `${(x + 0.86) * 12.5}%`, top: `${(y + 0.14) * 12.5}%` }
  }, [badge, orientation])

  const finishPromo = (piece: string | null): void => {
    const p = promo
    setPromo(null)
    if (!p) return
    const ok = piece ? (onMoveRef.current?.(p.from, p.to, piece) ?? false) : false
    if (!ok) sync()
  }

  return (
    <div className="board-shell">
      <div ref={host} className="cg-wrap" />
      {badge && badgePos && (
        <div className="sq-badge" style={badgePos} key={badge.square + badge.classification + fen}>
          <ClassIcon c={badge.classification} size={26} className="fade-up h-full w-full" />
        </div>
      )}
      {promo && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/45" onMouseDown={() => finishPromo(null)}>
          <div className="fade-up flex gap-1 rounded-lg border border-line bg-surface p-2" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Choose promotion piece">
            {(['q', 'r', 'b', 'n'] as const).map((p) => (
              <button
                key={p}
                aria-label={`Promote to ${{ q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[p]}`}
                className="h-16 w-16 rounded-md bg-surface-2 bg-contain bg-center bg-no-repeat hover:bg-surface-3"
                style={{ backgroundImage: pieceImage(({ q: 'queen', r: 'rook', b: 'bishop', n: 'knight' } as const)[p], promo.color === 'w' ? 'white' : 'black') }}
                onClick={() => finishPromo(p)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- Evaluation bar ----------

export function EvalBar({ score, orientation }: { score: Score | null; orientation: 'white' | 'black' }): ReactNode {
  const white = score ? winPercentWhite(score) : 50
  const label = score ? formatScore(score).replace(/^\+/, '') : '–'
  const whiteAhead = score ? scoreToCpForDisplay(score) >= 0 : true
  const flipped = orientation === 'black'
  return (
    <div className="relative h-full w-7 overflow-hidden rounded-[3px]" style={{ background: 'var(--eval-black)', boxShadow: '0 0 0 1px var(--line)' }} role="img" aria-label={score ? `Evaluation ${formatScore(score)}` : 'No evaluation yet'}>
      <div
        className="absolute left-0 right-0 transition-[height] duration-500 ease-out"
        style={{ background: 'var(--eval-white)', height: `${white}%`, [flipped ? 'top' : 'bottom']: 0 }}
      />
      <div className="absolute left-0 right-0 top-1/2 h-px bg-accent/70" />
      <div
        className={cx('num absolute left-0 right-0 text-center text-[10px] font-bold', (whiteAhead ? !flipped : flipped) ? 'bottom-1' : 'top-1')}
        style={{ color: whiteAhead ? '#2a2d31' : '#ece8df' }}
      >
        {label}
      </div>
    </div>
  )
}

// ---------- Evaluation graph ----------

export function EvalGraph({ evals, cursor, marks, onSelect, total }: { evals: (Score | null)[]; cursor: number; marks: { ply: number; c: Classification }[]; onSelect: (ply: number) => void; total: number }): ReactNode {
  const W = 600
  const H = 84
  const n = Math.max(1, total)
  const x = (i: number): number => (i / n) * W
  const y = (s: Score | null): number => H - ((s ? winPercentWhite(s) : 50) / 100) * H
  const known = evals.map((s, i) => ({ s, i })).filter((p) => p.s)
  const line = known.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)} ${y(p.s).toFixed(1)}`).join(' ')
  const area = known.length ? `${line} L${x(known[known.length - 1].i).toFixed(1)} ${H} L${x(known[0].i).toFixed(1)} ${H} Z` : ''
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-[84px] w-full cursor-pointer rounded-[3px]"
      style={{ background: 'var(--eval-black)' }}
      role="img"
      aria-label="Evaluation over the game. Click to jump to a move."
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        onSelect(Math.round(((e.clientX - r.left) / r.width) * n))
      }}
    >
      {area && <path d={area} fill="var(--eval-white)" opacity="0.92" />}
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="var(--accent)" strokeWidth="1" opacity="0.6" vectorEffect="non-scaling-stroke" />
      {marks.map((m) => (
        <circle key={m.ply} cx={x(m.ply)} cy={y(evals[m.ply] ?? null)} r="3.2" fill={CLASS_COLOR[m.c]} stroke="var(--surface)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      ))}
      <line x1={x(cursor)} x2={x(cursor)} y1="0" y2={H} stroke="var(--info)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

// ---------- Coach avatar ----------

export function CoachAvatar({ coach, size = 40, ring }: { coach: Pick<CoachProfile, 'avatar' | 'name'>; size?: number; ring?: boolean }): ReactNode {
  const a = coach.avatar
  return (
    <div
      className={cx('relative shrink-0 overflow-hidden rounded-full', ring && 'ring-2 ring-accent ring-offset-2 ring-offset-[var(--surface)]')}
      style={{ width: size, height: size, background: `linear-gradient(160deg, ${a.color}, color-mix(in srgb, ${a.color} 55%, #000))` }}
      aria-hidden
    >
      {a.image ? (
        <img src={a.image} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-[16%]" style={{ background: 'rgba(255,255,255,0.92)', WebkitMaskImage: glyphMask(a.glyph), maskImage: glyphMask(a.glyph), WebkitMaskSize: 'contain', maskSize: 'contain', WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat', WebkitMaskPosition: 'center', maskPosition: 'center' }} />
      )}
    </div>
  )
}
