import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { CheckCircle2, Download, FolderOpen, Gauge, RefreshCw, Trash2, Wrench } from 'lucide-react'
import type { HardwareInfo, InstallStatus, LlmCatalogEntry, Recommendation, TtsEngineInfo } from '@shared/types'
import { api, errorText, formatBytes } from '../lib/api'
import { useApp, useSettings } from '../lib/store'
import { Badge, Button, cx, DownloadRow, Notice, Spinner } from './ui'

function useDownload(id: string): ReturnType<typeof useApp.getState>['downloads'][string] | undefined {
  return useApp((a) => a.downloads[id])
}

export function HardwareSummary({ hw }: { hw: HardwareInfo | null }): ReactNode {
  if (!hw) return <Spinner />
  const os = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[hw.platform] ?? hw.platform
  const accel = { cuda: 'NVIDIA CUDA', vulkan: 'Vulkan', metal: 'Apple Metal', cpu: 'Processor only' }[hw.acceleration[0]]
  const rows: [string, string][] = [
    ['System', `${os} (${hw.arch})`],
    ['Processor', `${hw.cpuModel} · ${hw.cpuCores} threads`],
    ['Memory', `${hw.ramGb} GB`],
    ['Graphics', hw.gpus.length ? hw.gpus.map((g) => `${g.name}${g.vramGb ? ` · ${g.vramGb} GB` : ''}`).join(', ') : 'No supported graphics card detected'],
    ['AI acceleration', accel],
    ['Free disk space', `${hw.freeDiskGb} GB`]
  ]
  return (
    <div className="selectable grid grid-cols-[130px_1fr] gap-y-1 text-[13px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <span className="text-ink-3">{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  )
}

// ---------- Stockfish ----------

export function StockfishPanel({ compact }: { compact?: boolean }): ReactNode {
  const { engine, refreshEngine, toast } = useApp()
  const dl = useDownload('stockfish')
  const [busy, setBusy] = useState<string | null>(null)
  const [test, setTest] = useState<string | null>(null)

  useEffect(() => {
    void refreshEngine(true).catch(() => undefined)
  }, [refreshEngine])

  const act = async (name: string, fn: () => Promise<unknown>, ok?: string): Promise<void> => {
    setBusy(name)
    setTest(null)
    try {
      await fn()
      await refreshEngine(true)
      if (ok) toast('success', ok)
    } catch (e) {
      const m = errorText(e)
      if (!/cancel/i.test(m)) toast('error', m)
    } finally {
      setBusy(null)
    }
  }
  const runTest = (): Promise<void> =>
    act('test', async () => {
      const t = await api.engine.test()
      setTest(`Working. ${t.name} searched the starting position to depth ${t.depth} in ${(t.ms / 1000).toFixed(1)} s and suggests ${t.bestMove}${t.nps ? ` (${(t.nps / 1e6).toFixed(1)} million positions per second)` : ''}.`)
    })

  const installing = busy === 'install' || (!!dl && dl.phase !== 'done' && dl.phase !== 'error' && dl.phase !== 'cancelled')
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          {engine?.installed ? (
            <>
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 size={16} className="text-good" /> {engine.name}
                {engine.source === 'manual' && <Badge>Your own engine</Badge>}
                {engine.updateAvailable && <Badge tone="warn">Stockfish {engine.latestVersion} available</Badge>}
              </div>
              {!compact && <div className="selectable truncate text-[12.5px] text-ink-3">{engine.path}</div>}
            </>
          ) : (
            <>
              <div className="font-semibold">Stockfish is not installed</div>
              <div className="text-[13px] text-ink-2">
                The latest official release{engine?.latestVersion ? ` (Stockfish ${engine.latestVersion})` : ''} is downloaded from the Stockfish project on GitHub, about 80 MB, and its checksum is verified before it is used.
              </div>
            </>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {!engine?.installed && (
            <Button variant="primary" icon={<Download size={14} />} busy={installing} onClick={() => void act('install', () => api.engine.install(), 'Stockfish is installed')}>
              Install Stockfish
            </Button>
          )}
          {engine?.installed && engine.updateAvailable && (
            <Button variant="primary" icon={<RefreshCw size={14} />} busy={installing} onClick={() => void act('install', () => api.engine.install(), 'Stockfish was updated')}>
              Update Stockfish
            </Button>
          )}
          {engine?.installed && (
            <Button icon={<Gauge size={14} />} busy={busy === 'test'} onClick={() => void runTest()}>
              Test Stockfish
            </Button>
          )}
          {engine?.installed && !compact && (
            <Button icon={<Wrench size={14} />} busy={installing} onClick={() => void act('install', () => api.engine.install(), 'Stockfish was reinstalled')}>
              Repair
            </Button>
          )}
          {!compact && (
            <Button icon={<FolderOpen size={14} />} onClick={() => void act('choose', () => api.engine.chooseFile())}>
              Choose engine file…
            </Button>
          )}
          {engine?.installed && !compact && (
            <Button variant="danger" icon={<Trash2 size={14} />} onClick={() => void act('remove', () => api.engine.remove(), 'Stockfish was removed')}>
              Remove
            </Button>
          )}
        </div>
      </div>
      {dl && <DownloadRow p={dl} onCancel={() => void api.downloads.cancel('stockfish')} />}
      {test && <Notice tone="good">{test}</Notice>}
    </div>
  )
}

// ---------- Built-in AI models ----------

export function ModelsPanel({ compact }: { compact?: boolean }): ReactNode {
  const s = useSettings()
  const { update, toast, downloads } = useApp()
  const [data, setData] = useState<{ entries: LlmCatalogEntry[]; status: InstallStatus[]; recommendations: Recommendation[] } | null>(null)
  const refresh = useCallback(async () => setData(await api.ai.catalog()), [])
  const activity = Object.values(downloads)
    .filter((d) => d.id.startsWith('llm:'))
    .map((d) => d.phase)
    .join()
  useEffect(() => {
    void refresh()
  }, [refresh, activity])

  if (!data) return <Spinner />
  const recFor = (id: string): Recommendation[] => data.recommendations.filter((r) => r.id === id)
  const top = data.recommendations[0]
  const list = compact ? data.entries.filter((e) => recFor(e.id).length > 0 || data.status.find((x) => x.id === e.id)?.state === 'installed') : data.entries

  const install = async (e: LlmCatalogEntry): Promise<void> => {
    try {
      await api.ai.installModel(e.id)
      const fresh = await api.settings.get()
      useApp.setState({ settings: fresh })
      toast('success', `${e.name} is installed`)
    } catch (err) {
      const m = errorText(err)
      if (!/cancel/i.test(m)) toast('error', m)
    }
    await refresh()
  }

  return (
    <div className="space-y-2.5">
      {top && (
        <Notice tone="info">
          <span className="font-semibold">Recommended: {data.entries.find((e) => e.id === top.id)?.name}.</span> {top.reason}
        </Notice>
      )}
      {list.map((e) => {
        const st = data.status.find((x) => x.id === e.id)!
        const dl = downloads[`llm:${e.id}`]
        const active = s.provider.kind === 'builtin' && s.provider.model === e.id
        const recs = recFor(e.id)
        return (
          <div key={e.id} className={cx('rounded-lg border p-3', active ? 'border-accent' : 'border-line')}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{e.name}</span>
                  <span className="num text-[12.5px] text-ink-3">
                    {e.quant} · {formatBytes(e.sizeBytes)} download · about {e.minMemoryGb} GB of memory (estimate) · {e.license}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {recs.map((r) => (
                    <Badge key={r.role} tone={r.reason.includes('not recommended') ? 'neutral' : 'accent'}>
                      {r.role}
                    </Badge>
                  ))}
                  {st.state === 'installed' && <Badge tone="good">Installed</Badge>}
                  {active && <Badge tone="accent">In use</Badge>}
                  {st.state === 'incompatible' && <Badge tone="warn">Too large for this computer</Badge>}
                  {st.state === 'broken' && <Badge tone="bad">Needs repair</Badge>}
                </div>
                <div className="mt-1.5 text-[13px] text-ink-2">{e.notes}</div>
                {st.message && <div className="mt-1 text-[12.5px] text-warn">{st.message}</div>}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {st.state === 'installed' ? (
                  <>
                    {!active && (
                      <Button size="sm" variant="primary" onClick={() => void update({ provider: { ...(s.providers.builtin ?? s.provider), kind: 'builtin', model: e.id, baseUrl: '' } })}>
                        Use this model
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="danger"
                      icon={<Trash2 size={13} />}
                      onClick={async () => {
                        await api.ai.removeModel(e.id)
                        useApp.setState({ settings: await api.settings.get() })
                        await refresh()
                      }}
                    >
                      Remove
                    </Button>
                  </>
                ) : st.state === 'downloading' || (dl && dl.phase !== 'error' && dl.phase !== 'cancelled' && dl.phase !== 'done') ? null : (
                  <Button size="sm" variant={recs[0] === top ? 'primary' : 'default'} icon={<Download size={13} />} onClick={() => void install(e)}>
                    {st.state === 'broken' ? 'Repair' : `Download ${formatBytes(e.sizeBytes)}`}
                  </Button>
                )}
              </div>
            </div>
            {dl && <div className="mt-2.5"><DownloadRow p={dl} onCancel={() => void api.downloads.cancel(`llm:${e.id}`)} /></div>}
          </div>
        )
      })}
      <p className="text-[12.5px] text-ink-3">Models are downloaded from Hugging Face, checked against their published SHA-256, and then run entirely on this computer. Nothing is downloaded until you press a button.</p>
    </div>
  )
}

// ---------- Voice engines ----------

export function VoicePanel(): ReactNode {
  const s = useSettings()
  const { update, toast, downloads } = useApp()
  const [engines, setEngines] = useState<TtsEngineInfo[] | null>(null)
  const [recs, setRecs] = useState<Recommendation[]>([])
  const [bench, setBench] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    const [e, r] = await Promise.all([api.tts.engines(), api.tts.recommend()])
    setEngines(e)
    setRecs(r)
  }, [])
  const activity = Object.values(downloads)
    .filter((d) => d.id.startsWith('tts:'))
    .map((d) => d.phase)
    .join()
  useEffect(() => {
    void refresh()
  }, [refresh, activity, s.ttsQuality])

  if (!engines) return <Spinner />
  const top = recs[0]
  return (
    <div className="space-y-2.5">
      {top && (
        <Notice tone="info">
          <span className="font-semibold">
            {top.role}: {engines.find((e) => e.id === top.id.split(':')[0])?.name}, {top.id.split(':')[1]} quality.
          </span>{' '}
          {top.reason}
        </Notice>
      )}
      <div className="flex items-center gap-2">
        <span className="text-ink-2">Voice quality</span>
        <div className="flex gap-1 rounded-md bg-surface-2 p-1">
          {(['fast', 'balanced', 'highest'] as const)
            .filter((q) => q !== 'highest' || engines.some((e) => e.tier === 'highest'))
            .map((q) => (
            <button key={q} onClick={() => void update({ ttsQuality: q })} className={cx('rounded px-3 py-1 text-[13px] font-semibold capitalize', s.ttsQuality === q ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink')}>
              {q === 'highest' ? 'Highest quality' : q}
            </button>
          ))}
        </div>
      </div>
      {engines.map((e) => {
        const dl = downloads[`tts:${e.id}`]
        const active = s.ttsEngine === e.id
        const busy = !!dl && dl.phase !== 'done' && dl.phase !== 'error' && dl.phase !== 'cancelled'
        return (
          <div key={e.id} className={cx('rounded-lg border p-3', active ? 'border-accent' : 'border-line')}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{e.name}</span>
                  <span className="num text-[12.5px] text-ink-3">
                    {formatBytes(e.sizeBytes)} download · about {e.minMemoryGb} GB of memory · {e.needsGpu ? 'needs a graphics card' : 'runs on the processor'} · {e.license}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {e.state === 'installed' && <Badge tone="good">Installed</Badge>}
                  {e.state === 'downloading' && <Badge tone="accent">Downloading</Badge>}
                  {e.state === 'not_installed' && <Badge>Not installed</Badge>}
                  {e.state === 'broken' && <Badge tone="bad">Needs repair</Badge>}
                  {e.state === 'incompatible' && <Badge tone="warn">Not compatible with this computer</Badge>}
                  {active && <Badge tone="accent">In use</Badge>}
                  {e.measuredSpeed != null && <Badge>Measured here: {e.measuredSpeed}× faster than real time</Badge>}
                </div>
                <div className="mt-1.5 text-[13px] text-ink-2">{e.description}</div>
                {e.message && <div className="mt-1 text-[12.5px] text-warn">{e.message}</div>}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {e.state === 'installed' ? (
                  <>
                    {!active && (
                      <Button size="sm" variant="primary" onClick={() => void update({ ttsEngine: e.id })}>
                        Use this engine
                      </Button>
                    )}
                    <Button
                      size="sm"
                      icon={<Gauge size={13} />}
                      busy={bench === e.id}
                      onClick={async () => {
                        setBench(e.id)
                        try {
                          const speed = await api.tts.benchmark(e.id)
                          toast('success', `${e.name} generates speech ${speed}× faster than real time on this computer.`)
                          await refresh()
                        } catch (err) {
                          toast('error', errorText(err))
                        } finally {
                          setBench(null)
                        }
                      }}
                    >
                      Measure speed
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      icon={<Trash2 size={13} />}
                      onClick={async () => {
                        await api.tts.remove(e.id)
                        await refresh()
                      }}
                    >
                      Remove
                    </Button>
                  </>
                ) : busy ? null : (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={e.state === 'broken' ? <Wrench size={13} /> : <Download size={13} />}
                    disabled={e.state === 'incompatible'}
                    onClick={async () => {
                      try {
                        await api.tts.install(e.id)
                        if (s.ttsEngine !== e.id) await update({ ttsEngine: e.id })
                        toast('success', `${e.name} is installed`)
                      } catch (err) {
                        const m = errorText(err)
                        if (!/cancel/i.test(m)) toast('error', m)
                      }
                      await refresh()
                    }}
                  >
                    {e.state === 'broken' ? 'Repair' : `Download ${formatBytes(e.sizeBytes)}`}
                  </Button>
                )}
              </div>
            </div>
            {dl && <div className="mt-2.5"><DownloadRow p={dl} onCancel={() => void api.downloads.cancel(`tts:${e.id}`)} /></div>}
          </div>
        )
      })}
      <p className="text-[12.5px] text-ink-3">Once a voice engine is installed, speech is generated on this computer and works without an internet connection.</p>
    </div>
  )
}
