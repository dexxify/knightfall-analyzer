import { useEffect, useState, type ReactNode } from 'react'
import { Check, Copy, Download, Pencil, Plus, RotateCcw, Sparkles, Square, Trash2, Upload, Volume2 } from 'lucide-react'
import type { ExplainMode, TtsVoice } from '@shared/types'
import { DEFAULT_TRAITS, type CoachProfile, type CoachTraits } from '@shared/coach'
import { api, errorText } from '../lib/api'
import { useApp, useSettings } from '../lib/store'
import { speech, useSpeech } from '../lib/speech'
import { CoachAvatar } from '../components/chess'
import { Badge, Button, cx, IconButton, Modal, Notice, Select, Slider } from '../components/ui'

const CATEGORIES: { id: CoachProfile['category']; label: string; blurb: string }[] = [
  { id: 'friendly', label: 'Friendly and educational', blurb: 'Clear teaching, good company.' },
  { id: 'competitive', label: 'Competitive', blurb: 'Serious improvement, no flattery.' },
  { id: 'aggressive', label: 'Mean and aggressive', blurb: 'They will not be nice about it. Some of them swear.' },
  { id: 'unusual', label: 'Unusual', blurb: 'The same chess, through a different lens.' },
  { id: 'custom', label: 'Your coaches', blurb: 'Coaches you created or imported.' }
]

const TRAIT_LABELS: [keyof CoachTraits, string][] = [
  ['humor', 'Humour'],
  ['sarcasm', 'Sarcasm'],
  ['profanity', 'Profanity'],
  ['aggressiveness', 'Aggressiveness'],
  ['encouragement', 'Encouragement'],
  ['technicalDepth', 'Technical level'],
  ['intensity', 'Emotional intensity']
]

function TraitBars({ t }: { t: CoachTraits }): ReactNode {
  const show: [keyof CoachTraits, string][] = [
    ['humor', 'Humour'],
    ['aggressiveness', 'Bluntness'],
    ['encouragement', 'Praise'],
    ['technicalDepth', 'Depth'],
    ['profanity', 'Profanity']
  ]
  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-3">
      {show.map(([k, label]) => (
        <div key={k} className="contents">
          <span>{label}</span>
          <span className="h-1 overflow-hidden rounded-full bg-surface-3">
            <span className="block h-full rounded-full bg-ink-3" style={{ width: `${t[k] * 10}%` }} />
          </span>
        </div>
      ))}
    </div>
  )
}

function usePreview(): { playing: string | null; preview: (c: CoachProfile, voice?: string) => void } {
  const [playing, setPlaying] = useState<string | null>(null)
  const status = useSpeech((s) => s.status)
  useEffect(() => {
    if (status === 'idle') setPlaying(null)
  }, [status])
  return {
    playing,
    preview: (c, voice) => {
      if (playing === c.id) {
        speech.stop()
        setPlaying(null)
        return
      }
      setPlaying(c.id)
      speech.speakText(c.intro, c.id, voice)
    }
  }
}

function CoachCard({ c, selected, onSelect, onEdit, playing, onPreview }: { c: CoachProfile; selected: boolean; onSelect: () => void; onEdit: () => void; playing: boolean; onPreview: () => void }): ReactNode {
  return (
    <div className={cx('flex flex-col rounded-lg border bg-surface p-4 transition-colors', selected ? 'border-accent' : 'border-line hover:border-line-strong')}>
      <div className="flex items-start gap-3">
        <CoachAvatar coach={c} size={52} ring={selected} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[17px]">{c.name}</h3>
            {selected && <Badge tone="accent">Selected</Badge>}
          </div>
          <div className="text-[13px] text-ink-2">{c.tagline}</div>
        </div>
      </div>
      <p className="selectable mt-3 flex-1 text-[13px] leading-relaxed text-ink-2">{c.description}</p>
      <div className="mt-3 flex items-center gap-2 text-[12px] text-ink-3">
        <Badge>{c.approach || 'Custom approach'}</Badge>
        {c.traits.profanity >= 7 && <Badge tone="warn">Strong language</Badge>}
      </div>
      <div className="mt-3">
        <TraitBars t={c.traits} />
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" variant={selected ? 'default' : 'primary'} icon={selected ? <Check size={13} /> : undefined} onClick={onSelect} disabled={selected}>
          {selected ? 'Your coach' : 'Choose'}
        </Button>
        <Button size="sm" icon={playing ? <Square size={12} /> : <Volume2 size={14} />} onClick={onPreview}>
          {playing ? 'Stop' : 'Hear the voice'}
        </Button>
        <div className="flex-1" />
        <IconButton label={`Customise ${c.name}`} onClick={onEdit}>
          <Pencil size={14} />
        </IconButton>
      </div>
    </div>
  )
}

