import { useEffect, useState, type ReactNode } from 'react'
import { Check, Volume2 } from 'lucide-react'
import type { HardwareInfo } from '@shared/types'
import { APP_NAME } from '@shared/app'
import { api } from '../lib/api'
import { useApp, useSettings } from '../lib/store'
import { speech } from '../lib/speech'
import { HardwareSummary, ModelsPanel, StockfishPanel, VoicePanel } from '../components/Installers'
import { CoachAvatar } from '../components/chess'
import { Button, cx, Spinner } from '../components/ui'

const STEPS = ['Welcome', 'Chess engine', 'AI coach', 'Voice', 'Your coach', 'Ready'] as const

export function SetupWizard(): ReactNode {
  const s = useSettings()
  const { update, coaches, engine, info } = useApp()
  const [step, setStep] = useState(0)
  const [hw, setHw] = useState<HardwareInfo | null>(null)
  const [checks, setChecks] = useState<{ label: string; ok: boolean; detail: string }[] | null>(null)

  useEffect(() => void api.hardware.detect(true).then(setHw), [])

  useEffect(() => {
    if (step !== STEPS.length - 1) return
    setChecks(null)
    void (async () => {
      const out: { label: string; ok: boolean; detail: string }[] = []
      try {
        const t = await api.engine.test()
        out.push({ label: 'Chess engine', ok: true, detail: `${t.name} answered a test search.` })
      } catch {
        out.push({ label: 'Chess engine', ok: false, detail: 'Not installed. You can import and browse games, but not analyse them yet.' })
      }
      const ai = await api.ai.status().catch(() => null)
      out.push({ label: 'AI coach', ok: !!ai?.ok, detail: ai?.ok ? ai.message : 'No model yet. Engine analysis works; the coach will stay silent until you add one.' })
      const engines = await api.tts.engines().catch(() => [])
      const voice = engines.find((e) => e.id === s.ttsEngine)
      out.push({ label: 'Voice', ok: voice?.state === 'installed', detail: voice?.state === 'installed' ? `${voice.name} is installed.` : 'No voice engine yet. Explanations will be text only.' })
      out.push({ label: 'Storage', ok: true, detail: `Your data is kept in ${info?.dataDir ?? 'your user folder'}.` })
      setChecks(out)
    })()
  }, [step, s.ttsEngine, info])

  const coach = coaches.find((c) => c.id === s.coachId)
  const last = step === STEPS.length - 1

  return (
    <div className="flex h-full items-center justify-center bg-bg p-8">
      <div className="flex h-full max-h-[760px] w-full max-w-[980px] overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow)]">
        <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface-2 px-5 py-7">
          <div className="font-display text-[20px] font-semibold leading-tight">{APP_NAME}</div>
          <div className="mb-8 text-[13px] text-ink-3">Setting things up</div>
          <ol className="space-y-1">
            {STEPS.map((label, i) => (
              <li key={label}>
                <button onClick={() => setStep(i)} className={cx('flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left', i === step ? 'bg-accent-soft font-semibold' : 'text-ink-2 hover:text-ink')}>
                  <span className={cx('num flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold', i < step ? 'bg-accent text-accent-ink' : i === step ? 'border border-accent text-accent' : 'border border-line-strong text-ink-3')}>
                    {i < step ? <Check size={12} /> : i + 1}
                  </span>
                  {label}
                </button>
              </li>
            ))}
          </ol>
          <div className="flex-1" />
          <p className="text-[12px] leading-snug text-ink-3">Everything here can be changed later in Settings. Nothing is downloaded until you press a download button.</p>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-8 py-7">
            {step === 0 && (
              <div className="fade-up">
                <h1 className="text-[30px]">Welcome to {APP_NAME}</h1>
                <p className="mt-2 max-w-[60ch] text-ink-2">Review your chess games with Stockfish and a coach who talks you through every move. Everything runs on this computer: no account, no subscription, nothing sent anywhere.</p>
                <h3 className="mb-2 mt-7 text-[16px]">This computer</h3>
                <div className="rounded-lg border border-line p-4">
                  <HardwareSummary hw={hw} />
                </div>
                <p className="mt-3 text-[13px] text-ink-3">The next steps use this to suggest an engine build, an AI model and a voice engine that will run well here.</p>
              </div>
            )}
            {step === 1 && (
              <div className="fade-up">
                <h1 className="text-[26px]">Chess engine</h1>
                <p className="mb-5 mt-2 max-w-[62ch] text-ink-2">Stockfish finds the best moves and scores every position. It is the source of every evaluation and classification you will see.</p>
                <div className="rounded-lg border border-line p-4">
                  <StockfishPanel compact />
                </div>
              </div>
            )}
            {step === 2 && (
              <div className="fade-up">
                <h1 className="text-[26px]">AI coach</h1>
                <p className="mb-5 mt-2 max-w-[62ch] text-ink-2">A language model turns the engine's analysis into explanations. It runs inside {APP_NAME}; you do not need any other program. Already use LM Studio or Ollama? You can connect them later in Settings.</p>
                <ModelsPanel compact />
              </div>
            )}
            {step === 3 && (
              <div className="fade-up">
                <h1 className="text-[26px]">Voice</h1>
                <p className="mb-5 mt-2 max-w-[62ch] text-ink-2">Give your coach a voice. Speech is generated on this computer, so it keeps working offline.</p>
                <VoicePanel />
              </div>
            )}
            {step === 4 && (
              <div className="fade-up">
                <h1 className="text-[26px]">Pick a coach to start with</h1>
                <p className="mb-5 mt-2 max-w-[62ch] text-ink-2">There are twenty, from patient to merciless. You can switch at any time, even in the middle of a review.</p>
                <div className="grid grid-cols-2 gap-2.5">
                  {coaches
                    .filter((c) => ['mentor', 'grandmaster', 'casual-friend', 'tournament-coach', 'toxic-best-friend', 'old-wizard'].includes(c.id))
                    .map((c) => (
                      <div key={c.id} className={cx('flex items-center gap-3 rounded-lg border p-3', s.coachId === c.id ? 'border-accent' : 'border-line')}>
                        <CoachAvatar coach={c} size={44} />
                        <button className="min-w-0 flex-1 text-left" onClick={() => void update({ coachId: c.id })}>
                          <div className="font-semibold">{c.name}</div>
                          <div className="truncate text-[12.5px] text-ink-3">{c.tagline}</div>
                        </button>
                        <button title="Hear the voice" aria-label={`Hear ${c.name}`} className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2" onClick={() => speech.speakText(c.intro, c.id)}>
                          <Volume2 size={16} />
                        </button>
                      </div>
                    ))}
                </div>
                <p className="mt-3 text-[13px] text-ink-3">The full roster is on the Coaches screen, where you can also create your own.</p>
              </div>
            )}
            {last && (
              <div className="fade-up">
                <h1 className="text-[26px]">{engine?.installed ? "You're ready" : 'Almost ready'}</h1>
                <p className="mb-5 mt-2 text-ink-2">Here is what was checked just now.</p>
                {!checks ? (
                  <Spinner size={18} />
                ) : (
                  <div className="space-y-2">
                    {checks.map((c) => (
                      <div key={c.label} className="flex items-start gap-3 rounded-lg border border-line px-4 py-3">
                        <span className={cx('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full', c.ok ? 'bg-good/20 text-good' : 'bg-warn/20 text-warn')}>{c.ok ? <Check size={13} /> : '!'}</span>
                        <div>
                          <div className="font-semibold">{c.label}</div>
                          <div className="selectable text-[13px] text-ink-2">{c.detail}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {coach && <p className="mt-5 text-ink-2">Your coach is {coach.name}. Import a game to begin.</p>}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-line px-8 py-4">
            <Button variant="ghost" onClick={() => void update({ setupComplete: true })}>
              {last ? '' : 'Skip setup'}
            </Button>
            <div className="flex gap-2">
              {step > 0 && <Button onClick={() => setStep(step - 1)}>Back</Button>}
              {last ? (
                <Button
                  variant="primary"
                  onClick={() => {
                    speech.stop()
                    void update({ setupComplete: true })
                  }}
                >
                  Start using {APP_NAME}
                </Button>
              ) : (
                <Button variant="primary" onClick={() => setStep(step + 1)}>
                  Continue
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
