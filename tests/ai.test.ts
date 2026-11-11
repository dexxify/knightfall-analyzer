import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AnthropicCompatibleProvider, isLocalUrl, OllamaProvider, OpenAiCompatibleProvider, ProviderError, ThinkFilter } from '../src/main/ai/providers'
import { CoachService, type CoachStore } from '../src/main/ai/coach-service'
import { recommendLlm, LLM_CATALOG } from '../src/main/ai/catalog'
import { normalize, parseCoachJson, traitsFromDescription } from '../src/main/coaches'
import { encodeWav } from '../src/main/tts/engine'
import { buildCoachContext, extractSanTokens, unverifiedMoves, type ContextInput } from '@shared/context'
import { composeSystemPrompt, SentenceStream, shouldAutoExplain, speakMove, textForSpeech, traitInstructions, type CoachProfile } from '@shared/coach'
import { defaultSettings, PROVIDER_DEFAULTS } from '@shared/defaults'
import { buildReview } from '@shared/classify'
import { parseGame } from '@shared/pgn'
import type { ChatMessage, HardwareInfo, PositionAnalysis, ProviderConfig } from '@shared/types'

const ROOT = join(import.meta.dirname, '..')
const loadCoach = (id: string): CoachProfile =>
  normalize({ ...JSON.parse(readFileSync(join(ROOT, 'coaches', id, 'coach.json'), 'utf8')), prompt: readFileSync(join(ROOT, 'coaches', id, 'prompt.md'), 'utf8'), builtin: true })

// ---------- a local stand-in for LM Studio / Ollama / an Anthropic-style server ----------
let server: Server
let base = ''
let lastBody: Record<string, unknown> = {}
beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      lastBody = raw ? JSON.parse(raw) : {}
      const url = req.url ?? ''
      if (url === '/v1/models') return void res.end(JSON.stringify({ data: [{ id: 'local-model' }, { id: 'text-embedding-x' }] }))
      if (url === '/v1/chat/completions') {
        if (lastBody.model === 'missing') return void res.writeHead(404).end(JSON.stringify({ error: { message: 'model not found' } }))
        if (lastBody.model === 'empty') return void res.end('data: {"choices":[{"delta":{}}]}\n\ndata: [DONE]\n\n')
        if (!lastBody.stream) return void res.end(JSON.stringify({ choices: [{ message: { content: 'Whole answer.' } }] }))
        res.write('data: {"choices":[{"delta":{"content":"<think>secret plan"}}]}\n\n')
        res.write('data: {"choices":[{"delta":{"content":"</think>Nf3 is "}}]}\n\n')
        res.write('data: this is not json\n\n')
        res.write('data: {"choices":[{"delta":{"content":"fine."}}]}\n\n')
        return void res.end('data: [DONE]\n\n')
      }
      if (url === '/api/tags') return void res.end(JSON.stringify({ models: [{ name: 'qwen:latest' }] }))
      if (url === '/api/chat') {
        res.write(JSON.stringify({ message: { content: 'Hello ' } }) + '\n')
        return void res.end(JSON.stringify({ message: { content: 'there.' }, done: true }) + '\n')
      }
      if (url === '/v1/messages') {
        if (req.headers['x-api-key'] !== 'k') return void res.writeHead(401).end(JSON.stringify({ error: { message: 'bad key' } }))
        res.write('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Good "}}\n\n')
        return void res.end('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"move."}}\n\n')
      }
      res.writeHead(404).end('{}')
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

const cfg = (kind: ProviderConfig['kind'], over: Partial<ProviderConfig> = {}): ProviderConfig => ({ ...PROVIDER_DEFAULTS[kind], baseUrl: kind === 'ollama' || kind === 'anthropic' ? base : `${base}/v1`, model: 'local-model', timeoutMs: 5000, ...over })
const never = new AbortController().signal

