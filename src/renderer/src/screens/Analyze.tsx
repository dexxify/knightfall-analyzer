import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Copy, Download, FlipVertical2, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Play, Undo2, X, Zap } from 'lucide-react'
import type { Classification, ReviewPreset } from '@shared/types'
import { CLASS_LABEL, CLASSIFICATIONS } from '@shared/classify'
import { formatScore } from '@shared/eval'
import { numberLine } from '@shared/pgn'
import { api, errorText } from '../lib/api'
import { useApp, useSettings } from '../lib/store'
import { currentEval, currentFen, currentMove, useGame } from '../lib/game'
import { Board, ClassIcon, CLASS_COLOR, EvalBar, EvalGraph, type Arrow } from '../components/chess'
import { CoachPanel } from '../components/CoachPanel'
import { Button, cx, Empty, IconButton, ProgressBar, Select } from '../components/ui'

function PlayerBar({ name, elo, color, accuracy, isYou, onPick }: { name: string; elo: string | null; color: 'w' | 'b'; accuracy: number | null; isYou: boolean; onPick: () => void }): ReactNode {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className="h-3.5 w-3.5 rounded-sm border border-line-strong" style={{ background: color === 'w' ? '#f1ede4' : '#26282b' }} />
      <span className="selectable truncate font-semibold">{name}</span>
      {elo && <span className="num text-ink-3">{elo}</span>}
      <button onClick={onPick} className={cx('rounded px-1.5 py-0.5 text-[11.5px] font-semibold', isYou ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:text-ink')} title="Tell the coach which side you played">
        {isYou ? 'You' : 'I played this side'}
      </button>
      <div className="flex-1" />
      {accuracy !== null && (
        <span className="num text-[13px] text-ink-2">
          <span className="text-ink-3">Accuracy</span> <span className="font-semibold text-ink">{accuracy.toFixed(1)}</span>
        </span>
      )}
    </div>
  )
}

function MoveCell({ san, cls, active, onClick, dim }: { san: string; cls: Classification | null; active: boolean; onClick: () => void; dim?: boolean }): ReactNode {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])
  return (
    <button ref={ref} onClick={onClick} className={cx('flex h-7 items-center gap-1.5 rounded px-1.5 text-left transition-colors', active ? 'bg-accent-soft font-semibold text-ink' : 'hover:bg-surface-2', dim && 'text-ink-2')}>
      <span className="flex w-4 justify-center">{cls && !['best', 'excellent', 'good', 'book', 'forced'].includes(cls) ? <ClassIcon c={cls} size={14} /> : cls ? <span className="h-1.5 w-1.5 rounded-full" style={{ background: CLASS_COLOR[cls] }} title={CLASS_LABEL[cls]} /> : null}</span>
      <span className="num">{san}</span>
    </button>
  )
}

function MoveList(): ReactNode {
  const { loaded, cursor, variation, review, goto, varGoto, exitVariation } = useGame()
  if (!loaded) return null
  const plies = loaded.game.plies
  const rows: ReactNode[] = []
  const varBlock = variation && (
    <div key="var" className="my-1 rounded-md border border-info/35 bg-info/8 px-2 py-1.5">
      <div className="mb-1 flex items-center justify-between text-[12px] text-info">
        <span className="font-semibold">Your variation</span>
        <button className="inline-flex items-center gap-1 underline" onClick={exitVariation}>
          <Undo2 size={12} /> Back to the game
        </button>
      </div>
      <div className="flex flex-wrap gap-x-0.5">
        {variation.moves.map((m, i) => (
          <button key={i} onClick={() => varGoto(i + 1)} className={cx('num rounded px-1 py-0.5', variation.cursor === i + 1 ? 'bg-info/25 font-semibold' : 'hover:bg-surface-2')}>
            {(m.color === 'w' || i === 0) && <span className="text-ink-3">{m.fenBefore.split(' ')[5]}{m.color === 'w' ? '.' : '…'} </span>}
            {m.san}
          </button>
        ))}
      </div>
    </div>
  )
  const first = plies[0]
  const offset = first.color === 'b' ? 1 : 0
  const count = Math.ceil((plies.length + offset) / 2)
  for (let r = 0; r < count; r++) {
    const wi = r * 2 - offset
    const bi = wi + 1
    const w = wi >= 0 ? plies[wi] : null
    const b = plies[bi] ?? null
    rows.push(
      <div key={r} className="grid grid-cols-[34px_1fr_1fr] items-center">
        <span className="num text-right text-[12px] text-ink-3">{(w ?? b)!.moveNumber}.</span>
        {w ? <MoveCell san={w.san} cls={review?.moves[wi]?.classification ?? null} active={!variation && cursor === wi + 1} onClick={() => goto(wi + 1)} /> : <span className="px-2 text-ink-3">…</span>}
        {b ? <MoveCell san={b.san} cls={review?.moves[bi]?.classification ?? null} active={!variation && cursor === bi + 1} onClick={() => goto(bi + 1)} /> : <span />}
      </div>
    )
    if (variation && (variation.basePly === wi + 1 || variation.basePly === bi + 1 || (variation.basePly === 0 && r === 0))) {
      if (variation.basePly === 0 && r === 0) rows.unshift(varBlock)
      else rows.push(varBlock)
    }
  }
  return <div className="px-2 py-2 text-[13.5px]">{rows}</div>
}

