import { useEffect, useState, type ReactNode } from 'react'
import { BookOpen, Cloud, LayoutDashboard, Plus, Settings as SettingsIcon, Swords, Users, X } from 'lucide-react'
import type { GameRecord } from '@shared/types'
import { APP_NAME } from '@shared/app'
import { api, errorText } from './lib/api'
import { useApp, type View } from './lib/store'
import { useGame } from './lib/game'
import { startCoachController } from './lib/coach'
import { startBoardSounds } from './lib/sound'
import { Analyze } from './screens/Analyze'
import { GameRow, ImportDialog, Library } from './screens/Library'
import { Coaches } from './screens/Coaches'
import { Settings } from './screens/Settings'
import { SetupWizard } from './screens/SetupWizard'
import { CoachAvatar } from './components/chess'
import { Button, cx, DownloadRow, Spinner } from './components/ui'
import { isLocalProvider } from './lib/util'

const NAV: { id: View; label: string; icon: ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={17} /> },
  { id: 'analyze', label: 'Analyze Game', icon: <Swords size={17} /> },
  { id: 'library', label: 'Game Library', icon: <BookOpen size={17} /> },
  { id: 'coaches', label: 'AI Coach', icon: <Users size={17} /> },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon size={17} /> }
]

function Dashboard(): ReactNode {
  const { setImportOpen, setView, coaches, settings, engine, importOpen } = useApp()
  const loaded = useGame((g) => g.loaded)
  const [recent, setRecent] = useState<GameRecord[] | null>(null)
  const [stats, setStats] = useState<{ games: number; reviewed: number } | null>(null)
  useEffect(() => {
    void Promise.all([api.games.list({}), api.games.stats()])
      .then(([g, s]) => {
        setRecent(g.slice(0, 6))
        setStats(s)
      })
      .catch((e) => useApp.getState().toast('error', errorText(e)))
  }, [importOpen])
  const coach = coaches.find((c) => c.id === settings?.coachId)
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1040px] px-8 py-8">
        <h1 className="text-[30px]">Review a game</h1>
        <p className="mt-1 text-ink-2">Paste a Chess.com or Lichess link, or bring a PGN. Stockfish does the analysis; your coach does the talking.</p>
        <div className="mt-5 flex gap-2">
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => setImportOpen(true)}>
            Import a game
          </Button>
          {loaded && <Button onClick={() => setView('analyze')}>Continue {loaded.record.white} vs {loaded.record.black}</Button>}
        </div>

        {!engine?.installed && (
          <div className="mt-6 flex items-center gap-4 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3">
            <div className="flex-1">
              <div className="font-semibold">Stockfish is not installed yet</div>
              <div className="text-[13px] text-ink-2">You can import and replay games now. Install the engine to analyse them.</div>
            </div>
            <Button onClick={() => setView('settings', 'engine')}>Install Stockfish</Button>
          </div>
        )}

        <div className="mt-8 grid grid-cols-[1fr_300px] gap-6">
          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-[19px]">Recent games</h2>
              {stats && stats.games > 0 && (
                <button className="text-[13px] text-ink-2 underline hover:text-ink" onClick={() => setView('library')}>
                  All {stats.games} games
                </button>
              )}
            </div>
            <div className="overflow-hidden rounded-lg border border-line bg-surface">
              {recent === null ? (
                <div className="flex justify-center py-10">
                  <Spinner size={18} />
                </div>
              ) : recent.length === 0 ? (
                <div className="px-6 py-10 text-center text-ink-2">No games yet. Import one to get started.</div>
              ) : (
                recent.map((g) => <GameRow key={g.id} g={g} compact />)
              )}
            </div>
          </section>
          <aside className="space-y-4">
            {coach && (
              <div className="rounded-lg border border-line bg-surface p-4">
                <div className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-ink-3">Your coach</div>
                <div className="flex items-center gap-3">
                  <CoachAvatar coach={coach} size={48} />
                  <div className="min-w-0">
                    <div className="font-display text-[17px] font-semibold">{coach.name}</div>
                    <div className="text-[12.5px] text-ink-3">{coach.tagline}</div>
                  </div>
                </div>
                <Button size="sm" className="mt-3 w-full" onClick={() => setView('coaches')}>
                  Change coach
                </Button>
              </div>
            )}
            {stats && (
              <div className="rounded-lg border border-line bg-surface p-4">
                <div className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-ink-3">Library</div>
                <div className="flex gap-6">
                  <div>
                    <div className="num font-display text-[26px] font-semibold">{stats.games}</div>
                    <div className="text-[12.5px] text-ink-3">games</div>
                  </div>
                  <div>
                    <div className="num font-display text-[26px] font-semibold">{stats.reviewed}</div>
                    <div className="text-[12.5px] text-ink-3">reviewed</div>
                  </div>
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

export function App(): ReactNode {
  const { ready, settings, view, setView, importOpen, toasts, dismissToast, downloads } = useApp()
  const [fatal, setFatal] = useState<string | null>(null)

  useEffect(() => {
    useApp
      .getState()
      .init()
      .then(() => {
        startCoachController()
        startBoardSounds()
      })
      .catch((e) => setFatal(errorText(e)))
  }, [])

  if (fatal) return <div className="selectable flex h-full items-center justify-center p-10 text-center text-bad">{APP_NAME} could not start: {fatal}</div>
  if (!ready || !settings)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={22} />
      </div>
    )
  if (!settings.setupComplete)
    return (
      <>
        <SetupWizard />
        <Toasts toasts={toasts} dismiss={dismissToast} />
      </>
    )

  const active = Object.values(downloads)
  const remote = settings.provider.kind !== 'builtin' && !isLocalProvider(settings.provider.baseUrl)

  return (
    <div className="flex h-full">
      <nav className="flex w-[196px] shrink-0 flex-col border-r border-line bg-surface px-2.5 py-4">
        <div className="mb-5 px-2.5 font-display text-[17px] font-semibold leading-tight tracking-tight">{APP_NAME}</div>
        {NAV.map((n) => (
          <button key={n.id} onClick={() => setView(n.id)} aria-current={view === n.id ? 'page' : undefined} className={cx('mb-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors', view === n.id ? 'bg-accent-soft font-semibold text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')}>
            <span className={view === n.id ? 'text-accent' : ''}>{n.icon}</span>
            {n.label}
          </button>
        ))}
        <div className="flex-1" />
        {remote && (
          <div className="mb-2 flex items-center gap-2 rounded-md border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-[12px]" title="The AI coach is using a server that is not on this computer.">
            <Cloud size={14} className="shrink-0 text-warn" /> Cloud AI provider in use
          </div>
        )}
        {active.length > 0 && (
          <div className="space-y-2 rounded-md border border-line bg-surface-2 p-2.5">
            {active.map((p) => (
              <DownloadRow key={p.id} p={p} onCancel={() => void api.downloads.cancel(p.id)} />
            ))}
          </div>
        )}
      </nav>
      <div className="min-w-0 flex-1">
        {view === 'dashboard' && <Dashboard />}
        {view === 'analyze' && <Analyze />}
        {view === 'library' && <Library />}
        {view === 'coaches' && <Coaches />}
        {view === 'settings' && <Settings />}
      </div>
      {importOpen && <ImportDialog />}
      <Toasts toasts={toasts} dismiss={dismissToast} />
    </div>
  )
}

function Toasts({ toasts, dismiss }: { toasts: { id: number; kind: string; text: string }[]; dismiss: (id: number) => void }): ReactNode {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[380px] flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx('fade-up pointer-events-auto flex items-start gap-2 rounded-md border bg-surface px-3 py-2.5 shadow-[var(--shadow)]', t.kind === 'error' ? 'border-bad/60' : t.kind === 'success' ? 'border-good/50' : 'border-line')}>
          <span className="selectable min-w-0 flex-1 break-words text-[13px]">{t.text}</span>
          <button aria-label="Dismiss" className="text-ink-3 hover:text-ink" onClick={() => dismiss(t.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