describe('providers', () => {
  it('lists models and reports status (OpenAI-compatible / LM Studio)', async () => {
    const st = await new OpenAiCompatibleProvider(cfg('lmstudio'), 'LM Studio').status()
    expect(st).toMatchObject({ ok: true, models: ['local-model'], remote: false })
  })

  it('streams, hides reasoning blocks and survives a malformed chunk', async () => {
    const tokens: string[] = []
    const text = await new OpenAiCompatibleProvider(cfg('lmstudio'), 'LM Studio').chat([{ role: 'user', content: 'hi' }], (t) => tokens.push(t), never)
    expect(text).toBe('Nf3 is fine.')
    expect(tokens.join('')).toBe('Nf3 is fine.')
    expect(lastBody).toMatchObject({ model: 'local-model', stream: true })
  })

  it('supports non-streaming responses', async () => {
    expect(await new OpenAiCompatibleProvider(cfg('openai', { streaming: false }), 'server').chat([{ role: 'user', content: 'hi' }], () => undefined, never)).toBe('Whole answer.')
  })

  it('turns failures into specific messages', async () => {
    const p = (o: Partial<ProviderConfig>): OpenAiCompatibleProvider => new OpenAiCompatibleProvider(cfg('lmstudio', o), 'LM Studio')
    await expect(p({ model: 'missing' }).chat([{ role: 'user', content: 'x' }], () => undefined, never)).rejects.toThrow(/does not know this model.*model not found/)
    await expect(p({ model: 'empty' }).chat([{ role: 'user', content: 'x' }], () => undefined, never)).rejects.toThrow(/empty answer/)
    await expect(p({ model: '' }).chat([{ role: 'user', content: 'x' }], () => undefined, never)).rejects.toThrow(/No model is selected/)
    const down = await p({ baseUrl: 'http://127.0.0.1:9/v1' }).status()
    expect(down.ok).toBe(false)
    expect(down.message).toMatch(/Nothing is listening|Could not connect|did not answer/)
    await expect(p({ baseUrl: 'http://127.0.0.1:9/v1' }).chat([{ role: 'user', content: 'x' }], () => undefined, never)).rejects.toBeInstanceOf(ProviderError)
  })

  it('talks to Ollama', async () => {
    const o = new OllamaProvider(cfg('ollama', { model: 'qwen:latest' }))
    expect((await o.status()).ok).toBe(true)
    expect(await o.chat([{ role: 'user', content: 'x' }], () => undefined, never)).toBe('Hello there.')
    expect((await new OllamaProvider(cfg('ollama', { model: 'other' })).status()).message).toMatch(/not installed in it/)
  })

  it('talks to an Anthropic-style endpoint and moves the system prompt out of the turns', async () => {
    const a = new AnthropicCompatibleProvider(cfg('anthropic', { apiKey: 'k' }))
    const text = await a.chat([{ role: 'system', content: 'SYS' }, { role: 'user', content: 'x' }], () => undefined, never)
    expect(text).toBe('Good move.')
    expect(lastBody.system).toBe('SYS')
    expect(lastBody.messages).toEqual([{ role: 'user', content: 'x' }])
    await expect(new AnthropicCompatibleProvider(cfg('anthropic', { apiKey: 'wrong' })).chat([{ role: 'user', content: 'x' }], () => undefined, never)).rejects.toThrow(/rejected the API key/)
  })

  it('knows local from remote addresses', () => {
    expect(isLocalUrl('http://127.0.0.1:1234/v1')).toBe(true)
    expect(isLocalUrl('http://localhost:11434')).toBe(true)
    expect(isLocalUrl('https://api.example.com')).toBe(false)
    expect(isLocalUrl('garbage')).toBe(false)
  })

  it('filters think blocks split across chunks', () => {
    const f = new ThinkFilter()
    expect(f.push('Hello <thi') + f.push('nk>hidden</th') + f.push('ink> world') + f.flush()).toBe('Hello  world')
  })
})

