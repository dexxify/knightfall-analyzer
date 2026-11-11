import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { DEFAULT_TRAITS, slugify, type CoachProfile, type CoachTraits } from '@shared/coach'
import { paths } from './system/paths'

/**
 * Coach profiles live on disk, one folder per coach:
 *   <coach>/coach.json   structured configuration (traits, voice, avatar, intro…)
 *   <coach>/prompt.md    personality + teaching prompt
 * Built-in coaches ship read-only with the app; edits and custom coaches are stored in the
 * user's data folder and take precedence, so "Reset to default" is just deleting the override.
 */

const builtinDir = (): string => join(paths.resources(), 'coaches')

function readCoach(dir: string, builtin: boolean): CoachProfile | null {
  try {
    const cfg = JSON.parse(readFileSync(join(dir, 'coach.json'), 'utf8')) as Partial<CoachProfile>
    const prompt = existsSync(join(dir, 'prompt.md')) ? readFileSync(join(dir, 'prompt.md'), 'utf8') : ''
    if (!cfg.id || !cfg.name) return null
    return normalize({ ...cfg, prompt, builtin } as CoachProfile)
  } catch {
    return null
  }
}

const clamp = (n: unknown, d: number): number => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(10, Math.round(n))) : d)

/** Fill in anything missing so a hand-edited or imported profile can never break the app. */
export function normalize(c: Partial<CoachProfile> & { id: string; name: string }): CoachProfile {
  const t = (c.traits ?? {}) as Partial<CoachTraits>
  const traits = Object.fromEntries((Object.keys(DEFAULT_TRAITS) as (keyof CoachTraits)[]).map((k) => [k, clamp(t[k], DEFAULT_TRAITS[k])])) as unknown as CoachTraits
  const glyphs = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn']
  return {
    id: slugify(c.id),
    name: String(c.name).slice(0, 60),
    tagline: String(c.tagline ?? '').slice(0, 120),
    description: String(c.description ?? '').slice(0, 600),
    category: (['friendly', 'competitive', 'aggressive', 'unusual', 'custom'] as const).includes(c.category as never) ? c.category! : 'custom',
    builtin: !!c.builtin,
    approach: String(c.approach ?? '').slice(0, 80),
    traits,
    sentenceLength: (['short', 'medium', 'long'] as const).includes(c.sentenceLength as never) ? c.sentenceLength! : 'medium',
    vocabulary: Array.isArray(c.vocabulary) ? c.vocabulary.map(String).slice(0, 16) : [],
    intro: String(c.intro ?? `Hello, I'm ${c.name}. Let's look at your game.`).slice(0, 400),
    avatar: {
      glyph: glyphs.includes(c.avatar?.glyph as string) ? c.avatar!.glyph : 'knight',
      color: /^#[0-9a-fA-F]{6}$/.test(c.avatar?.color ?? '') ? c.avatar!.color : '#8a8f98',
      image: c.avatar?.image ?? null
    },
    voice: {
      kokoro: String(c.voice?.kokoro ?? 'af_heart'),
      design: String(c.voice?.design ?? ''),
      referenceClip: c.voice?.referenceClip ?? null,
      referenceText: c.voice?.referenceText ?? null,
      speed: typeof c.voice?.speed === 'number' ? Math.max(0.6, Math.min(1.5, c.voice.speed)) : 1
    },
    language: c.language || null,
    explainMode: c.explainMode ?? null,
    prompt: String(c.prompt ?? '').slice(0, 12000)
  }
}

export function listCoaches(): CoachProfile[] {
  const out = new Map<string, CoachProfile>()
  let order: string[] = []
  try {
    order = JSON.parse(readFileSync(join(builtinDir(), 'index.json'), 'utf8')) as string[]
  } catch {
    order = existsSync(builtinDir()) ? readdirSync(builtinDir()) : []
  }
  for (const id of order) {
    const c = readCoach(join(builtinDir(), id), true)
    if (c) out.set(c.id, c)
  }
  for (const id of readdirSync(paths.coaches())) {
    const c = readCoach(join(paths.coaches(), id), out.has(id))
    if (c) out.set(c.id, c)
  }
  return [...out.values()]
}

export function getCoach(id: string): CoachProfile | null {
  return listCoaches().find((c) => c.id === id) ?? null
}

export function isCustomized(id: string): boolean {
  return existsSync(join(paths.coaches(), id, 'coach.json')) && existsSync(join(builtinDir(), id, 'coach.json'))
}

export function saveCoach(input: CoachProfile): CoachProfile {
  const c = normalize(input)
  const isBuiltin = existsSync(join(builtinDir(), c.id, 'coach.json'))
  c.builtin = isBuiltin
  if (!isBuiltin) c.category = 'custom'
  const dir = join(paths.coaches(), c.id)
  mkdirSync(dir, { recursive: true })
  const { prompt, ...cfg } = c
  writeFileSync(join(dir, 'coach.json'), JSON.stringify(cfg, null, 2))
  writeFileSync(join(dir, 'prompt.md'), prompt)
  return c
}

