import { useEffect, useState, type ReactNode } from 'react'
import { Volume2 } from 'lucide-react'
import type { HardwareInfo, ProviderConfig, ProviderKind, ProviderStatus, ReviewPreset, Settings as S, SkillLevel, TtsVoice } from '@shared/types'
import { DEFAULT_PRESETS, PROVIDER_DEFAULTS } from '@shared/defaults'
import { DEFAULT_THRESHOLDS } from '@shared/classify'
import { APP_NAME } from '@shared/app'
import { api, errorText } from '../lib/api'
import { useApp, useSettings, type SettingsTab } from '../lib/store'
import { BOARD_THEMES, PIECE_SETS, pieceImage } from '../lib/themes'
import { speech } from '../lib/speech'
import { HardwareSummary, ModelsPanel, StockfishPanel, VoicePanel } from '../components/Installers'
import { Badge, Button, cx, Notice, Row, Section, Select, Slider, Toggle } from '../components/ui'

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'general', label: 'Board & Appearance' },
  { id: 'engine', label: 'Engine' },
  { id: 'ai', label: 'AI Coach' },
  { id: 'voice', label: 'Voice' },
  { id: 'data', label: 'Data & Maintenance' },
  { id: 'developer', label: 'Developer' }
]

function Num({ value, onChange, min, max, step = 1 }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number }): ReactNode {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  return (
    <input
      className="field num"
      inputMode="decimal"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const n = Number(text)
        if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, step >= 1 ? Math.round(n) : n)))
        else setText(String(value))
      }}
    />
  )
}

function General(): ReactNode {
  const s = useSettings()
  const update = useApp((a) => a.update)
  return (
    <>
      <Section title="Appearance">
        <Row label="Colour theme">
          <Select value={s.theme} onChange={(v) => void update({ theme: v })} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />
        </Row>
      </Section>
      <Section title="Board">
        <div className="mb-1 text-ink-2">Board colours</div>
        <div className="mb-4 flex flex-wrap gap-2">
          {BOARD_THEMES.map((b) => (
            <button key={b.id} onClick={() => void update({ boardTheme: b.id })} className={cx('rounded-md border p-1.5 text-[12px]', s.boardTheme === b.id ? 'border-accent' : 'border-line hover:border-line-strong')}>
              <span className="grid h-12 w-12 grid-cols-2 overflow-hidden rounded-sm">
                <i style={{ background: b.light }} />
                <i style={{ background: b.dark }} />
                <i style={{ background: b.dark }} />
                <i style={{ background: b.light }} />
              </span>
              <span className="mt-1 block text-center">{b.name}</span>
            </button>
          ))}
        </div>
        <div className="mb-1 text-ink-2">Pieces</div>
        <div className="mb-3 flex flex-wrap gap-2">
          {PIECE_SETS.map((p) => (
            <button key={p.id} onClick={() => void update({ pieceSet: p.id })} className={cx('rounded-md border px-3 py-2 text-left', s.pieceSet === p.id ? 'border-accent' : 'border-line hover:border-line-strong')}>
              <span className="font-semibold">{p.name}</span>
              <span className="block text-[12px] text-ink-3">{p.credit}</span>
            </button>
          ))}
        </div>
        <Toggle label="Show coordinates" checked={s.showCoordinates} onChange={(v) => void update({ showCoordinates: v })} />
        <Toggle label="Show engine arrows" hint="Green for the engine's first choice, blue for the second." checked={s.showBestArrow} onChange={(v) => void update({ showBestArrow: v })} />
        <Toggle label="Board sounds" hint="Move, capture, check, castling and game-over sounds. They follow the volume and mute settings." checked={s.sounds} onChange={(v) => void update({ sounds: v })} />
        <Slider label="Board size" min={60} max={100} value={s.boardSize} onChange={(v) => void update({ boardSize: v })} format={(v) => `${v}%`} />
      </Section>
    </>
  )
}