// ---------- context ----------
const g = parseGame('[White "Ann"]\n[Black "Bob"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0')
const line = (cp: number | { mate: number }, pv: string[], pvSan: string[], multipv = 1) => ({ multipv, depth: 12, score: typeof cp === 'number' ? ({ type: 'cp', value: cp } as const) : ({ type: 'mate', value: cp.mate } as const), pv, pvSan })
const an = (lines: ReturnType<typeof line>[]): PositionAnalysis => ({ fen: '', depth: 12, bestMove: lines[0].pv[0], lines })
const review = buildReview({
  plies: g.plies,
  analyses: [
    an([line(30, ['e2e4'], ['e4'])]),
    an([line(25, ['e7e5'], ['e5'])]),
    an([line(30, ['g1f3'], ['Nf3'])]),
    an([line(-20, ['b8c6'], ['Nc6'])]),
    an([line(-10, ['f1c4'], ['Bc4'])]),
    an([line(-40, ['g7g6', 'h5f3', 'g8f6'], ['g6', 'Qf3', 'Nf6']), line(-10, ['d8e7'], ['Qe7'], 2)]),
    an([line({ mate: 1 }, ['h5f7'], ['Qxf7#'])]),
    { fen: '', depth: 0, lines: [], bestMove: null, terminal: 'checkmate' }
  ],
  legalMoveCounts: g.plies.map(() => 25),
  preset: { id: 'quick', label: 'Quick', depth: 12, movetimeMs: 100, multipv: 2 },
  engineName: 'Stockfish test'
})
const input = (i: number, over: Partial<ContextInput> = {}): ContextInput => ({
  mode: 'game',
  language: 'English',
  skillLevel: 'beginner',
  game: { white: 'Ann', black: 'Bob', whiteElo: null, blackElo: null, result: '1-0', opening: null },
  playerColor: 'b',
  move: g.plies[i],
  review: review.moves[i],
  ...over
})

describe('coach context', () => {
  it('carries the engine facts for a blunder', () => {
    const c = buildCoachContext(input(5))
    expect(c).toMatchObject({ mode: 'game', player: 'black', moverIsPlayer: true, classification: 'Blunder', dataQuality: 'full', sideToMoveAfter: 'white' })
    expect(c.move).toMatchObject({ san: 'Nf6', label: '3... Nf6', color: 'black' })
    expect(c.best).toEqual({ san: 'g6', line: '3... g6 4. Qf3 Nf6' })
    expect(c.playedLine).toBe('4. Qxf7#')
    expect(c.alternatives[0]).toMatchObject({ san: 'Qe7' })
    expect(c.evalAfter!.text).toMatch(/White has a forced mate in 1/)
    expect(c.evalAfter!.winChanceForMover).toBe(0)
    expect(c.recentMoves).toEqual([])
  })

  it('flags checkmate and omits "best" when the best move was played', () => {
    const c = buildCoachContext(input(6, { playerColor: 'w' }))
    expect(c.flags).toMatchObject({ isCheckmate: true, isCapture: true, playedBestMove: true })
    expect(c.best).toBeNull()
    expect(c.evalAfter!.white).toBe('checkmate')
  })

  it('marks missing engine data instead of guessing', () => {
    const c = buildCoachContext(input(1, { review: null }))
    expect(c.dataQuality).toBe('missing')
    expect(c.evalBefore).toBeNull()
    expect(c.classification).toBeNull()
  })

  it('describes a variation from live analysis and labels it as hypothetical', () => {
    const p = g.plies[5]
    const c = buildCoachContext(
      input(5, {
        mode: 'variation',
        review: null,
        move: { san: 'g6', uci: 'g7g6', color: 'b', fenBefore: p.fenBefore, fenAfter: 'r1bqkbnr/pppp1p1p/2n3p1/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 4' },
        before: an([line(-40, ['g7g6'], ['g6'])]),
        after: an([line(-35, ['h5f3'], ['Qf3'])]),
        variation: { branchedFrom: 'after 3. Bc4', sans: ['g6'], startFen: p.fenBefore }
      })
    )
    expect(c).toMatchObject({ mode: 'variation', dataQuality: 'full', classification: null })
    expect(c.variation).toEqual({ branchedFrom: 'after 3. Bc4', moves: '3... g6' })
    expect(c.winChanceLost).toBe(0.5)
  })

  it('detects moves the model made up', () => {
    const c = buildCoachContext(input(5))
    expect(extractSanTokens('Play Nf3, then O-O and exd5; the pawn on e4 is fine. Qxf7# ends it.')).toEqual(['Nf3', 'O-O', 'exd5', 'Qxf7'])
    expect(unverifiedMoves('You allowed Qxf7#. Better was g6, and after Qf3 you play Nf6.', c)).toEqual([])
    expect(unverifiedMoves('Better was Rd8 followed by Bb4.', c)).toEqual(['Rd8', 'Bb4'])
  })
})

