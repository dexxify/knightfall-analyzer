import type { Classification, ExplainMode, SkillLevel, TtsEngineId } from './types'

/** A value from 0 (none) to 10 (maximum). */
export type Level = number

export interface CoachTraits {
  humor: Level
  sarcasm: Level
  profanity: Level
  intensity: Level
  technicalDepth: Level
  encouragement: Level
  aggressiveness: Level
}

export interface CoachVoice {
  /** Voice id per engine. Every built-in coach has a different one. */
  kokoro: string
  /** Plain-language voice description; engines with voice design build the voice from it. */
  design: string
  /** Reference recording inside the coach folder that fixes the voice identity for cloning engines. */
  referenceClip?: string | null
  referenceText?: string | null
  speed: number
}

export interface CoachProfile {
  id: string
  name: string
  tagline: string
  description: string
  category: 'friendly' | 'competitive' | 'aggressive' | 'unusual' | 'custom'
  builtin: boolean
  /** Teaching approach in one line, shown on the selection screen. */
  approach: string
  traits: CoachTraits
  sentenceLength: 'short' | 'medium' | 'long'
  vocabulary: string[]
  /** What the coach says when previewed. Spoken with the real TTS engine. */
  intro: string
  avatar: { glyph: 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn'; color: string; image?: string | null }
  voice: CoachVoice
  language: string | null
  explainMode: ExplainMode | null
  /** Contents of prompt.md: the personality and teaching prompt. */
  prompt: string
}

export const DEFAULT_TRAITS: CoachTraits = {
  humor: 3,
  sarcasm: 1,
  profanity: 0,
  intensity: 4,
  technicalDepth: 5,
  encouragement: 6,
  aggressiveness: 2
}

const scale = (v: Level, words: [string, string, string, string]): string => (v <= 1 ? words[0] : v <= 4 ? words[1] : v <= 7 ? words[2] : words[3])

/** Turn the numeric sliders into explicit instructions, so changing a slider really changes behaviour. */
export function traitInstructions(c: CoachProfile): string {
  const t = c.traits
  const lines = [
    `Humour: ${scale(t.humor, ['none; stay serious', 'occasional and light', 'frequent; you enjoy a joke', 'constant; humour is central to how you talk'])}.`,
    `Sarcasm: ${scale(t.sarcasm, ['none', 'a rare dry remark', 'regular sarcasm', 'heavy, biting sarcasm'])}.`,
    `Profanity: ${scale(t.profanity, [
      'none at all; keep it clean',
      'mild only (damn, hell), and rarely',
      'you swear naturally when the moment calls for it (shit, hell, damn), not in every sentence',
      'you swear freely and vividly (fuck, shit, hell) when a move deserves it, for both great moves and disasters; never in every sentence, and never slurs'
    ])}.`,
    `Emotional intensity: ${scale(t.intensity, ['flat and controlled', 'calm', 'animated', 'very high; big reactions'])}.`,
    `Technical depth: ${scale(t.technicalDepth, ['everyday words only', 'light chess vocabulary', 'full chess vocabulary', 'precise, expert terminology'])}.`,
    `Encouragement: ${scale(t.encouragement, ['you do not hand out praise', 'praise is rare and has to be earned', 'you encourage regularly', 'you are warmly supportive throughout'])}.`,
    `Bluntness: ${scale(t.aggressiveness, ['gentle; soften criticism', 'honest but kind', 'direct; you do not sugarcoat', 'merciless about bad decisions (the decision, never the person\'s worth)'])}.`,
    `Sentence length: ${c.sentenceLength === 'short' ? 'short, punchy sentences' : c.sentenceLength === 'long' ? 'longer, flowing sentences' : 'medium-length sentences'}.`
  ]
  if (c.vocabulary.length) lines.push(`Words and phrases that sound like you (use them sparingly and never as fixed lines): ${c.vocabulary.join('; ')}.`)
  return lines.join('\n')
}

const SKILL_TEXT: Record<SkillLevel, string> = {
  beginner: 'The player is a beginner.',
  intermediate: 'The player is an intermediate club player.',
  advanced: 'The player is an advanced player.',
  expert: 'The player is an expert.',
  auto: 'Infer the player\'s level from the ratings in the context and from their questions.'
}

/** Strip the documentation header from AI_SYSTEM_PROMPT.md (everything up to the first rule line). */
export function corePromptBody(markdown: string): string {
  const idx = markdown.indexOf('\n---\n')
  return (idx >= 0 ? markdown.slice(idx + 5) : markdown).trim()
}

export function composeSystemPrompt(core: string, coach: CoachProfile, skill: SkillLevel, language: string): string {
  return [
    corePromptBody(core),
    `\n## Your personality: ${coach.name}\n`,
    coach.prompt.trim(),
    '\n### Style settings\n',
    traitInstructions(coach),
    '\n### This session\n',
    `${SKILL_TEXT[skill]} Respond in ${coach.language || language}.`
  ].join('\n')
}

const IMPORTANT: Classification[] = ['brilliant', 'great', 'inaccuracy', 'mistake', 'blunder', 'missed_win']
const MISTAKES: Classification[] = ['mistake', 'blunder', 'missed_win']

/** Should the coach speak up on its own for this move under the chosen mode? */
export function shouldAutoExplain(mode: ExplainMode, classification: Classification | null): boolean {
  if (mode === 'manual') return false
  if (mode === 'every') return true
  if (!classification) return false
  return (mode === 'important' ? IMPORTANT : MISTAKES).includes(classification)
}

const PIECE_WORD: Record<string, string> = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight' }

/** Say a SAN move the way a person would: "Nxf7+" -> "knight takes f7, check". */
export function speakMove(san: string): string {
  if (san.startsWith('O-O-O')) return 'castles queenside' + (san.endsWith('#') ? ', checkmate' : san.endsWith('+') ? ', check' : '')
  if (san.startsWith('O-O')) return 'castles kingside' + (san.endsWith('#') ? ', checkmate' : san.endsWith('+') ? ', check' : '')
  const m = /^([KQRBN])?([a-h])?([1-8])?(x)?([a-h][1-8])(?:=([QRBN]))?([+#])?$/.exec(san)
  if (!m) return san
  const [, piece, file, rank, takes, dest, promo, suffix] = m
  const parts: string[] = []
  if (piece) parts.push(PIECE_WORD[piece])
  if (file || rank) {
    if (!piece && takes) parts.push(`${file} pawn`)
    else parts.push(`${file ?? ''}${rank ?? ''}`)
  } else if (!piece && takes) parts.push('pawn')
  if (takes) parts.push('takes')
  else if (piece) parts.push('to')
  parts.push(dest)
  let out = parts.join(' ')
  if (promo) out += `, promoting to a ${PIECE_WORD[promo]}`
  if (suffix === '#') out += ', checkmate'
  else if (suffix === '+') out += ', check'
  return out
}

const SAN_IN_TEXT = /(?<![A-Za-z0-9])(?:\d+\.(?:\.\.)?\s*)?(O-O-O|O-O|[KQRBN][a-h]?[1-8]?x?[a-h][1-8][+#]?|[a-h]x[a-h][1-8](?:=[QRBN])?[+#]?|[a-h][1-8]=[QRBN][+#]?)(?![A-Za-z0-9])/g

/** Prepare coach text for a speech engine: no markdown, moves pronounced, evaluations readable. */
export function textForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*[#>]+\s*/gm, '')
    .replace(/[*_`]+/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/(\d+)\.\.\.\s*/g, '')
    .replace(SAN_IN_TEXT, (_, san: string) => speakMove(san))
    .replace(/([+-])(\d+\.\d+)/g, (_, s: string, n: string) => `${s === '+' ? 'plus' : 'minus'} ${n}`)
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Incremental sentence splitter for streaming speech: feed it text as it arrives, and it
 * returns complete sentences as soon as they end, so speech can start before the answer is done.
 */
export class SentenceStream {
  private buffer = ''

  push(chunk: string): string[] {
    this.buffer += chunk
    const out: string[] = []
    // A sentence ends at . ! ? followed by whitespace; decimals ("+1.5") and move numbers ("12.") are not ends.
    const re = /[.!?…]+["')\]]*\s+/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(this.buffer))) {
      const end = m.index + m[0].length
      const candidate = this.buffer.slice(last, end)
      const before = this.buffer.slice(Math.max(0, m.index - 3), m.index)
      if (/\d$/.test(before) && m[0].trim() === '.') continue
      if (candidate.trim().length < 12) continue
      out.push(candidate.trim())
      last = end
    }
    this.buffer = this.buffer.slice(last)
    return out
  }

  flush(): string[] {
    const rest = this.buffer.trim()
    this.buffer = ''
    return rest ? [rest] : []
  }
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'coach'
  )
}

export const TTS_ENGINE_LABEL: Record<TtsEngineId, string> = { kokoro: 'Kokoro', qwen3: 'Qwen3-TTS' }