function Engine(): ReactNode {
  const s = useSettings()
  const update = useApp((a) => a.update)
  const [hw, setHw] = useState<HardwareInfo | null>(null)
  useEffect(() => void api.hardware.detect().then(setHw), [])
  const setPreset = (id: ReviewPreset['id'], p: Partial<ReviewPreset>): void => void update({ presets: s.presets.map((x) => (x.id === id ? { ...x, ...p } : x)) })
  const t = s.thresholds
  return (
    <>
      <Section title="Stockfish" description="The chess engine does all the analysis, on this computer. Stockfish is free software under the GNU GPL v3; its licence and source code are stored next to the engine.">
        <StockfishPanel />
      </Section>
      <Section title="Performance">
        <Row label="Processor threads" hint={hw ? `This computer has ${hw.cpuCores}.` : undefined}>
          <Num value={s.engine.threads} min={1} max={hw?.cpuCores ?? 64} onChange={(v) => void update({ engine: { ...s.engine, threads: v } })} />
        </Row>
        <Row label="Hash memory (MB)" hint="Memory the engine uses to remember positions.">
          <Num value={s.engine.hashMb} min={16} max={16384} onChange={(v) => void update({ engine: { ...s.engine, hashMb: v } })} />
        </Row>
        <Row label="Lines shown while browsing">
          <Num value={s.liveMultipv} min={1} max={5} onChange={(v) => void update({ liveMultipv: v })} />
        </Row>
        <Row label="Depth while browsing">
          <Num value={s.liveDepth} min={8} max={40} onChange={(v) => void update({ liveDepth: v })} />
        </Row>
      </Section>
      <Section title="Review presets" description="Each position is searched to the depth given, or until the time limit, whichever comes first." aside={<Button size="sm" onClick={() => void update({ presets: DEFAULT_PRESETS })}>Restore defaults</Button>}>
        <div className="grid grid-cols-[1fr_110px_130px_110px] items-center gap-x-3 gap-y-1.5">
          <span className="text-[12px] text-ink-3">Preset</span>
          <span className="text-[12px] text-ink-3">Depth</span>
          <span className="text-[12px] text-ink-3">Time per move (ms)</span>
          <span className="text-[12px] text-ink-3">Lines</span>
          {s.presets.map((p) => (
            <div key={p.id} className="contents">
              <span>{p.label}</span>
              <Num value={p.depth} min={6} max={40} onChange={(v) => setPreset(p.id, { depth: v })} />
              <Num value={p.movetimeMs} min={50} max={60000} onChange={(v) => setPreset(p.id, { movetimeMs: v })} />
              <Num value={p.multipv} min={1} max={5} onChange={(v) => setPreset(p.id, { multipv: v })} />
            </div>
          ))}
        </div>
        <Row label="Default preset">
          <Select value={s.defaultPreset} onChange={(v) => void update({ defaultPreset: v })} options={s.presets.map((p) => ({ value: p.id, label: p.label }))} />
        </Row>
      </Section>
      <Section title="Move classification" description="A move is graded by how many percentage points of win probability it gave up compared with the engine's best move. Changes apply to the next review." aside={<Button size="sm" onClick={() => void update({ thresholds: DEFAULT_THRESHOLDS })}>Restore defaults</Button>}>
        {(
          [
            ['excellent', 'Excellent: loses at most'],
            ['good', 'Good: loses at most'],
            ['inaccuracy', 'Inaccuracy: loses at most'],
            ['mistake', 'Mistake: loses at most (more is a blunder)'],
            ['winningAt', 'A position counts as winning from'],
            ['greatGap', 'Great move: next-best move is worse by at least']
          ] as const
        ).map(([k, label]) => (
          <Row key={k} label={label} hint="percentage points">
            <Num value={t[k]} min={0} max={100} step={0.5} onChange={(v) => void update({ thresholds: { ...t, [k]: v } })} />
          </Row>
        ))}
      </Section>
    </>
  )
}