// ---------- coach profiles, prompt, speech text ----------
describe('coaches', () => {
  const ids = JSON.parse(readFileSync(join(ROOT, 'coaches', 'index.json'), 'utf8')) as string[]
  const all = ids.map(loadCoach)
  const core = readFileSync(join(ROOT, 'AI_SYSTEM_PROMPT.md'), 'utf8')

  it('ships twenty complete profiles, each with its own voice', () => {
    expect(all).toHaveLength(20)
    expect(readdirSync(join(ROOT, 'coaches')).filter((d) => !d.endsWith('.json')).sort()).toEqual([...ids].sort())
    expect(new Set(all.map((c) => c.voice.kokoro)).size).toBe(20)
    expect(new Set(all.map((c) => c.name)).size).toBe(20)
    for (const c of all) {
      expect(c.prompt.length, c.id).toBeGreaterThan(400)
      expect(c.intro.length, c.id).toBeGreaterThan(20)
      expect(c.voice.design.length, c.id).toBeGreaterThan(20)
      expect(c.description.length, c.id).toBeGreaterThan(40)
    }
  })

  it('composes a prompt where personality differs but the chess rules do not', () => {
    const mentor = composeSystemPrompt(core, loadCoach('mentor'), 'beginner', 'English')
    const toxic = composeSystemPrompt(core, loadCoach('toxic-best-friend'), 'beginner', 'English')
    for (const p of [mentor, toxic]) {
      expect(p).toContain('Never calculate lines yourself')
      expect(p).toContain('The player is a beginner. Respond in English.')
      expect(p).not.toContain('Everything below the line is sent to the model')
    }
    expect(mentor).toContain('Profanity: none at all')
    expect(toxic).toContain('you swear freely and vividly')
    expect(toxic).toContain('Toxic Best Friend')
    expect(mentor).not.toBe(toxic)
  })

  it('turns sliders into instructions', () => {
    const c = loadCoach('mentor')
    const loud = traitInstructions({ ...c, traits: { ...c.traits, sarcasm: 9, encouragement: 0 } })
    expect(loud).toContain('heavy, biting sarcasm')
    expect(loud).toContain('you do not hand out praise')
  })

  it('normalises hostile or incomplete profiles', () => {
    const c = normalize({ id: '../../Evil Coach!!', name: 'X', traits: { humor: 999, sarcasm: -5 } as never, avatar: { glyph: 'dragon' as never, color: 'red' } })
    expect(c.id).toBe('evil-coach')
    expect(c.traits.humor).toBe(10)
    expect(c.traits.sarcasm).toBe(0)
    expect(c.avatar).toMatchObject({ glyph: 'knight', color: '#8a8f98' })
    expect(c.category).toBe('custom')
  })

  it('derives traits from a description and parses model JSON defensively', () => {
    const t = traitsFromDescription('An extremely sarcastic coach who speaks like an angry professional gamer and swears frequently')
    expect(t.sarcasm).toBeGreaterThanOrEqual(8)
    expect(t.profanity).toBeGreaterThanOrEqual(8)
    expect(t.aggressiveness).toBeGreaterThanOrEqual(8)
    expect(parseCoachJson('Sure! ```json\n{"name":"The Owl","traits":{}}\n``` done')).toMatchObject({ name: 'The Owl' })
    expect(parseCoachJson('no json here')).toBeNull()
    expect(parseCoachJson('{broken')).toBeNull()
  })

  it('decides when to speak up', () => {
    expect(shouldAutoExplain('every', null)).toBe(true)
    expect(shouldAutoExplain('manual', 'blunder')).toBe(false)
    expect(shouldAutoExplain('important', 'best')).toBe(false)
    expect(shouldAutoExplain('important', 'brilliant')).toBe(true)
    expect(shouldAutoExplain('mistakes', 'inaccuracy')).toBe(false)
    expect(shouldAutoExplain('mistakes', 'missed_win')).toBe(true)
  })
})

