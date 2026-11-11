import { existsSync } from 'node:fs'
import type { ChatMessage, ProviderConfig, ProviderStatus } from '@shared/types'
import type { ChatProvider } from './providers'
import { ProviderError } from './providers'
import { listLocalGguf } from './catalog'

type Llama = Awaited<ReturnType<typeof import('node-llama-cpp').getLlama>>
type LlamaModel = Awaited<ReturnType<Llama['loadModel']>>
type LlamaContext = Awaited<ReturnType<LlamaModel['createContext']>>
type Session = import('node-llama-cpp').LlamaChatSession

/**
 * The built-in local model runtime (llama.cpp through node-llama-cpp). It runs inside the
 * application: no LM Studio, no Ollama, no server, no port. One model is kept loaded; switching
 * models unloads the previous one.
 */
class BuiltinRuntime {
  private llama: Llama | null = null
  private model: LlamaModel | null = null
  private context: LlamaContext | null = null
  private session: Session | null = null
  private loadedPath = ''
  private loadedCtx = 0
  private queue: Promise<unknown> = Promise.resolve()
  private current: AbortController | null = null
  loading: Promise<void> | null = null

  get loadedModelPath(): string {
    return this.loadedPath
  }

  get backend(): string {
    return this.llama ? String(this.llama.gpu || 'cpu') : 'not started'
  }

  private async ensure(modelPath: string, contextSize: number): Promise<void> {
    if (this.model && this.loadedPath === modelPath && this.loadedCtx === contextSize) return
    await this.release()
    const mod = await import('node-llama-cpp')
    try {
      this.llama ??= await mod.getLlama({ gpu: 'auto', build: 'never', progressLogs: false })
    } catch (e) {
      throw new ProviderError(`The built-in AI runtime could not start on this computer: ${e instanceof Error ? e.message : e}`)
    }
    try {
      this.model = await this.llama.loadModel({ modelPath })
      const size = Math.min(contextSize, this.model.trainContextSize || contextSize)
      this.context = await this.model.createContext({ contextSize: size, sequences: 1 })
      this.session = new mod.LlamaChatSession({ contextSequence: this.context.getSequence() })
      this.loadedPath = modelPath
      this.loadedCtx = contextSize
    } catch (e) {
      await this.release()
      const msg = e instanceof Error ? e.message : String(e)
      if (/memory|vram|alloc/i.test(msg)) throw new ProviderError('There is not enough free memory to load this model. Close other programs or choose a smaller model.')
      throw new ProviderError(`The model could not be loaded: ${msg}`)
    }
  }

  /** Stop any request and free the model (used when the model is removed or the app quits). */
  async unload(): Promise<void> {
    this.current?.abort()
    await this.release()
  }

  /** Free the loaded model without touching the request that asked for the switch. */
  private async release(): Promise<void> {
    try {
      this.session?.dispose()
      await this.context?.dispose()
      await this.model?.dispose()
    } catch {
      /* already disposed */
    }
    this.session = null
    this.context = null
    this.model = null
    this.loadedPath = ''
  }

  chat(modelPath: string, cfg: ProviderConfig, messages: ChatMessage[], onToken: (t: string) => void, signal: AbortSignal): Promise<string> {
    // A newer request makes the one in flight pointless; stop it so the new one starts at once.
    this.current?.abort()
    const job = async (): Promise<string> => {
      if (signal.aborted) throw new ProviderError('Cancelled')
      const abort = new AbortController()
      this.current = abort
      const onOuter = (): void => abort.abort()
      signal.addEventListener('abort', onOuter, { once: true })
      try {
        this.loading = this.ensure(modelPath, cfg.contextWindow)
        await this.loading
        this.loading = null
        const session = this.session!
        const last = messages[messages.length - 1]
        if (!last || last.role !== 'user') throw new ProviderError('The conversation must end with a user message.')
        const history = messages.slice(0, -1).map((m) =>
          m.role === 'system'
            ? ({ type: 'system', text: m.content } as const)
            : m.role === 'user'
              ? ({ type: 'user', text: m.content } as const)
              : ({ type: 'model', response: [m.content] } as const)
        )
        session.setChatHistory(history as Parameters<Session['setChatHistory']>[0])
        let full = ''
        await session.prompt(last.content, {
          signal: abort.signal,
          stopOnAbortSignal: true,
          temperature: cfg.temperature,
          maxTokens: cfg.maxTokens,
          // The coach answers in a few sentences; skip hidden reasoning so the first words arrive fast.
          budgets: { thoughtTokens: 0 },
          onTextChunk: (t: string) => {
            full += t
            onToken(t)
          }
        })
        if (abort.signal.aborted) throw new ProviderError('Cancelled')
        if (!full.trim()) throw new ProviderError('The model produced an empty answer.')
        return full.trim()
      } finally {
        this.loading = null
        signal.removeEventListener('abort', onOuter)
        if (this.current === abort) this.current = null
      }
    }
    const run = this.queue.then(job, job)
    this.queue = run.catch(() => undefined)
    return run
  }
}

export const builtinRuntime = new BuiltinRuntime()

export class BuiltinProvider implements ChatProvider {
  readonly kind = 'builtin' as const
  readonly remote = false
  constructor(private readonly cfg: ProviderConfig) {}

  private resolve(): { path: string; name: string } | null {
    const models = listLocalGguf()
    const hit = models.find((m) => m.id === this.cfg.model) ?? null
    return hit ? { path: hit.path, name: hit.name } : null
  }

  async status(): Promise<ProviderStatus> {
    const models = listLocalGguf()
    const ids = models.map((m) => m.id)
    if (models.length === 0) return { ok: false, message: 'No AI model is installed yet. Download one below.', models: ids, remote: false }
    const sel = this.resolve()
    if (!sel) return { ok: false, message: 'Choose one of the installed models.', models: ids, remote: false }
    if (!existsSync(sel.path)) return { ok: false, message: 'The selected model file is missing. Download it again.', models: ids, remote: false }
    const loaded = builtinRuntime.loadedModelPath === sel.path
    return { ok: true, message: loaded ? `${sel.name} is loaded (${builtinRuntime.backend}).` : `${sel.name} is installed and will load on first use.`, models: ids, remote: false }
  }

  chat(messages: ChatMessage[], onToken: (t: string) => void, signal: AbortSignal): Promise<string> {
    const sel = this.resolve()
    if (!sel) return Promise.reject(new ProviderError('No built-in AI model is installed. Open Settings → AI Coach and download one.'))
    return builtinRuntime.chat(sel.path, this.cfg, messages, onToken, signal)
  }
}