const PROVIDER_LABEL: Record<ProviderKind, string> = {
  builtin: `Built into ${APP_NAME} (recommended)`,
  lmstudio: 'LM Studio',
  ollama: 'Ollama',
  openai: 'OpenAI-compatible server',
  anthropic: 'Anthropic-compatible server'
}

function Ai(): ReactNode {
  const s = useSettings()
  const update = useApp((a) => a.update)
  const cfg = s.provider
  const [status, setStatus] = useState<ProviderStatus | null>(null)
  const [testing, setTesting] = useState(false)
  const [found, setFound] = useState<{ lmstudio: boolean; ollama: boolean } | null>(null)
  const setCfg = (p: Partial<ProviderConfig>): void => void update({ provider: { ...cfg, ...p } })

  const test = async (): Promise<void> => {
    setTesting(true)
    try {
      setStatus(await api.ai.status())
    } catch (e) {
      setStatus({ ok: false, message: errorText(e), models: [], remote: false })
    } finally {
      setTesting(false)
    }
  }
  useEffect(() => {
    setStatus(null)
    void test()
    // Re-check whenever the connection details change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.kind, cfg.baseUrl, cfg.model])
  useEffect(() => void api.ai.discover().then(setFound), [])

  return (
    <>
      <Section title="Where the coach's words come from" description="Stockfish does the chess. A language model only turns the engine's analysis into explanations. Everything works without one; you just won't get spoken or written coaching.">
        <Row label="Provider">
          <Select
            value={cfg.kind}
            onChange={(k) => void update({ provider: { ...PROVIDER_DEFAULTS[k], ...s.providers[k], kind: k } })}
            options={(Object.keys(PROVIDER_LABEL) as ProviderKind[]).map((k) => ({ value: k, label: PROVIDER_LABEL[k] + (found && (k === 'lmstudio' || k === 'ollama') && found[k] ? ' — running' : '') }))}
          />
        </Row>
        <div className="my-2 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            {status ? (
              <Notice tone={status.ok ? 'good' : 'warn'}>
                {status.message}
                {status.remote && ' This server is not on this computer: positions and your questions will be sent to it.'}
              </Notice>
            ) : (
              <span className="text-ink-3">Checking the connection…</span>
            )}
          </div>
          <Button busy={testing} onClick={() => void test()}>
            Test connection
          </Button>
        </div>

        {cfg.kind !== 'builtin' && (
          <>
            <Row label="Server address">
              <input className="field" value={cfg.baseUrl} onChange={(e) => setCfg({ baseUrl: e.target.value })} spellCheck={false} />
            </Row>
            <Row label="Model" hint={status?.models.length ? 'Models reported by the server.' : 'Type the model identifier.'}>
              {status?.models.length ? (
                <Select value={cfg.model} onChange={(v) => setCfg({ model: v })} options={[{ value: '', label: 'Choose a model…' }, ...status.models.map((m) => ({ value: m, label: m })), ...(cfg.model && !status.models.includes(cfg.model) ? [{ value: cfg.model, label: cfg.model }] : [])]} />
              ) : (
                <input className="field" value={cfg.model} onChange={(e) => setCfg({ model: e.target.value })} spellCheck={false} placeholder="model identifier" />
              )}
            </Row>
            {status?.models.length ? (
              <Row label="Or enter a model manually">
                <input className="field" value={cfg.model} onChange={(e) => setCfg({ model: e.target.value })} spellCheck={false} />
              </Row>
            ) : null}
            {(cfg.kind === 'openai' || cfg.kind === 'anthropic') && (
              <Row label="API key" hint="Optional. Stored encrypted by your operating system; never written to logs.">
                <input className="field" type="password" value={cfg.apiKey ?? ''} onChange={(e) => setCfg({ apiKey: e.target.value })} autoComplete="off" />
              </Row>
            )}
          </>
        )}
      </Section>

      {cfg.kind === 'builtin' && (
        <Section title="Models" description="Pick a model to download. It runs inside this application: no other program to install, no server to start.">
          <ModelsPanel />
        </Section>
      )}

      <Section title="Coaching">
        <Row label="Your level" hint="How the coach pitches its explanations.">
          <Select
            value={s.skillLevel}
            onChange={(v) => void update({ skillLevel: v as SkillLevel })}
            options={[
              { value: 'auto', label: 'Adapt automatically' },
              { value: 'beginner', label: 'Beginner' },
              { value: 'intermediate', label: 'Intermediate' },
              { value: 'advanced', label: 'Advanced' },
              { value: 'expert', label: 'Expert' }
            ]}
          />
        </Row>
        <Row label="Language">
          <input className="field" value={s.language} onChange={(e) => void update({ language: e.target.value })} />
        </Row>
        <Toggle label="Explain moves automatically" hint="When you select a move, the coach explains it without being asked." checked={s.autoExplain} onChange={(v) => void update({ autoExplain: v })} />
        <Row label="Which moves to explain">
          <Select
            value={s.explainMode}
            onChange={(v) => void update({ explainMode: v })}
            options={[
              { value: 'every', label: 'Every move' },
              { value: 'important', label: 'Only important moves' },
              { value: 'mistakes', label: 'Only mistakes and blunders' },
              { value: 'manual', label: 'Only when requested' }
            ]}
          />
        </Row>
      </Section>

      <Section title="Generation">
        <Row label="Temperature" hint="Higher is more varied; lower is more predictable.">
          <Num value={cfg.temperature} min={0} max={2} step={0.05} onChange={(v) => setCfg({ temperature: v })} />
        </Row>
        <Row label="Maximum answer length (tokens)">
          <Num value={cfg.maxTokens} min={64} max={4096} onChange={(v) => setCfg({ maxTokens: v })} />
        </Row>
        <Row label="Context window (tokens)">
          <Num value={cfg.contextWindow} min={2048} max={1000000} onChange={(v) => setCfg({ contextWindow: v })} />
        </Row>
        <Row label="Connection timeout (seconds)">
          <Num value={Math.round(cfg.timeoutMs / 1000)} min={5} max={900} onChange={(v) => setCfg({ timeoutMs: v * 1000 })} />
        </Row>
        <Toggle label="Stream answers as they are written" hint="Lets speech start before the whole answer is finished." checked={cfg.streaming} onChange={(v) => setCfg({ streaming: v })} />
      </Section>
    </>
  )
}