describe('speech text', () => {
  it('pronounces moves', () => {
    expect(speakMove('Nxf7+')).toBe('knight takes f7, check')
    expect(speakMove('O-O-O')).toBe('castles queenside')
    expect(speakMove('exd5')).toBe('e pawn takes d5')
    expect(speakMove('e8=Q#')).toBe('e8, promoting to a queen, checkmate')
    expect(speakMove('Rad1')).toBe('rook a to d1')
  })
  it('cleans markdown, move numbers and evaluations', () => {
    expect(textForSpeech('**Bold** move: 12... Nf6 was fine, but 13. Qxf7# ends it (+1.5).')).toBe('Bold move: knight to f6 was fine, but queen takes f7, checkmate ends it (plus 1.5).')
    expect(textForSpeech('The e4 square is weak.')).toBe('The e4 square is weak.')
  })
  it('splits a token stream into sentences without breaking on decimals or move numbers', () => {
    const s = new SentenceStream()
    const out: string[] = []
    for (const chunk of ['You were +1', '.5 ahead after 12', '. Nf3 and then', ' it fell apart! Why? ', 'Because the knight left.']) out.push(...s.push(chunk))
    out.push(...s.flush())
    expect(out).toEqual(['You were +1.5 ahead after 12. Nf3 and then it fell apart!', 'Why? Because the knight left.'])
  })
  it('encodes WAV audio', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]), 24000)
    const v = new DataView(wav.buffer)
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF')
    expect(v.getUint32(24, true)).toBe(24000)
    expect(v.getUint32(40, true)).toBe(8)
    expect(v.getInt16(46, true)).toBe(32767)
    expect(v.getInt16(48, true)).toBe(-32768)
  })
})

