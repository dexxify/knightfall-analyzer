import { create } from 'zustand'
import { SentenceStream, shouldAutoExplain } from '@shared/coach'
import type { ContextInput } from '@shared/context'
import type { ExplainRequest } from '@shared/api'
import { api, errorText, onEvent } from './api'
import { analysisFor, currentMove, positionKey, useGame } from './game'
import { useApp } from './store'
import { speech } from './speech'

export interface ThreadItem {
  id: string
  positionKey: string
  label: string
  role: 'coach' | 'user'
  coachId: string
  text: string
  streaming: boolean
  auto: boolean
  unverified: string[]
  error?: string
}

interface CoachState {
  items: ThreadItem[]
  busy: boolean
  /** False when no usable AI model is connected; automatic explanations then stay quiet. */
  aiReady: boolean
  loadThread(gameId: number): Promise<void>
  clear(): void
}

export const useCoach = create<CoachState>((set) => ({
  items: [],
  busy: false,
  aiReady: false,
  async loadThread(gameId) {
    const msgs = await api.ai.messages(gameId)
    const items: ThreadItem[] = msgs
      .filter((m) => m.role !== 'system' && !(m.role === 'user' && m.content.startsWith('(Explain ')))
      .map((m, i) => ({
        id: `h${i}`,
        positionKey: m.positionKey,
        label: '',
        role: m.role === 'user' ? 'user' : 'coach',
        coachId: m.coachId,
        text: m.content,
        streaming: false,
        auto: false,
        unverified: []
      }))
    set({ items, busy: false })
  },
  clear() {
    set({ items: [], busy: false })
  }
}))

let active: { requestId: string; itemId: string; splitter: SentenceStream; gen: number; speak: boolean; coachId: string } | null = null
let counter = 0
let autoTimer: ReturnType<typeof setTimeout> | null = null
let lastAutoKey = ''

const patch = (id: string, p: Partial<ThreadItem>): void => useCoach.setState((s) => ({ items: s.items.map((it) => (it.id === id ? { ...it, ...p } : it)) }))

onEvent('ai:token', ({ requestId, text }) => {
  if (!active || active.requestId !== requestId) return
  const a = active
  useCoach.setState((s) => ({ items: s.items.map((it) => (it.id === a.itemId ? { ...it, text: it.text + text } : it)) }))
  if (a.speak) for (const sentence of a.splitter.push(text)) speech.say(a.gen, sentence, a.coachId)
})

/** Stop the request in flight and whatever is being spoken. */
export function cancelCoach(): void {
  if (autoTimer) clearTimeout(autoTimer)
  if (active) {
    void api.ai.cancel(active.requestId)
    const id = active.itemId
    useCoach.setState((s) => ({ items: s.items.filter((it) => !(it.id === id && it.streaming && !it.text)).map((it) => (it.id === id ? { ...it, streaming: false } : it)), busy: false }))
    active = null
  }
  speech.begin()
}

function buildContext(): { input: ContextInput; key: string; label: string; hasData: boolean } | null {
  const g = useGame.getState()
  const move = currentMove(g)
  if (!g.loaded || !move) return null
  const rec = g.loaded.record
  const inVar = move.ply === null
  const plies = g.loaded.game.plies
  const recentEnd = inVar ? (g.variation?.basePly ?? 0) : (move.ply ?? 1) - 1
  const recent = plies.slice(Math.max(0, recentEnd - 6), recentEnd).map((p) => ({ san: p.san, color: p.color, moveNumber: p.moveNumber, classification: g.review?.moves[p.ply - 1]?.classification ?? null }))
  const before = analysisFor(move.fenBefore)
  const after = analysisFor(move.fenAfter)
  const moveNumber = Number(move.fenBefore.split(' ')[5]) || 1
  const input: ContextInput = {
    mode: inVar ? 'variation' : 'game',
    language: '',
    skillLevel: 'auto',
    game: { white: rec.white, black: rec.black, whiteElo: rec.whiteElo, blackElo: rec.blackElo, result: rec.result, opening: g.loaded.opening?.name ?? rec.opening },
    playerColor: g.playerColor,
    move: { san: move.san, uci: move.uci, color: move.color, fenBefore: move.fenBefore, fenAfter: move.fenAfter },
    review: move.review,
    before: move.review ? null : before,
    after: move.review ? null : after,
    inBook: !inVar && !!g.loaded.opening && (move.ply ?? 99) <= g.loaded.opening.lastBookPly,
    recent,
    variation:
      inVar && g.variation
        ? {
            branchedFrom: g.variation.basePly === 0 ? 'the starting position' : `after ${plies[g.variation.basePly - 1].moveNumber}${plies[g.variation.basePly - 1].color === 'w' ? '.' : '...'} ${plies[g.variation.basePly - 1].san}`,
            sans: g.variation.moves.slice(0, g.variation.cursor).map((m) => m.san),
            startFen: g.variation.moves[0].fenBefore
          }
        : undefined
  }
  return { input, key: positionKey(g), label: `${moveNumber}${move.color === 'w' ? '.' : '...'} ${move.san}`, hasData: !!move.review || (!!before && !!after) }
}