function Voice(): ReactNode {
  const s = useSettings()
  const { update, coaches } = useApp()
  const [voices, setVoices] = useState<TtsVoice[]>([])
  useEffect(() => void api.tts.voices(s.ttsEngine).then(setVoices).catch(() => setVoices([])), [s.ttsEngine])
  const owner = (id: string): string | undefined => coaches.find((c) => c.voice.kokoro === id)?.name
  return (
    <>
      <Section title="Voice engine" description="The coach's voice is generated on this computer. Choose a quality level, download the engine once, and it works offline from then on.">
        <VoicePanel />
      </Section>
      <Section title="Speech">
        <Toggle label="Speak explanations automatically" hint="Turn off to keep written explanations only." checked={s.autoSpeak} onChange={(v) => void update({ autoSpeak: v })} />
        <Toggle label="Mute all speech" checked={s.muted} onChange={(v) => void update({ muted: v })} />
        <Toggle
          label="Change the voice when I change coach"
          hint="Off keeps the voice you are hearing now for every coach."
          checked={s.coachChangesVoice}
          onChange={async (v) => void update(v ? { coachChangesVoice: true, pinnedVoice: null } : { coachChangesVoice: false, pinnedVoice: await api.tts.coachVoice(s.coachId) })}
        />
        <Slider label="Volume" min={0} max={1} step={0.05} value={s.volume} onChange={(v) => void update({ volume: v })} format={(v) => `${Math.round(v * 100)}%`} />
        <Slider label="Speech speed" min={0.7} max={1.5} step={0.05} value={s.speechSpeed} onChange={(v) => void update({ speechSpeed: v })} format={(v) => `${v.toFixed(2)}×`} />
      </Section>
      <Section title="All voices" description="Every voice the selected engine offers. Each built-in coach has a different one; change a coach's voice from the Coaches screen.">
        <div className="grid grid-cols-2 gap-x-6">
          {voices.map((v) => (
            <div key={v.id} className="flex items-center gap-2 border-b border-line py-1.5">
              <Button size="sm" icon={<Volume2 size={13} />} onClick={() => speech.speakText(`Hello, I am ${v.name}. Knight to f3 is a fine developing move.`, null, v.id)}>
                Preview
              </Button>
              <div className="min-w-0 flex-1">
                <div className="truncate">
                  <span className="font-semibold">{v.name}</span> <span className="text-[12.5px] text-ink-3">{v.gender}, {v.accent}</span>
                </div>
                <div className="truncate text-[12.5px] text-ink-3">{v.description}</div>
              </div>
              {owner(v.id) && <Badge>{owner(v.id)}</Badge>}
            </div>
          ))}
        </div>
      </Section>
    </>
  )
}