// ---------- coach service ----------
describe('coach service', () => {
  const mem = { expl: new Map<string, string>(), msgs: [] as ChatMessage[] }
  const store: CoachStore = {
    getExplanation: (g2, c, p, m) => mem.expl.get([g2, c, p, m].join('|')) ?? null,
    saveExplanation: (g2, c, p, m, t) => void mem.expl.set([g2, c, p, m].join('|'), t),
    addMessage: (_g, _c, _p, m) => void mem.msgs.push(m),
    recentMessages: (_g, n) => mem.msgs.slice(-n)
  }
  const settings = { ...defaultSettings(8, 16), provider: { ...PROVIDER_DEFAULTS.builtin, model: 'fake' }, skillLevel: 'beginner' as const }
  let seen: ChatMessage[] = []
  let calls = 0
  const svc = (answer: string, delay = 0): CoachService =>
    new CoachService({
      settings: () => settings,
      corePrompt: () => readFileSync(join(ROOT, 'AI_SYSTEM_PROMPT.md'), 'utf8'),
      coach: (id) => (id === 'gone' ? null : loadCoach(id)),
      store,
      provider: () => ({
        kind: 'builtin',
        remote: false,
        status: async () => ({ ok: true, message: '', models: [], remote: false }),
        chat: async (messages, onToken, signal) => {
          calls++
          seen = messages
          if (delay) await new Promise((r) => setTimeout(r, delay))
          if (signal.aborted) throw new Error('aborted')
          onToken(answer)
          return answer
        }
      })
    })

  it('sends the system prompt plus verified context, and caches the explanation', async () => {
    const s = svc('You allowed Qxf7#. Better was g6.')
    const tokens: string[] = []
    const r = await s.explain({ requestId: 'a', gameId: 1, coachId: 'mentor', positionKey: 'ply:6', context: input(5) }, (t) => tokens.push(t))
    expect(r).toMatchObject({ cached: false, unverified: [], model: 'builtin:fake' })
    expect(tokens.join('')).toBe(r.text)
    expect(seen[0].role).toBe('system')
    expect(seen[0].content).toContain('The Mentor')
    expect(seen.at(-1)!.content).toContain('"classification": "Blunder"')
    expect(seen.at(-1)!.content).toContain('"skillLevel": "beginner"')
    const before = calls
    const again = await s.explain({ requestId: 'b', gameId: 1, coachId: 'mentor', positionKey: 'ply:6', context: input(5) }, () => undefined)
    expect(again.cached).toBe(true)
    expect(calls).toBe(before)
    const other = await s.explain({ requestId: 'c', gameId: 1, coachId: 'toxic-best-friend', positionKey: 'ply:6', context: input(5) }, () => undefined)
    expect(other.cached).toBe(false)
    expect(seen[0].content).toContain('Toxic Best Friend')
    const regen = await s.explain({ requestId: 'd', gameId: 1, coachId: 'mentor', positionKey: 'ply:6', context: input(5), regenerate: true }, () => undefined)
    expect(regen.cached).toBe(false)
  })

  it('includes earlier turns for follow-up questions and never caches them', async () => {
    const s = svc('Because the queen and bishop both aim at f7.')
    const before = calls
    await s.explain({ requestId: 'e', gameId: 1, coachId: 'mentor', positionKey: 'ply:6', context: input(5), question: 'Why is this a blunder?' }, () => undefined)
    await s.explain({ requestId: 'f', gameId: 1, coachId: 'mentor', positionKey: 'ply:6', context: input(5), question: 'Why is this a blunder?' }, () => undefined)
    expect(calls).toBe(before + 2)
    expect(seen.length).toBeGreaterThan(3)
    expect(seen.some((m) => m.role === 'assistant')).toBe(true)
    expect(seen.at(-1)!.content).toContain('The player asks: Why is this a blunder?')
    expect(seen.slice(1, -1).every((m) => !m.content.includes('POSITION CONTEXT'))).toBe(true)
  })

  it('flags invented moves and can be cancelled', async () => {
    const r = await svc('Try Rd8 and then Bb4.').explain({ requestId: 'g', gameId: null, coachId: 'mentor', positionKey: 'ply:6', context: input(5) }, () => undefined)
    expect(r.unverified).toEqual(['Rd8', 'Bb4'])
    const slow = svc('late', 200)
    const p = slow.explain({ requestId: 'h', gameId: null, coachId: 'mentor', positionKey: 'ply:6', context: input(5) }, () => undefined)
    slow.cancel('h')
    await expect(p).rejects.toThrow(/Cancelled/)
    await expect(svc('x').explain({ requestId: 'i', gameId: null, coachId: 'gone', positionKey: 'p', context: input(5) }, () => undefined)).rejects.toThrow(/no longer exists/)
  })
})

describe('model recommendations', () => {
  const hw = (over: Partial<HardwareInfo>): HardwareInfo => ({ platform: 'win32', arch: 'x64', cpuModel: 'cpu', cpuCores: 8, ramGb: 16, freeDiskGb: 100, gpus: [], acceleration: ['cpu'], ...over })
  it('never recommends more than the machine can hold', () => {
    const gpu16 = recommendLlm(hw({ gpus: [{ name: 'GPU', vramGb: 16 }], acceleration: ['vulkan', 'cpu'] }))
    expect(gpu16[0].id).toBe('qwen3.5-9b-q4')
    const gpu32 = recommendLlm(hw({ gpus: [{ name: 'GPU', vramGb: 32 }], acceleration: ['cuda', 'cpu'] }))
    expect(gpu32[0].id).toBe('qwen3.5-27b-q4')
    const laptop = recommendLlm(hw({ ramGb: 8 }))
    expect(['qwen3.5-2b-q4', 'qwen3.5-4b-q4']).toContain(laptop[0].id)
    const tiny = recommendLlm(hw({ ramGb: 4 }))
    expect(tiny[0].id).toBe('qwen3.5-2b-q4')
    for (const r of [...gpu16, ...laptop]) expect(LLM_CATALOG.some((e) => e.id === r.id)).toBe(true)
    expect(gpu16.find((r) => r.id === 'qwen3.5-27b-q4')!.reason).toMatch(/not recommended/)
  })
})
