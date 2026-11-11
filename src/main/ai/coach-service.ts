import type { ChatMessage, ProviderConfig, ProviderStatus, Settings } from '@shared/types'
import type { ExplainRequest, ExplainResult } from '@shared/api'
import { composeSystemPrompt, type CoachProfile } from '@shared/coach'
import { AUTO_EXPLAIN_REQUEST, buildCoachContext, renderContextMessage, unverifiedMoves } from '@shared/context'
import { AnthropicCompatibleProvider, OllamaProvider, OpenAiCompatibleProvider, ProviderError, type ChatProvider } from './providers'
import { BuiltinProvider } from './builtin'

export function makeProvider(cfg: ProviderConfig): ChatProvider {
  switch (cfg.kind) {
    case 'builtin':
      return new BuiltinProvider(cfg)
    case 'lmstudio':
      return new OpenAiCompatibleProvider(cfg, 'LM Studio')
    case 'openai':
      return new OpenAiCompatibleProvider(cfg, 'the OpenAI-compatible server')
    case 'ollama':
      return new OllamaProvider(cfg)
    case 'anthropic':
      return new AnthropicCompatibleProvider(cfg)
  }
}

export interface CoachStore {
  getExplanation(gameId: number, coachId: string, positionKey: string, model: string): string | null
  saveExplanation(gameId: number, coachId: string, positionKey: string, model: string, text: string): void
  addMessage(gameId: number, coachId: string, positionKey: string, msg: ChatMessage): void
  recentMessages(gameId: number, limit: number): ChatMessage[]
}

export interface CoachDeps {
  settings(): Settings
  corePrompt(): string
  coach(id: string): CoachProfile | null
  store: CoachStore
  /** Injected so tests can supply a fake model. */
  provider?: (cfg: ProviderConfig) => ChatProvider
}

/**
 * Turns "explain this move" into a model request and back. Chess facts flow one way only:
 * rules engine + Stockfish -> structured context -> model. Nothing the model says is ever
 * written back into the analysis.
 */
export class CoachService {
  private active = new Map<string, AbortController>()

  constructor(private readonly deps: CoachDeps) {}

  private provider(cfg: ProviderConfig): ChatProvider {
    return (this.deps.provider ?? makeProvider)(cfg)
  }

  status(cfg?: ProviderConfig): Promise<ProviderStatus> {
    return this.provider(cfg ?? this.deps.settings().provider).status()
  }

  systemPromptFor(coach: CoachProfile): string {
    const s = this.deps.settings()
    return composeSystemPrompt(s.customSystemPrompt?.trim() ? s.customSystemPrompt : this.deps.corePrompt(), coach, s.skillLevel, s.language)
  }

  cancel(requestId: string): void {
    this.active.get(requestId)?.abort()
  }

  cancelAll(): void {
    for (const a of this.active.values()) a.abort()
  }

  async explain(req: ExplainRequest, onToken: (text: string) => void): Promise<ExplainResult> {
    const s = this.deps.settings()
    const coach = this.deps.coach(req.coachId)
    if (!coach) throw new ProviderError('The selected coach no longer exists. Choose another coach.')
    const cfg = s.provider
    const modelKey = `${cfg.kind}:${cfg.model}`
    const isAuto = !req.question

    if (isAuto && !req.regenerate && req.gameId !== null) {
      const hit = this.deps.store.getExplanation(req.gameId, coach.id, req.positionKey, modelKey)
      if (hit) return { text: hit, cached: true, unverified: [], model: modelKey }
    }

    const ctx = buildCoachContext({ ...req.context, language: coach.language || s.language, skillLevel: s.skillLevel })
    const system = this.systemPromptFor(coach)
    const request = req.question?.trim() ? `The player asks: ${req.question.trim()}` : AUTO_EXPLAIN_REQUEST
    const userMessage = renderContextMessage(ctx, request)

    // Earlier turns give continuity; they are trimmed to fit the model's context window.
    const budget = Math.max(2000, cfg.contextWindow * 3 - system.length - userMessage.length - cfg.maxTokens * 4)
    const history: ChatMessage[] = []
    if (req.gameId !== null) {
      let used = 0
      for (const m of this.deps.store.recentMessages(req.gameId, 12).reverse()) {
        used += m.content.length
        if (used > budget) break
        history.unshift(m)
      }
      while (history.length && history[0].role !== 'user') history.shift()
    }
    const messages: ChatMessage[] = [{ role: 'system', content: system }, ...history, { role: 'user', content: userMessage }]

    const abort = new AbortController()
    this.active.set(req.requestId, abort)
    try {
      const text = await this.provider(cfg).chat(messages, onToken, abort.signal)
      if (abort.signal.aborted) throw new ProviderError('Cancelled')
      if (req.gameId !== null) {
        // Stored history keeps the question, not the bulky context block.
        this.deps.store.addMessage(req.gameId, coach.id, req.positionKey, {
          role: 'user',
          content: req.question?.trim() ? req.question.trim() : `(Explain ${ctx.move.label})`
        })
        this.deps.store.addMessage(req.gameId, coach.id, req.positionKey, { role: 'assistant', content: text })
        if (isAuto) this.deps.store.saveExplanation(req.gameId, coach.id, req.positionKey, modelKey, text)
      }
      return { text, cached: false, unverified: ctx.dataQuality === 'full' ? unverifiedMoves(text, ctx) : [], model: modelKey }
    } catch (e) {
      if (abort.signal.aborted) throw new ProviderError('Cancelled')
      throw e
    } finally {
      this.active.delete(req.requestId)
    }
  }
}