function Data(): ReactNode {
  const { info, toast, update } = useApp()
  const [hw, setHw] = useState<HardwareInfo | null>(null)
  const [report, setReport] = useState<string[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => void api.hardware.detect().then(setHw), [])
  const run = async (name: string, fn: () => Promise<string | void>): Promise<void> => {
    setBusy(name)
    try {
      const msg = await fn()
      if (msg) toast('success', msg)
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setBusy(null)
    }
  }
  return (
    <>
      <Section title="Your data" description={`Games, analysis, conversations and settings are stored only on this computer${info ? `, in ${info.dataDir}` : ''}. There is no account and no telemetry.`}>
        <div className="flex flex-wrap gap-2">
          <Button busy={busy === 'backup'} onClick={() => void run('backup', async () => ((await api.data.backup()) ? 'Backup saved' : undefined))}>
            Back up data…
          </Button>
          <Button
            busy={busy === 'restore'}
            onClick={() =>
              void run('restore', async () => {
                if (!window.confirm('Restoring replaces all current games, analysis and settings with the contents of the backup. Continue?')) return
                if (await api.data.restore()) {
                  useApp.setState({ settings: await api.settings.get() })
                  return 'Backup restored'
                }
              })
            }
          >
            Restore from backup…
          </Button>
          <Button busy={busy === 'export'} onClick={() => void run('export', async () => ((await api.data.exportAllPgn()) ? 'All games exported' : 'There are no games to export'))}>
            Export all games (PGN)…
          </Button>
          <Button onClick={() => void api.app.openDataFolder()}>Open data folder</Button>
        </div>
      </Section>
      <Section title="Maintenance">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            busy={busy === 'repair'}
            onClick={() =>
              void run('repair', async () => {
                setReport(await api.data.repair())
                await useApp.getState().refreshEngine()
              })
            }
          >
            Repair installation
          </Button>
          <Button onClick={() => void run('cache', async () => (await api.data.clearAnalysisCache(), 'Analysis cache cleared'))}>Clear analysis cache</Button>
          <Button
            onClick={() =>
              void run('reset', async () => {
                if (!window.confirm('Reset all settings to their defaults? Your games and installed models are kept.')) return
                useApp.setState({ settings: await api.settings.reset() })
                return 'Settings reset'
              })
            }
          >
            Reset settings
          </Button>
          <Button onClick={() => void update({ setupComplete: false })}>Run setup again</Button>
          <Button
            variant="danger"
            onClick={() =>
              void run('wipe', async () => {
                if (!window.confirm('Delete every game, analysis and coach conversation? This cannot be undone.')) return
                await api.data.deleteAllGames()
                return 'All games deleted'
              })
            }
          >
            Delete all games
          </Button>
        </div>
        {report && (
          <div className="mt-3">
            <Notice tone="info">
              {report.map((r, i) => (
                <div key={i}>{r}</div>
              ))}
            </Notice>
          </div>
        )}
      </Section>
      <Section title="This computer">
        <HardwareSummary hw={hw} />
      </Section>
      <Section title="About">
        <div className="selectable space-y-1.5 text-[13px] text-ink-2">
          <div>
            {APP_NAME} {info?.version} — free software under the GNU General Public License v3 or later.
          </div>
          <div>Chess analysis by Stockfish (GPL-3.0), run as a separate program. Board by Chessground (GPL-3.0). Rules by chess.js (BSD-2-Clause). Opening names from the Lichess chess-openings dataset (CC0). Local AI through llama.cpp (MIT). Speech by Kokoro (Apache-2.0).</div>
          <div>{APP_NAME} is an independent project. It is not affiliated with, endorsed by or connected to Chess.com or Lichess.</div>
        </div>
      </Section>
    </>
  )
}