/** Ask the coach about the move on the board. With no question, this is the move explanation. */
export async function explain(opts: { question?: string; regenerate?: boolean; auto?: boolean } = {}): Promise<void> {
  const app = useApp.getState()
  const s = app.settings
  const g = useGame.getState()
  const built = buildContext()
  if (!s || !g.loaded || !built) return
  cancelCoach()
  const coachId = s.coachId
  const gen = speech.generation
  const requestId = `r${++counter}`
  const itemId = `i${counter}`
  const isAuto = !opts.question
  useCoach.setState((st) => {
    // One explanation per move and coach: a newer one replaces the older one in the thread.
    const kept = isAuto ? st.items.filter((it) => !(it.auto && it.positionKey === built.key && it.coachId === coachId)) : st.items
    const add: ThreadItem[] = []
    if (opts.question) add.push({ id: `${itemId}q`, positionKey: built.key, label: built.label, role: 'user', coachId, text: opts.question, streaming: false, auto: false, unverified: [] })
    add.push({ id: itemId, positionKey: built.key, label: built.label, role: 'coach', coachId, text: '', streaming: true, auto: isAuto, unverified: [] })
    return { items: [...kept, ...add], busy: true }
  })
  const speak = s.autoSpeak && !s.muted
  active = { requestId, itemId, splitter: new SentenceStream(), gen, speak, coachId }
  const req: ExplainRequest = { requestId, gameId: g.loaded.record.id, coachId, positionKey: built.key, context: built.input, question: opts.question, regenerate: opts.regenerate }
  try {
    const r = await api.ai.explain(req)
    if (active?.requestId !== requestId) return
    patch(itemId, { text: r.text, streaming: false, unverified: r.unverified })
    if (speak) {
      if (r.cached) for (const sentence of [...active.splitter.push(r.text + ' '), ...active.splitter.flush()]) speech.say(gen, sentence, coachId)
      else for (const sentence of active.splitter.flush()) speech.say(gen, sentence, coachId)
      speech.end(gen)
    }
  } catch (e) {
    if (active?.requestId !== requestId) return
    const msg = errorText(e)
    if (/^cancel/i.test(msg)) useCoach.setState((st) => ({ items: st.items.filter((it) => it.id !== itemId) }))
    else patch(itemId, { streaming: false, error: msg })
  } finally {
    if (active?.requestId === requestId) {
      active = null
      useCoach.setState({ busy: false })
    }
  }
}

/** Speak an explanation that is already on screen (the Replay button when no audio is cached). */
export function speakItem(item: ThreadItem): void {
  speech.speakText(item.text, item.coachId)
}

/**
 * Automatic move-by-move explanations. Whenever the selected move (or the coach) changes, the
 * previous request and its speech are cancelled at once, and after a short pause — so holding
 * an arrow key does not fire a request per move — the new move is explained.
 */
function onPositionChange(): void {
  const s = useApp.getState().settings
  const g = useGame.getState()
  if (!s || !g.loaded) return
  const key = `${g.loaded.record.id}|${positionKey(g)}|${s.coachId}|${g.review?.createdAt ?? ''}`
  const moved = key !== lastAutoKey
  if (moved) {
    lastAutoKey = key
    cancelCoach()
  }
  if (!s.autoExplain || !useCoach.getState().aiReady) return
  const built = buildContext()
  if (!built) return
  const already = useCoach.getState().items.some((it) => it.auto && it.positionKey === built.key && it.coachId === s.coachId && (it.streaming || (!!it.text && !moved)))
  if (already) return
  // Without engine data there is nothing truthful to say yet; wait for the analysis to arrive.
  if (!built.hasData) return
  const coach = useApp.getState().coaches.find((c) => c.id === s.coachId)
  const mode = coach?.explainMode ?? s.explainMode
  const cls = currentMove(g)?.review?.classification ?? null
  // In a variation there is no classification, so only "every move" and "important" speak up.
  if (!shouldAutoExplain(mode, cls) && !(g.variation && mode !== 'manual' && mode !== 'mistakes')) return
  if (autoTimer) clearTimeout(autoTimer)
  autoTimer = setTimeout(() => void explain({ auto: true }), 380)
}

let started = false
export function startCoachController(): void {
  if (started) return
  started = true
  useGame.subscribe((s, prev) => {
    if (s.loaded !== prev.loaded || s.cursor !== prev.cursor || s.variation !== prev.variation || s.review !== prev.review || s.analysisVersion !== prev.analysisVersion) onPositionChange()
  })
  useApp.subscribe((s, prev) => {
    if (s.settings?.coachId !== prev.settings?.coachId || s.settings?.autoExplain !== prev.settings?.autoExplain || s.settings?.explainMode !== prev.settings?.explainMode) onPositionChange()
    if (s.settings?.muted && !prev.settings?.muted) speech.stop()
  })
  useCoach.subscribe((s, prev) => {
    if (s.aiReady && !prev.aiReady) onPositionChange()
  })
}