function blankCoach(id: string): CoachProfile {
  return {
    id,
    name: 'My Coach',
    tagline: '',
    description: '',
    category: 'custom',
    builtin: false,
    approach: '',
    traits: { ...DEFAULT_TRAITS },
    sentenceLength: 'medium',
    vocabulary: [],
    intro: "Hello. I'm your coach. Let's look at your game.",
    avatar: { glyph: 'knight', color: '#7a8794', image: null },
    voice: { kokoro: 'am_michael', design: '', referenceClip: null, referenceText: null, speed: 1 },
    language: null,
    explainMode: null,
    prompt: ''
  }
}

function Editor({ initial, isNew, onClose }: { initial: CoachProfile; isNew: boolean; onClose: () => void }): ReactNode {
  const { refreshCoaches, toast, update } = useApp()
  const s = useSettings()
  const [c, setC] = useState<CoachProfile>(initial)
  const [describe, setDescribe] = useState('')
  const [generating, setGenerating] = useState(false)
  const [voices, setVoices] = useState<TtsVoice[]>([])
  const [customized, setCustomized] = useState(false)
  const [consent, setConsent] = useState(false)
  const [transcript, setTranscript] = useState(initial.voice.referenceText ?? '')
  const set = (p: Partial<CoachProfile>): void => setC((x) => ({ ...x, ...p }))

  useEffect(() => {
    void api.tts.voices(s.ttsEngine).then(setVoices)
    void api.coaches.isCustomized(initial.id).then(setCustomized)
  }, [s.ttsEngine, initial.id])

  const generate = async (): Promise<void> => {
    setGenerating(true)
    try {
      const r = await api.coaches.generate(describe)
      setC({ ...r.coach, id: isNew ? r.coach.id : c.id, builtin: c.builtin, avatar: c.avatar })
      toast(r.usedAi ? 'success' : 'info', r.usedAi ? 'Your AI model turned the description into a coach. Review it below.' : 'No AI model is available, so the settings were filled in from keywords. Adjust them below.')
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setGenerating(false)
    }
  }

  const save = async (): Promise<CoachProfile | null> => {
    if (!c.name.trim()) {
      toast('error', 'Give your coach a name.')
      return null
    }
    try {
      const id = isNew ? await api.coaches.newId(c.name) : c.id
      const saved = await api.coaches.save({ ...c, id })
      await refreshCoaches()
      return saved
    } catch (e) {
      toast('error', errorText(e))
      return null
    }
  }

  const pickImage = (file: File | undefined): void => {
    if (!file) return
    if (file.size > 400_000) return toast('error', 'Choose an image smaller than 400 KB.')
    const reader = new FileReader()
    reader.onload = () => set({ avatar: { ...c.avatar, image: String(reader.result) } })
    reader.readAsDataURL(file)
  }

  return (
    <Modal
      title={isNew ? 'Create your own coach' : `Customise ${initial.name}`}
      onClose={onClose}
      width={860}
      footer={
        <>
          {!isNew && c.builtin && customized && (
            <Button
              icon={<RotateCcw size={14} />}
              onClick={async () => {
                await api.coaches.remove(c.id)
                await refreshCoaches()
                toast('info', `${initial.name} was reset to the original.`)
                onClose()
              }}
            >
              Reset to original
            </Button>
          )}
          <div className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              const saved = await save()
              if (!saved) return
              if (isNew) await update({ coachId: saved.id })
              toast('success', `${saved.name} saved`)
              onClose()
            }}
          >
            {isNew ? 'Create coach' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="mb-5 rounded-lg border border-line bg-surface-2 p-3">
        <label className="block font-semibold">
          Describe the coach you want
          <textarea
            className="field mt-1.5 h-20"
            value={describe}
            onChange={(e) => setDescribe(e.target.value)}
            placeholder="An extremely sarcastic chess coach who speaks like an angry professional gamer, swears frequently, but is genuinely excellent at explaining chess."
          />
        </label>
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-[12.5px] text-ink-3">Your installed AI model turns this into the personality, sliders, vocabulary and intro below. You can edit everything afterwards.</span>
          <Button icon={<Sparkles size={14} />} busy={generating} disabled={describe.trim().length < 12} onClick={() => void generate()}>
            Build from description
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        <div className="space-y-3">
          <label className="block">
            Name
            <input className="field mt-1" value={c.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} />
          </label>
          <label className="block">
            Tagline
            <input className="field mt-1" value={c.tagline} onChange={(e) => set({ tagline: e.target.value })} maxLength={120} />
          </label>
          <label className="block">
            Description
            <textarea className="field mt-1 h-20" value={c.description} onChange={(e) => set({ description: e.target.value })} />
          </label>
          <label className="block">
            Teaching style (one line)
            <input className="field mt-1" value={c.approach} onChange={(e) => set({ approach: e.target.value })} maxLength={80} placeholder="e.g. Tactics first, plain language" />
          </label>
          <div>
            Avatar
            <div className="mt-1.5 flex items-center gap-3">
              <CoachAvatar coach={c} size={52} />
              <div className="flex gap-1">
                {(['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'] as const).map((g) => (
                  <button key={g} onClick={() => set({ avatar: { ...c.avatar, glyph: g, image: null } })} className={cx('rounded border px-1.5 py-0.5 text-[12px] capitalize', c.avatar.glyph === g && !c.avatar.image ? 'border-accent text-accent' : 'border-line text-ink-2')}>
                    {g}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input type="color" value={c.avatar.color} onChange={(e) => set({ avatar: { ...c.avatar, color: e.target.value } })} aria-label="Avatar colour" className="h-7 w-10 cursor-pointer rounded border border-line bg-transparent" />
              <label className="cursor-pointer rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[12.5px] hover:border-line-strong">
                Use a picture…
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pickImage(e.target.files?.[0])} />
              </label>
              {c.avatar.image && (
                <button className="text-[12.5px] text-ink-2 underline" onClick={() => set({ avatar: { ...c.avatar, image: null } })}>
                  Remove picture
                </button>
              )}
            </div>
          </div>
        </div>

        <div>
          {TRAIT_LABELS.map(([k, label]) => (
            <Slider key={k} label={label} min={0} max={10} value={c.traits[k]} onChange={(v) => set({ traits: { ...c.traits, [k]: v } })} format={(v) => `${v} / 10`} />
          ))}
          <div className="mt-1 grid grid-cols-2 gap-3">
            <label className="block">
              Sentence length
              <Select
                className="mt-1"
                value={c.sentenceLength}
                onChange={(v) => set({ sentenceLength: v })}
                options={[
                  { value: 'short', label: 'Short and punchy' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'long', label: 'Long and flowing' }
                ]}
              />
            </label>
            <label className="block">
              Explains automatically
              <Select
                className="mt-1"
                value={(c.explainMode ?? '') as ExplainMode | ''}
                onChange={(v) => set({ explainMode: (v || null) as ExplainMode | null })}
                options={[
                  { value: '', label: 'Use my app setting' },
                  { value: 'every', label: 'Every move' },
                  { value: 'important', label: 'Important moves' },
                  { value: 'mistakes', label: 'Mistakes and blunders' },
                  { value: 'manual', label: 'Only when asked' }
                ]}
              />
            </label>
          </div>
        </div>

        <label className="col-span-2 block">
          Personality and teaching prompt
          <textarea className="field mt-1 h-44 font-mono text-[12.5px]" value={c.prompt} onChange={(e) => set({ prompt: e.target.value })} spellCheck={false} placeholder="Written to the coach: who they are, how they teach, how they sound." />
          <span className="mt-1 block text-[12.5px] text-ink-3">This is added to the core chess rules, which always apply: the coach can change tone, never the chess facts.</span>
        </label>
        <label className="block">
          Phrases this coach uses (comma separated)
          <input className="field mt-1" value={c.vocabulary.join(', ')} onChange={(e) => set({ vocabulary: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })} />
        </label>
        <label className="block">
          Preferred language
          <input className="field mt-1" value={c.language ?? ''} onChange={(e) => set({ language: e.target.value || null })} placeholder="Use my app setting" />
        </label>
        <label className="col-span-2 block">
          Introduction line (spoken when you preview the coach)
          <input className="field mt-1" value={c.intro} onChange={(e) => set({ intro: e.target.value })} maxLength={400} />
        </label>

        <div className="col-span-2 rounded-lg border border-line p-3">
          <div className="mb-2 font-semibold">Voice</div>
          <div className="grid grid-cols-[1fr_180px_auto] items-end gap-3">
            <label className="block">
              Voice
              <Select
                className="mt-1"
                value={c.voice.kokoro}
                onChange={(v) => set({ voice: { ...c.voice, kokoro: v } })}
                options={voices.map((v) => ({ value: v.id, label: `${v.name} — ${v.gender}, ${v.accent}. ${v.description}` }))}
              />
            </label>
            <Slider label="Speaking speed" min={0.7} max={1.4} step={0.01} value={c.voice.speed} onChange={(v) => set({ voice: { ...c.voice, speed: v } })} format={(v) => `${v.toFixed(2)}×`} />
            <Button icon={<Volume2 size={14} />} onClick={() => speech.speakText(c.intro, null, c.voice.kokoro)}>
              Preview
            </Button>
          </div>
          <label className="mt-3 block">
            Voice description
            <input className="field mt-1" value={c.voice.design} onChange={(e) => set({ voice: { ...c.voice, design: e.target.value } })} placeholder="e.g. A deep, calm male voice in his fifties with a British accent" />
            <span className="mt-1 block text-[12.5px] text-ink-3">Used by voice engines that can design a voice from a description.</span>
          </label>
          {!isNew && (
            <div className="mt-3 border-t border-line pt-3">
              <div className="font-semibold">Custom voice from a recording</div>
              <p className="mt-1 text-[12.5px] text-ink-3">For voice engines that support cloning. Only use a recording of your own voice, or one you have explicit permission to use.</p>
              <label className="mt-2 block">
                Exact words spoken in the recording
                <input className="field mt-1" value={transcript} onChange={(e) => setTranscript(e.target.value)} />
              </label>
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-[13px]">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="accent-[var(--accent)]" />I own this voice or have permission from the person to use it.
              </label>
              <div className="mt-2 flex items-center gap-3">
                <Button
                  size="sm"
                  disabled={!consent || transcript.trim().length < 4}
                  onClick={async () => {
                    try {
                      await api.coaches.save(c)
                      const r = await api.coaches.chooseVoiceReference(c.id, transcript)
                      if (r) {
                        setC(r)
                        await refreshCoaches()
                        toast('success', 'Reference recording saved.')
                      }
                    } catch (e) {
                      toast('error', errorText(e))
                    }
                  }}
                >
                  Choose a WAV recording…
                </Button>
                {c.voice.referenceClip && <Badge tone="good">Recording attached</Badge>}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

export function Coaches(): ReactNode {
  const s = useSettings()
  const { coaches, update, refreshCoaches, toast, setView } = useApp()
  const { playing, preview } = usePreview()
  const speechError = useSpeech((x) => x.error)
  const [editing, setEditing] = useState<{ coach: CoachProfile; isNew: boolean } | null>(null)

  const select = (c: CoachProfile): void => {
    void update({ coachId: c.id })
    if (!s.muted) speech.speakText(c.intro, c.id)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1180px] px-8 py-6">
        <div className="mb-1 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[26px]">Choose your coach</h1>
            <p className="mt-1 max-w-[70ch] text-ink-2">Every coach sees the same Stockfish analysis and follows the same rules about chess facts. What changes is who is talking to you.</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              icon={<Upload size={14} />}
              onClick={async () => {
                try {
                  const c = await api.coaches.importFile()
                  if (c) {
                    await refreshCoaches()
                    toast('success', `${c.name} imported`)
                  }
                } catch (e) {
                  toast('error', errorText(e))
                }
              }}
            >
              Import coach
            </Button>
            <Button variant="primary" icon={<Plus size={15} />} onClick={async () => setEditing({ coach: blankCoach(await api.coaches.newId('My Coach')), isNew: true })}>
              Create your own coach
            </Button>
          </div>
        </div>

        {speechError && (
          <div className="mt-3">
            <Notice tone="warn">
              The voice preview could not play: {speechError}{' '}
              <button className="underline" onClick={() => setView('settings', 'voice')}>
                Open voice settings
              </button>
            </Notice>
          </div>
        )}

        {CATEGORIES.map((cat) => {
          const list = coaches.filter((c) => c.category === cat.id)
          if (list.length === 0) return null
          return (
            <section key={cat.id} className="mt-7">
              <div className="mb-3 flex items-baseline gap-3">
                <h2 className="text-[19px]">{cat.label}</h2>
                <span className="text-[13px] text-ink-3">{cat.blurb}</span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(330px,1fr))] gap-4">
                {list.map((c) => (
                  <div key={c.id} className="relative flex">
                    <div className="flex w-full flex-col">
                      <CoachCard c={c} selected={s.coachId === c.id} onSelect={() => select(c)} onEdit={() => setEditing({ coach: c, isNew: false })} playing={playing === c.id} onPreview={() => preview(c)} />
                      <div className="mt-1 flex justify-end gap-3 px-1 text-[12px] text-ink-3">
                        <button
                          className="inline-flex items-center gap-1 hover:text-ink"
                          onClick={async () => {
                            const d = await api.coaches.duplicate(c.id)
                            await refreshCoaches()
                            setEditing({ coach: d, isNew: false })
                          }}
                        >
                          <Copy size={11} /> Duplicate
                        </button>
                        <button
                          className="inline-flex items-center gap-1 hover:text-ink"
                          onClick={async () => {
                            const f = await api.coaches.exportFile(c.id)
                            if (f) toast('success', `Saved to ${f}`)
                          }}
                        >
                          <Download size={11} /> Export
                        </button>
                        {!c.builtin && (
                          <button
                            className="inline-flex items-center gap-1 hover:text-bad"
                            onClick={async () => {
                              if (!window.confirm(`Delete ${c.name}?`)) return
                              await api.coaches.remove(c.id)
                              if (s.coachId === c.id) await update({ coachId: 'mentor' })
                              await refreshCoaches()
                            }}
                          >
                            <Trash2 size={11} /> Delete
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )
        })}
      </div>
      {editing && <Editor initial={editing.coach} isNew={editing.isNew} onClose={() => setEditing(null)} />}
    </div>
  )
}