function Developer(): ReactNode {
  const s = useSettings()
  const update = useApp((a) => a.update)
  const [data, setData] = useState<{ core: string; isCustom: boolean; composed: string } | null>(null)
  const [draft, setDraft] = useState('')
  const [show, setShow] = useState<'core' | 'composed'>('core')
  const load = async (): Promise<void> => {
    const d = await api.ai.systemPrompt()
    setData(d)
    setDraft(d.core)
  }
  useEffect(() => {
    void load()
  }, [s.customSystemPrompt, s.coachId])
  if (!data) return null
  return (
    <Section
      title="Coach system prompt"
      description="The core instructions every coach receives (from AI_SYSTEM_PROMPT.md), before the selected coach's personality is added. Edit it to experiment; your version is stored in your settings and the original file is untouched."
      aside={data.isCustom ? <Badge tone="warn">Customised</Badge> : <Badge>Original</Badge>}
    >
      <div className="mb-2 flex gap-1 rounded-md bg-surface-2 p-1">
        {(['core', 'composed'] as const).map((k) => (
          <button key={k} onClick={() => setShow(k)} className={cx('flex-1 rounded py-1 text-[13px] font-semibold', show === k ? 'bg-surface shadow-sm' : 'text-ink-3')}>
            {k === 'core' ? 'Core prompt (editable)' : 'Full prompt sent for the selected coach'}
          </button>
        ))}
      </div>
      {show === 'core' ? (
        <>
          <textarea className="field h-[46vh] font-mono text-[12.5px]" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
          <div className="mt-2 flex justify-end gap-2">
            <Button disabled={!data.isCustom} onClick={() => void update({ customSystemPrompt: null })}>
              Restore the original
            </Button>
            <Button variant="primary" disabled={draft === data.core} onClick={() => void update({ customSystemPrompt: draft })}>
              Save custom prompt
            </Button>
          </div>
        </>
      ) : (
        <pre className="selectable h-[50vh] overflow-auto whitespace-pre-wrap rounded-md border border-line bg-surface-2 p-3 font-mono text-[12.5px]">{data.composed}</pre>
      )}
    </Section>
  )
}

export function Settings(): ReactNode {
  const tab = useApp((a) => a.settingsTab)
  const setView = useApp((a) => a.setView)
  const Body = { general: General, engine: Engine, ai: Ai, voice: Voice, data: Data, developer: Developer }[tab]
  return (
    <div className="flex h-full">
      <nav className="w-56 shrink-0 border-r border-line px-3 py-6">
        <h1 className="mb-4 px-2 text-[22px]">Settings</h1>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setView('settings', t.id)} className={cx('block w-full rounded-md px-2.5 py-1.5 text-left', tab === t.id ? 'bg-accent-soft font-semibold text-ink' : 'text-ink-2 hover:bg-surface-2')}>
            {t.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[820px] px-8 py-6">
          <Body />
        </div>
      </div>
    </div>
  )
}

export type { S as SettingsType }
export { pieceImage }
