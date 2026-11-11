import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Pause, Play, RotateCcw, Send, SkipForward, Square, Volume2, VolumeX, RefreshCw, AlertTriangle, Users } from 'lucide-react'
import type { ExplainMode, ProviderStatus } from '@shared/types'
import { api } from '../lib/api'
import { useApp, useSettings } from '../lib/store'
import { currentMove, positionKey, useGame } from '../lib/game'
import { cancelCoach, explain, speakItem, useCoach, type ThreadItem } from '../lib/coach'
import { speech, useSpeech } from '../lib/speech'
import { CoachAvatar } from './chess'
import { Button, cx, IconButton, Select } from './ui'

const QUICK = ['Why?', 'Explain that more simply', 'What should I have played?', 'Show me the continuation', 'How do I spot this next time?']

const MODES: { value: ExplainMode; label: string }[] = [
  { value: 'every', label: 'Explain every move' },
  { value: 'important', label: 'Only important moves' },
  { value: 'mistakes', label: 'Only mistakes and blunders' },
  { value: 'manual', label: 'Only when I ask' }
]

export function VoicePlayer(): ReactNode {
  const s = useSettings()
  const update = useApp((a) => a.update)
  const { status, error, canReplay } = useSpeech()
  const items = useCoach((c) => c.items)
  const lastCoach = [...items].reverse().find((i) => i.role === 'coach' && i.text)
  const active = status === 'playing' || status === 'paused' || status === 'loading'
  return (
    <div className="border-t border-line bg-surface-2 px-3 py-2">
      <div className="flex items-center gap-1">
        {status === 'playing' ? (
          <IconButton label="Pause" onClick={() => speech.pause()}>
            <Pause size={16} />
          </IconButton>
        ) : status === 'paused' ? (
          <IconButton label="Resume" onClick={() => speech.resume()}>
            <Play size={16} />
          </IconButton>
        ) : (
          <IconButton
            label="Play"
            disabled={!lastCoach || s.muted}
            onClick={() => {
              if (canReplay) speech.replay()
              else if (lastCoach) speakItem(lastCoach)
            }}
          >
            <Play size={16} />
          </IconButton>
        )}
        <IconButton label="Stop" disabled={!active} onClick={() => speech.stop()}>
          <Square size={14} />
        </IconButton>
        <IconButton
          label="Replay"
          disabled={!lastCoach || s.muted}
          onClick={() => {
            if (canReplay) speech.replay()
            else if (lastCoach) speakItem(lastCoach)
          }}
        >
          <RotateCcw size={15} />
        </IconButton>
        <IconButton label="Skip this explanation" disabled={!active && !useCoach.getState().busy} onClick={() => cancelCoach()}>
          <SkipForward size={15} />
        </IconButton>
        <div className="mx-1.5 flex h-5 w-9 items-center justify-center">
          {status === 'playing' || status === 'paused' ? (
            <span className={cx('speaking', status === 'paused' && 'paused')}>
              <i />
              <i />
              <i />
              <i />
            </span>
          ) : status === 'loading' ? (
            <span className="typing">
              <span />
              <span />
              <span />
            </span>
          ) : null}
        </div>
        <div className="flex-1" />
        <IconButton label={s.muted ? 'Unmute' : 'Mute'} active={s.muted} onClick={() => void update({ muted: !s.muted })}>
          {s.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </IconButton>
        <input type="range" min={0} max={1} step={0.05} value={s.volume} onChange={(e) => void update({ volume: Number(e.target.value) })} aria-label="Volume" className="!w-20" />
        <Select
          label="Speech speed"
          className="!h-7 !w-[74px] !px-1.5 text-[12px]"
          value={String(s.speechSpeed)}
          onChange={(v) => void update({ speechSpeed: Number(v) })}
          options={['0.8', '0.9', '1', '1.1', '1.25', '1.5'].map((v) => ({ value: v, label: `${v}×` }))}
        />
      </div>
      {error && (
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[12px] text-warn">
          <span className="selectable truncate">{error}</span>
          <button className="shrink-0 underline" onClick={() => useApp.getState().setView('settings', 'voice')}>
            Voice settings
          </button>
        </div>
      )}
    </div>
  )
}

function Message({ item, current }: { item: ThreadItem; current: boolean }): ReactNode {
  const coaches = useApp((a) => a.coaches)
  const goto = useGame((g) => g.goto)
  const coach = coaches.find((c) => c.id === item.coachId)
  const ply = item.positionKey.startsWith('ply:') ? Number(item.positionKey.slice(4)) : null
  if (item.role === 'user') {
    return (
      <div className="fade-up flex justify-end">
        <div className="selectable max-w-[85%] rounded-lg rounded-br-sm bg-accent-soft px-3 py-2">{item.text}</div>
      </div>
    )
  }
  return (
    <div className={cx('fade-up flex gap-2.5', !current && 'opacity-70')}>
      {coach && <CoachAvatar coach={coach} size={28} />}
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-2 text-[12px] text-ink-3">
          <span className="font-semibold text-ink-2">{coach?.name ?? 'Coach'}</span>
          {item.label &&
            (ply !== null ? (
              <button className="num rounded bg-surface-3 px-1.5 hover:text-ink" onClick={() => goto(ply)} title="Go to this move">
                {item.label}
              </button>
            ) : (
              <span className="num rounded bg-surface-3 px-1.5">{item.label} · variation</span>
            ))}
        </div>
        {item.error ? (
          <div className="selectable rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-[13px]">{item.error}</div>
        ) : (
          <div className="selectable whitespace-pre-wrap leading-relaxed">
            {item.text}
            {item.streaming && !item.text && (
              <span className="typing">
                <span />
                <span />
                <span />
              </span>
            )}
          </div>
        )}
        {item.unverified.length > 0 && (
          <div className="mt-1 flex items-start gap-1.5 text-[12px] text-warn">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>
              Mentions {item.unverified.join(', ')}, which {item.unverified.length === 1 ? 'is' : 'are'} not in the engine analysis for this move. Treat that part with caution.
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

export function CoachPanel(): ReactNode {
  const s = useSettings()
  const { coaches, update, setView } = useApp()
  const game = useGame()
  const { items, busy } = useCoach()
  const [text, setText] = useState('')
  const [status, setStatus] = useState<ProviderStatus | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const coach = coaches.find((c) => c.id === s.coachId) ?? coaches[0]
  const move = currentMove(game)
  const key = positionKey(game)

  useEffect(() => {
    let alive = true
    void api.ai.status().then((st) => {
      if (!alive) return
      setStatus(st)
      useCoach.setState({ aiReady: st.ok })
    })
    return () => {
      alive = false
    }
  }, [s.provider.kind, s.provider.model, s.provider.baseUrl])

  const lastLen = items[items.length - 1]?.text.length ?? 0
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items.length, lastLen])

  const ask = (q: string): void => {
    const question = q.trim()
    if (!question || !move) return
    setText('')
    void explain({ question })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2.5 border-b border-line px-3 py-2.5">
        {coach && <CoachAvatar coach={coach} size={34} />}
        <div className="min-w-0 flex-1">
          <Select label="Coach" className="!h-7 !border-transparent !bg-transparent !px-0 font-semibold" value={s.coachId} onChange={(v) => void update({ coachId: v })} options={coaches.map((c) => ({ value: c.id, label: c.name }))} />
          <div className="truncate text-[12px] text-ink-3">{coach?.tagline}</div>
        </div>
        <IconButton label="Choose a coach" onClick={() => setView('coaches')}>
          <Users size={16} />
        </IconButton>
      </div>

      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[12.5px]">
        <Select
          label="When to explain"
          className="!h-7 flex-1 text-[12.5px]"
          value={s.autoExplain ? s.explainMode : 'manual'}
          onChange={(v) => void update(v === 'manual' ? { autoExplain: false } : { autoExplain: true, explainMode: v })}
          options={MODES}
        />
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-ink-2">
          <input type="checkbox" checked={s.autoSpeak} onChange={(e) => void update({ autoSpeak: e.target.checked })} className="accent-[var(--accent)]" />
          Speak
        </label>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-3 py-3">
        {status && !status.ok && (
          <div className="rounded-md border border-line bg-surface-2 px-3 py-2.5 text-[13px]">
            <div className="mb-1 font-semibold">The coach has no AI model yet</div>
            <div className="selectable text-ink-2">{status.message}</div>
            <div className="mt-2 text-ink-3">Engine analysis, classifications and best moves work without it.</div>
            <Button size="sm" variant="primary" className="mt-2" onClick={() => setView('settings', 'ai')}>
              Set up the AI coach
            </Button>
          </div>
        )}
        {status?.remote && (
          <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-1.5 text-[12.5px]">Cloud provider in use: positions and questions are sent to {new URL(s.provider.baseUrl).hostname}.</div>
        )}
        {items.length === 0 && (!status || status.ok) && (
          <div className="px-2 py-6 text-center text-ink-3">
            {!game.review && !game.variation ? 'Run a review, then select a move: your coach explains it using the engine analysis.' : 'Select a move and your coach will explain it.'}
          </div>
        )}
        {items.map((it) => (
          <Message key={it.id} item={it} current={it.positionKey === key} />
        ))}
      </div>

      <VoicePlayer />

      <div className="border-t border-line px-3 pb-3 pt-2">
        <div className="mb-2 flex flex-wrap gap-1">
          {QUICK.map((q) => (
            <button key={q} disabled={!move} onClick={() => ask(q)} className="rounded-full border border-line px-2 py-0.5 text-[12px] text-ink-2 hover:border-line-strong hover:text-ink disabled:opacity-40">
              {q}
            </button>
          ))}
          <button disabled={!move} onClick={() => void explain({ regenerate: true })} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[12px] text-ink-2 hover:border-line-strong hover:text-ink disabled:opacity-40" title="Generate a fresh explanation of this move">
            <RefreshCw size={11} /> Explain again
          </button>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            ask(text)
          }}
        >
          <input className="field" placeholder={move ? `Ask about ${move.san}…` : 'Select a move to ask about it'} value={text} disabled={!move} onChange={(e) => setText(e.target.value)} aria-label="Ask the coach" />
          {busy ? (
            <Button type="button" onClick={() => cancelCoach()} icon={<Square size={13} />}>
              Stop
            </Button>
          ) : (
            <Button type="submit" variant="primary" disabled={!move || !text.trim()} icon={<Send size={14} />}>
              Ask
            </Button>
          )}
        </form>
      </div>
    </div>
  )
}