export function uniqueCoachId(name: string): string {
  const base = slugify(name)
  const taken = new Set(listCoaches().map((c) => c.id))
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`
}

export function duplicateCoach(id: string): CoachProfile {
  const src = getCoach(id)
  if (!src) throw new Error('That coach no longer exists.')
  const name = `${src.name} (copy)`
  return saveCoach({ ...src, id: uniqueCoachId(name), name, builtin: false, category: 'custom', voice: { ...src.voice, referenceClip: null, referenceText: null } })
}

/** Delete a custom coach, or reset a customised built-in coach to its shipped defaults. */
export function deleteCoach(id: string): void {
  const dir = join(paths.coaches(), slugify(id))
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}

export function exportCoach(id: string, file: string): void {
  const c = getCoach(id)
  if (!c) throw new Error('That coach no longer exists.')
  const { builtin: _b, ...portable } = c
  writeFileSync(file, JSON.stringify({ format: 'knightfall-coach', version: 1, coach: { ...portable, voice: { ...portable.voice, referenceClip: null, referenceText: null } } }, null, 2))
}

export function importCoach(file: string): CoachProfile {
  let data: { format?: string; coach?: Partial<CoachProfile> }
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    throw new Error('That file is not a coach file.')
  }
  if (data.format !== 'knightfall-coach' || !data.coach?.name) throw new Error('That file is not a coach file exported from this application.')
  const name = String(data.coach.name)
  return saveCoach(normalize({ ...data.coach, id: uniqueCoachId(name), name, builtin: false, category: 'custom' }))
}

/** Attach a reference recording the user owns, for engines that can clone a voice. */
export function setVoiceReference(id: string, sourceFile: string, transcript: string): CoachProfile {
  const c = getCoach(id)
  if (!c) throw new Error('That coach no longer exists.')
  const ext = extname(sourceFile).toLowerCase()
  if (ext !== '.wav') throw new Error('The reference recording must be a WAV file.')
  const dir = join(paths.coaches(), c.id)
  mkdirSync(dir, { recursive: true })
  copyFileSync(sourceFile, join(dir, 'voice-reference.wav'))
  return saveCoach({ ...c, voice: { ...c.voice, referenceClip: 'voice-reference.wav', referenceText: transcript.trim() } })
}

export function coachFile(id: string, name: string): string | null {
  for (const base of [paths.coaches(), builtinDir()]) {
    const p = join(base, slugify(id), name)
    if (existsSync(p)) return p
  }
  return null
}

const KEYWORDS: [RegExp, Partial<CoachTraits>][] = [
  [/sarcas|dry|deadpan|snark/i, { sarcasm: 8, humor: 6 }],
  [/funny|joke|humou?r|comed/i, { humor: 8 }],
  [/swear|curs|profan|vulgar|f-?bomb|foul/i, { profanity: 8 }],
  [/frequent|constantly|a lot/i, { intensity: 7 }],
  [/angry|rage|furious|aggress|brutal|harsh|mean|savage|toxic|roast/i, { aggressiveness: 8, encouragement: 2, intensity: 8 }],
  [/calm|gentle|soft|quiet|patient/i, { intensity: 2, aggressiveness: 1 }],
  [/kind|support|encourag|warm|friendly|nice/i, { encouragement: 9, aggressiveness: 1 }],
  [/expert|master|technical|advanced|professional|excellent at explaining/i, { technicalDepth: 8 }],
  [/beginner|simple|kid|child|easy/i, { technicalDepth: 2, encouragement: 8 }],
  [/energetic|excited|hype|loud|gamer|streamer/i, { intensity: 9, humor: 6 }],
  [/serious|strict|disciplin|stern/i, { humor: 1, aggressiveness: 6 }]
]

/** Deterministic fallback used when no AI model is available to interpret a description. */
export function traitsFromDescription(description: string): CoachTraits {
  const t: CoachTraits = { ...DEFAULT_TRAITS }
  for (const [re, patch] of KEYWORDS) if (re.test(description)) Object.assign(t, patch)
  return t
}

export const COACH_BUILDER_PROMPT = `You design chess coach personalities for an application. The user describes a coach in free text. Return ONLY a JSON object, no prose, with exactly these keys:
{
 "name": string (short, like "The Night Owl"),
 "tagline": string (under 60 characters),
 "description": string (1-2 sentences, third person),
 "approach": string (under 40 characters, the teaching approach),
 "traits": {"humor":0-10,"sarcasm":0-10,"profanity":0-10,"intensity":0-10,"technicalDepth":0-10,"encouragement":0-10,"aggressiveness":0-10},
 "sentenceLength": "short" | "medium" | "long",
 "vocabulary": array of 5-8 short phrases this coach would say,
 "intro": string (1-2 sentences the coach says to introduce themselves, in character),
 "voiceDesign": string (one sentence describing the voice: gender, age, accent, pitch, pace, mood),
 "gender": "male" | "female",
 "prompt": string (3 short paragraphs written to the coach in second person: who they are, how they teach chess, how they sound; must state that every reaction includes the concrete chess reason)
}
profanity 0 means none; 8-10 means swears freely. Keep the personality faithful to the description.`

export function parseCoachJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}