function ReviewSummary(): ReactNode {
  const { loaded, review, cursor, goto } = useGame()
  if (!loaded || !review) return <Empty title="No review yet">Start a review to see accuracy, move classifications and key moments.</Empty>
  const jump = (c: Classification, color: 'w' | 'b'): void => {
    const hits = review.moves.filter((m) => m.classification === c && m.color === color).map((m) => m.ply)
    if (hits.length) goto(hits.find((p) => p > cursor) ?? hits[0])
  }
  const shown = CLASSIFICATIONS.filter((c) => review.counts.white[c] + review.counts.black[c] > 0 || ['best', 'inaccuracy', 'mistake', 'blunder'].includes(c))
  return (
    <div className="px-3 py-3">
      <div className="grid grid-cols-[1fr_64px_64px] items-center gap-y-0.5">
        <span className="text-[12px] text-ink-3">{loaded.game.plies.length} moves · {review.engineName} · depth {review.depth}</span>
        <span className="text-center text-[12px] text-ink-3">White</span>
        <span className="text-center text-[12px] text-ink-3">Black</span>
        <span className="py-1 font-semibold">Accuracy</span>
        <span className="num text-center text-[16px] font-semibold">{review.accuracy.white.toFixed(1)}</span>
        <span className="num text-center text-[16px] font-semibold">{review.accuracy.black.toFixed(1)}</span>
        {shown.map((c) => (
          <div key={c} className="contents">
            <span className="flex items-center gap-2 py-0.5">
              <ClassIcon c={c} size={16} /> {CLASS_LABEL[c]}
            </span>
            {(['w', 'b'] as const).map((color) => {
              const n = review.counts[color === 'w' ? 'white' : 'black'][c]
              return (
                <button key={color} disabled={n === 0} onClick={() => jump(c, color)} className={cx('num rounded py-0.5 text-center', n ? 'font-semibold hover:bg-surface-2' : 'text-ink-3')} title={n ? `Jump to the next ${CLASS_LABEL[c].toLowerCase()}` : undefined}>
                  {n}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12px] leading-snug text-ink-3">Accuracy is computed from the change in win probability on each move (the method Lichess publishes), weighted towards the volatile moments of the game.</p>
      {review.keyMoments.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 font-semibold">Key moments</div>
          <div className="space-y-0.5">
            {review.keyMoments.map((ply) => {
              const m = review.moves[ply - 1]
              const p = loaded.game.plies[ply - 1]
              return (
                <button key={ply} onClick={() => goto(ply)} className={cx('flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-surface-2', cursor === ply && 'bg-accent-soft')}>
                  <ClassIcon c={m.classification} size={16} />
                  <span className="num w-20 font-semibold">{p.moveNumber}{p.color === 'w' ? '.' : '…'} {p.san}</span>
                  <span className="truncate text-[12.5px] text-ink-2">{CLASS_LABEL[m.classification]}{m.bestSan && m.bestUci !== m.uci ? ` · best ${m.bestSan}` : ''}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function EnginePanel(): ReactNode {
  const { live, liveError, playMove } = useGame()
  const game = useGame()
  const setView = useApp((a) => a.setView)
  const engine = useApp((a) => a.engine)
  const fen = currentFen(game)
  const move = currentMove(game)
  if (!engine?.installed) {
    return (
      <div className="px-3 py-3 text-[13px]">
        <div className="mb-1 font-semibold">Stockfish is not installed</div>
        <div className="text-ink-2">Install the engine to analyse positions and review games.</div>
        <Button size="sm" variant="primary" className="mt-2" onClick={() => setView('settings', 'engine')}>
          Install Stockfish
        </Button>
      </div>
    )
  }
  return (
    <div className="px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between text-[12px] text-ink-3">
        <span className="truncate">{engine.name}</span>
        <span className="num">{live?.terminal ? 'Game over' : live ? `depth ${live.depth}${live.lines[0]?.nps ? ` · ${(live.lines[0].nps / 1e6).toFixed(1)}M nodes/s` : ''}` : liveError ? '' : 'thinking…'}</span>
      </div>
      {liveError && <div className="selectable text-[13px] text-bad">{liveError}</div>}
      {live?.terminal && <div className="text-ink-2">{live.terminal === 'checkmate' ? 'Checkmate.' : live.terminal === 'stalemate' ? 'Stalemate.' : 'Draw by insufficient material.'}</div>}
      {move?.review && (
        <div className="mb-2 flex items-start gap-2 rounded-md bg-surface-2 px-2.5 py-2">
          <ClassIcon c={move.review.classification} size={18} className="mt-0.5 shrink-0" />
          <div className="min-w-0 text-[13px]">
            <div className="font-semibold">
              {move.san} — {CLASS_LABEL[move.review.classification]}
            </div>
            <div className="selectable text-ink-2">{move.review.reason}</div>
            {move.review.bestSan && move.review.bestUci !== move.review.uci && (
              <div className="selectable num mt-0.5 text-ink-2">
                Best: <span className="font-semibold text-ink">{numberLine(move.fenBefore, move.review.bestLineSan.slice(0, 6))}</span>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="space-y-1">
        {fen &&
          live?.lines.map((l) => (
            <button
              key={l.multipv}
              onClick={() => l.pv[0] && playMove(l.pv[0].slice(0, 2), l.pv[0].slice(2, 4), l.pv[0][4])}
              className="flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left hover:bg-surface-2"
              title="Play this move on the board to explore the line"
            >
              <span className={cx('num w-12 shrink-0 rounded px-1 text-center text-[12px] font-bold', (l.score.type === 'mate' ? l.score.value > 0 : l.score.value >= 0) ? 'bg-[var(--eval-white)] text-[#22252a]' : 'bg-[var(--eval-black)] text-[#ece8df] ring-1 ring-line')}>
                {formatScore(l.score)}
              </span>
              <span className="num selectable truncate text-[13px]">{numberLine(fen, l.pvSan.slice(0, 9))}</span>
            </button>
          ))}
      </div>
    </div>
  )
}

export function Analyze(): ReactNode {
  const s = useSettings()
  const { update, toast, setImportOpen, setView } = useApp()
  const game = useGame()
  const { loaded, cursor, variation, review, reviewProgress, orientation, live } = game
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [tab, setTab] = useState<'moves' | 'review'>('moves')
  const [preset, setPreset] = useState<ReviewPreset['id']>(s.defaultPreset)
  const [menu, setMenu] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return
      const g = useGame.getState()
      if (!g.loaded) return
      if (e.key === 'ArrowLeft') g.step(-1)
      else if (e.key === 'ArrowRight') g.step(1)
      else if (e.key === 'Home' || e.key === 'ArrowUp') (g.variation ? g.exitVariation() : g.goto(0))
      else if (e.key === 'End' || e.key === 'ArrowDown') g.goto(g.loaded.game.plies.length)
      else if (e.key.toLowerCase() === 'f') g.flip()
      else if (e.key === 'Escape' && g.variation) g.exitVariation()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (review) setTab('review')
    // Show the summary when a review finishes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review?.createdAt])

  const fen = currentFen(game)
  const move = currentMove(game)
  const score = currentEval(game)

  const arrows = useMemo<Arrow[]>(() => {
    if (!s.showBestArrow || !live || live.terminal) return []
    return live.lines.slice(0, 2).flatMap((l, i): Arrow[] => (l.pv[0] ? [{ from: l.pv[0].slice(0, 2), to: l.pv[0].slice(2, 4), brush: i === 0 ? 'best' : 'alt' }] : []))
  }, [live, s.showBestArrow])

  const marks = useMemo(
    () => (review ? review.moves.filter((m) => ['blunder', 'mistake', 'missed_win', 'brilliant', 'great'].includes(m.classification)).map((m) => ({ ply: m.ply, c: m.classification })) : []),
    [review]
  )

  if (!loaded || !fen) {
    return (
      <div className="flex h-full items-center justify-center">
        <Empty
          title="No game open"
          action={
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => setImportOpen(true)}>
                Import a game
              </Button>
              <Button onClick={() => setView('library')}>Open the library</Button>
            </div>
          }
        >
          Import a game from Chess.com, Lichess or a PGN file, then review it move by move with Stockfish and your coach.
        </Empty>
      </div>
    )
  }

  const rec = loaded.record
  const top = orientation === 'white' ? 'b' : 'w'
  const players = {
    w: { name: rec.white, elo: rec.whiteElo, acc: review?.accuracy.white ?? null },
    b: { name: rec.black, elo: rec.blackElo, acc: review?.accuracy.black ?? null }
  }
  const bar = (c: 'w' | 'b'): ReactNode => <PlayerBar name={players[c].name} elo={players[c].elo} color={c} accuracy={players[c].acc} isYou={game.playerColor === c} onPick={() => game.setPlayerColor(c)} />
  const total = loaded.game.plies.length
  const copy = async (what: 'fen' | 'pgn' | 'apgn'): Promise<void> => {
    try {
      if (what === 'fen') await navigator.clipboard.writeText(fen)
      else await api.games.copyPgn(rec.id, what === 'apgn')
      toast('success', what === 'fen' ? 'FEN copied' : 'PGN copied')
    } catch (e) {
      toast('error', errorText(e))
    }
    setMenu(false)
  }
  const exportFile = async (kind: 'pgn' | 'apgn' | 'json'): Promise<void> => {
    setMenu(false)
    try {
      const file = kind === 'json' ? await api.games.exportAnalysis(rec.id) : await api.games.exportPgn(rec.id, kind === 'apgn')
      if (file) toast('success', `Saved to ${file}`)
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  return (
    <div className="flex h-full min-h-0">
      {/* LEFT: moves, review, metadata */}
      {leftOpen && (
        <aside className="flex w-[300px] shrink-0 flex-col border-r border-line bg-surface">
          <div className="border-b border-line px-3 py-2.5">
            <div className="selectable truncate text-[13px] text-ink-2">{loaded.opening ? `${loaded.opening.eco} · ${loaded.opening.name}` : (rec.opening ?? 'Opening not identified')}</div>
            <div className="selectable mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-ink-3">
              {rec.event && <span>{rec.event}</span>}
              {rec.date && <span>{rec.date}</span>}
              {rec.timeControl && <span>{rec.timeControl}</span>}
              <span className="font-semibold text-ink-2">{rec.result}</span>
            </div>
          </div>
          <div className="flex border-b border-line text-[13px]">
            {(['moves', 'review'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cx('flex-1 py-2 font-semibold capitalize', tab === t ? 'border-b-2 border-accent text-ink' : 'text-ink-3 hover:text-ink')}>
                {t}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{tab === 'moves' ? <MoveList /> : <ReviewSummary />}</div>
        </aside>
      )}

      {/* CENTER: board */}
      <main className="flex min-w-0 flex-1 flex-col items-center px-4 py-3">
        <div className="flex h-full min-h-0 w-full flex-col" style={{ maxWidth: `calc((100vh - 268px) * ${s.boardSize / 100} + 40px)` }}>
          {bar(top)}
          <div className="flex min-h-0 gap-2.5">
            <div className="shrink-0 self-stretch">
              <EvalBar score={score} orientation={orientation} />
            </div>
            <div className="min-w-0 flex-1">
              <Board
                fen={fen}
                orientation={orientation}
                lastMove={move?.uci ?? null}
                arrows={arrows}
                badge={move?.review ? { square: move.uci.slice(2, 4), classification: move.review.classification } : null}
                coordinates={s.showCoordinates}
                onMove={(from, to, promo) => game.playMove(from, to, promo)}
              />
            </div>
          </div>
          {bar(top === 'w' ? 'b' : 'w')}

          <div className="mt-1 flex items-center gap-1">
            <IconButton label={leftOpen ? 'Hide the move panel' : 'Show the move panel'} onClick={() => setLeftOpen(!leftOpen)}>
              {leftOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
            </IconButton>
            <div className="flex-1" />
            <IconButton label="First move (Home)" onClick={() => (variation ? game.exitVariation() : game.goto(0))}>
              <ChevronFirst size={18} />
            </IconButton>
            <IconButton label="Previous move (←)" onClick={() => game.step(-1)}>
              <ChevronLeft size={18} />
            </IconButton>
            <span className="num w-20 text-center text-[12.5px] text-ink-2">{variation ? 'Variation' : `${cursor} / ${total}`}</span>
            <IconButton label="Next move (→)" onClick={() => game.step(1)}>
              <ChevronRight size={18} />
            </IconButton>
            <IconButton label="Last move (End)" onClick={() => game.goto(total)}>
              <ChevronLast size={18} />
            </IconButton>
            <div className="flex-1" />
            <IconButton label="Flip the board (F)" onClick={() => game.flip()}>
              <FlipVertical2 size={16} />
            </IconButton>
            <IconButton label="Show engine arrows" active={s.showBestArrow} onClick={() => void update({ showBestArrow: !s.showBestArrow })}>
              <Zap size={15} />
            </IconButton>
            <div className="relative">
              <IconButton label="Copy and export" active={menu} onClick={() => setMenu(!menu)}>
                <Download size={16} />
              </IconButton>
              {menu && (
                <div className="fade-up absolute bottom-10 right-0 z-20 w-60 rounded-md border border-line bg-surface p-1 shadow-[var(--shadow)]" onMouseLeave={() => setMenu(false)}>
                  {(
                    [
                      ['Copy FEN', () => copy('fen'), Copy],
                      ['Copy PGN', () => copy('pgn'), Copy],
                      ['Copy PGN with analysis', () => copy('apgn'), Copy],
                      ['Export PGN…', () => exportFile('pgn'), Download],
                      ['Export PGN with analysis…', () => exportFile('apgn'), Download],
                      ['Export full analysis (JSON)…', () => exportFile('json'), Download]
                    ] as const
                  ).map(([label, fn, Icon]) => (
                    <button key={label} onClick={() => void fn()} disabled={label.includes('analysis') && !review} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-surface-2 disabled:opacity-40">
                      <Icon size={14} className="text-ink-3" /> {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <IconButton label={rightOpen ? 'Hide the analysis panel' : 'Show the analysis panel'} onClick={() => setRightOpen(!rightOpen)}>
              {rightOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
            </IconButton>
          </div>

          <div className="mt-1.5">
            {reviewProgress ? (
              <div className="flex items-center gap-3 rounded-md border border-line bg-surface px-3 py-2">
                <div className="flex-1">
                  <div className="mb-1 flex justify-between text-[12.5px] text-ink-2">
                    <span>Stockfish is reviewing the game. You can keep browsing.</span>
                    <span className="num">
                      {reviewProgress.done} / {reviewProgress.total}
                    </span>
                  </div>
                  <ProgressBar value={reviewProgress.done / reviewProgress.total} />
                </div>
                <Button size="sm" onClick={() => game.cancelReview()} icon={<X size={13} />}>
                  Cancel
                </Button>
              </div>
            ) : review ? (
              <div>
                <EvalGraph evals={review.evals} cursor={variation ? variation.basePly : cursor} marks={marks} total={total} onSelect={(p) => game.goto(p)} />
                <div className="mt-1 flex items-center justify-end gap-2 text-[12px] text-ink-3">
                  <span>Reviewed with the {review.presetId} preset</span>
                  <Select label="Review depth" className="!h-6 !w-36 !py-0 text-[12px]" value={preset} onChange={setPreset} options={s.presets.map((p) => ({ value: p.id, label: p.label }))} />
                  <button className="underline hover:text-ink" onClick={() => void game.startReview(preset)}>
                    Review again
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2">
                <span className="flex-1 text-[13px] text-ink-2">Analyse every move with Stockfish to get classifications, accuracy and coach explanations.</span>
                <Select label="Review depth" className="!w-40" value={preset} onChange={setPreset} options={s.presets.map((p) => ({ value: p.id, label: p.label }))} />
                <Button variant="primary" icon={<Play size={14} />} onClick={() => void game.startReview(preset)}>
                  Start review
                </Button>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* RIGHT: engine + coach */}
      {rightOpen && (
        <aside className="flex w-[400px] shrink-0 flex-col border-l border-line bg-surface">
          <div className="max-h-[42%] shrink-0 overflow-y-auto border-b border-line">
            <EnginePanel />
          </div>
          <CoachPanel />
        </aside>
      )}
    </div>
  )
}
