import type { ChatMessage, ProviderConfig, ProviderStatus } from '@shared/types'

/**
 * Provider abstraction. Everything the coach needs from a language model goes through this
 * interface; the chess engine and analysis code never see a provider.
 */
export interface ChatProvider {
  readonly kind: ProviderConfig['kind']
  /** True when prompts leave this computer. */
  readonly remote: boolean
  status(): Promise<ProviderStatus>
  chat(messages: ChatMessage[], onToken: (text: string) => void, signal: AbortSignal): Promise<string>
}

export class ProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderError'
  }
}

export function isLocalUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase()
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h.endsWith('.localhost')
  } catch {
    return false
  }
}

function trimSlash(u: string): string {
  return u.replace(/\/+$/, '')
}

function explainFetchError(e: unknown, base: string, what: string): ProviderError {
  if (e instanceof ProviderError) return e
  const err = e as Error & { cause?: { code?: string } }
  if (err.name === 'TimeoutError') return new ProviderError(`${what} did not answer in time at ${base}.`)
  if (err.name === 'AbortError') return new ProviderError('Cancelled')
  const code = err.cause?.code ?? ''
  if (code === 'ECONNREFUSED') return new ProviderError(`Nothing is listening at ${base}. Is ${what} running and is its local server started?`)
  if (code === 'ENOTFOUND') return new ProviderError(`The address ${base} could not be found.`)
  return new ProviderError(`Could not connect to ${what} at ${base}: ${err.message}`)
}

async function httpError(res: Response, what: string): Promise<ProviderError> {
  let detail = ''
  try {
    const text = await res.text()
    try {
      const j = JSON.parse(text) as { error?: { message?: string } | string; message?: string }
      detail = typeof j.error === 'string' ? j.error : (j.error?.message ?? j.message ?? '')
    } catch {
      detail = text.slice(0, 200)
    }
  } catch {
    /* no body */
  }
  if (res.status === 401 || res.status === 403) return new ProviderError(`${what} rejected the API key (${res.status}).${detail ? ' ' + detail : ''}`)
  if (res.status === 404) return new ProviderError(`${what} does not know this model or endpoint (404).${detail ? ' ' + detail : ''}`)
  return new ProviderError(`${what} answered ${res.status} ${res.statusText}.${detail ? ' ' + detail : ''}`)
}

/** Read a streaming body line by line. */
async function* lines(res: Response): AsyncGenerator<string> {
  if (!res.body) throw new ProviderError('The server sent an empty response.')
  const decoder = new TextDecoder()
  let buf = ''
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '')
      buf = buf.slice(i + 1)
      if (line) yield line
    }
  }
  if (buf.trim()) yield buf.trim()
}

/** Remove reasoning blocks some local models emit, so they are never shown or spoken. */
export class ThinkFilter {
  private inThink = false
  private pending = ''

  push(text: string): string {
    this.pending += text
    let out = ''
    for (;;) {
      if (this.inThink) {
        const end = this.pending.indexOf('</think>')
        if (end < 0) {
          this.pending = this.pending.slice(-8)
          return out
        }
        this.pending = this.pending.slice(end + 8)
        this.inThink = false
      } else {
        const start = this.pending.indexOf('<think>')
        if (start < 0) {
          // Hold back a possible partial tag at the end.
          const keep = this.pending.match(/<[^>]{0,6}$/)?.[0].length ?? 0
          out += this.pending.slice(0, this.pending.length - keep)
          this.pending = this.pending.slice(this.pending.length - keep)
          return out
        }
        out += this.pending.slice(0, start)
        this.pending = this.pending.slice(start + 7)
        this.inThink = true
      }
    }
  }

  flush(): string {
    const rest = this.inThink ? '' : this.pending
    this.pending = ''
    return rest
  }
}

function withTimeout(signal: AbortSignal, ms: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(ms)])
}

// ---------- OpenAI-compatible (LM Studio, llama.cpp server, vLLM, any /v1 endpoint) ----------

export class OpenAiCompatibleProvider implements ChatProvider {
  readonly remote: boolean
  constructor(
    private readonly cfg: ProviderConfig,
    private readonly label: string
  ) {
    this.remote = !isLocalUrl(cfg.baseUrl)
  }
  get kind(): ProviderConfig['kind'] {
    return this.cfg.kind
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.cfg.apiKey) h.Authorization = `Bearer ${this.cfg.apiKey}`
    return h
  }

  async status(): Promise<ProviderStatus> {
    const base = trimSlash(this.cfg.baseUrl)
    try {
      const res = await fetch(`${base}/models`, { headers: this.headers(), signal: AbortSignal.timeout(Math.min(this.cfg.timeoutMs, 8000)) })
      if (!res.ok) throw await httpError(res, this.label)
      const data = (await res.json()) as { data?: { id: string }[] }
      const models = (data.data ?? []).map((m) => m.id).filter((id) => !/embed/i.test(id))
      if (models.length === 0) return { ok: false, message: `${this.label} is running but has no model loaded.`, models, remote: this.remote }
      return { ok: true, message: `Connected to ${this.label} — ${models.length} model${models.length === 1 ? '' : 's'} available.`, models, remote: this.remote }
    } catch (e) {
      return { ok: false, message: explainFetchError(e, base, this.label).message, models: [], remote: this.remote }
    }
  }

  async chat(messages: ChatMessage[], onToken: (t: string) => void, signal: AbortSignal): Promise<string> {
    const base = trimSlash(this.cfg.baseUrl)
    if (!this.cfg.model) throw new ProviderError(`No model is selected for ${this.label}.`)
    let res: Response
    try {
      res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        signal: withTimeout(signal, this.cfg.timeoutMs),
        body: JSON.stringify({
          model: this.cfg.model,
          messages,
          temperature: this.cfg.temperature,
          max_tokens: this.cfg.maxTokens,
          stream: this.cfg.streaming
        })
      })
    } catch (e) {
      throw explainFetchError(e, base, this.label)
    }
    if (!res.ok) throw await httpError(res, this.label)
    const filter = new ThinkFilter()
    let full = ''
    const emit = (t: string): void => {
      const clean = filter.push(t)
      if (clean) {
        full += clean
        onToken(clean)
      }
    }
    if (!this.cfg.streaming) {
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
      const text = data.choices?.[0]?.message?.content
      if (typeof text !== 'string') throw new ProviderError(`${this.label} returned a response without any text.`)
      emit(text)
    } else {
      for await (const line of lines(res)) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') break
        try {
          const j = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[]; error?: { message?: string } }
          if (j.error) throw new ProviderError(`${this.label}: ${j.error.message ?? 'stream error'}`)
          const t = j.choices?.[0]?.delta?.content
          if (t) emit(t)
        } catch (e) {
          if (e instanceof ProviderError) throw e
          // A malformed chunk is skipped rather than aborting an otherwise good answer.
        }
      }
    }
    const tail = filter.flush()
    if (tail) {
      full += tail
      onToken(tail)
    }
    if (!full.trim()) throw new ProviderError(`${this.label} returned an empty answer.`)
    return full.trim()
  }
}

// ---------- Ollama (native API) ----------

export class OllamaProvider implements ChatProvider {
  readonly kind = 'ollama' as const
  readonly remote: boolean
  constructor(private readonly cfg: ProviderConfig) {
    this.remote = !isLocalUrl(cfg.baseUrl)
  }

  async status(): Promise<ProviderStatus> {
    const base = trimSlash(this.cfg.baseUrl)
    try {
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(Math.min(this.cfg.timeoutMs, 8000)) })
      if (!res.ok) throw await httpError(res, 'Ollama')
      const data = (await res.json()) as { models?: { name: string }[] }
      const models = (data.models ?? []).map((m) => m.name)
      if (models.length === 0) return { ok: false, message: 'Ollama is running but has no models installed.', models, remote: this.remote }
      if (this.cfg.model && !models.includes(this.cfg.model)) {
        return { ok: false, message: `Ollama is running, but the model "${this.cfg.model}" is not installed in it.`, models, remote: this.remote }
      }
      return { ok: true, message: `Connected to Ollama — ${models.length} model${models.length === 1 ? '' : 's'} installed.`, models, remote: this.remote }
    } catch (e) {
      return { ok: false, message: explainFetchError(e, base, 'Ollama').message, models: [], remote: this.remote }
    }
  }

  async chat(messages: ChatMessage[], onToken: (t: string) => void, signal: AbortSignal): Promise<string> {
    const base = trimSlash(this.cfg.baseUrl)
    if (!this.cfg.model) throw new ProviderError('No Ollama model is selected.')
    let res: Response
    try {
      res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: withTimeout(signal, this.cfg.timeoutMs),
        body: JSON.stringify({
          model: this.cfg.model,
          messages,
          stream: this.cfg.streaming,
          think: false,
          options: { temperature: this.cfg.temperature, num_predict: this.cfg.maxTokens, num_ctx: this.cfg.contextWindow }
        })
      })
    } catch (e) {
      throw explainFetchError(e, base, 'Ollama')
    }
    if (!res.ok) throw await httpError(res, 'Ollama')
    const filter = new ThinkFilter()
    let full = ''
    const emit = (t: string): void => {
      const clean = filter.push(t)
      if (clean) {
        full += clean
        onToken(clean)
      }
    }
    if (!this.cfg.streaming) {
      const j = (await res.json()) as { message?: { content?: string }; error?: string }
      if (j.error) throw new ProviderError(`Ollama: ${j.error}`)
      emit(j.message?.content ?? '')
    } else {
      for await (const line of lines(res)) {
        let j: { message?: { content?: string }; error?: string; done?: boolean }
        try {
          j = JSON.parse(line)
        } catch {
          continue
        }
        if (j.error) throw new ProviderError(`Ollama: ${j.error}`)
        if (j.message?.content) emit(j.message.content)
        if (j.done) break
      }
    }
    const tail = filter.flush()
    if (tail) {
      full += tail
      onToken(tail)
    }
    if (!full.trim()) throw new ProviderError('Ollama returned an empty answer.')
    return full.trim()
  }
}

// ---------- Anthropic-compatible (Messages API shape) ----------

export class AnthropicCompatibleProvider implements ChatProvider {
  readonly kind = 'anthropic' as const
  readonly remote: boolean
  constructor(private readonly cfg: ProviderConfig) {
    this.remote = !isLocalUrl(cfg.baseUrl)
  }

  private headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', ...(this.cfg.apiKey ? { 'x-api-key': this.cfg.apiKey } : {}) }
  }

  async status(): Promise<ProviderStatus> {
    const base = trimSlash(this.cfg.baseUrl)
    try {
      const res = await fetch(`${base}/v1/models`, { headers: this.headers(), signal: AbortSignal.timeout(Math.min(this.cfg.timeoutMs, 8000)) })
      if (!res.ok) throw await httpError(res, 'The Anthropic-compatible endpoint')
      const data = (await res.json()) as { data?: { id: string }[] }
      const models = (data.data ?? []).map((m) => m.id)
      return { ok: true, message: `Connected — ${models.length} model${models.length === 1 ? '' : 's'} listed.`, models, remote: this.remote }
    } catch (e) {
      return { ok: false, message: explainFetchError(e, base, 'the Anthropic-compatible endpoint').message, models: [], remote: this.remote }
    }
  }

  async chat(messages: ChatMessage[], onToken: (t: string) => void, signal: AbortSignal): Promise<string> {
    const base = trimSlash(this.cfg.baseUrl)
    if (!this.cfg.model) throw new ProviderError('No model is selected for the Anthropic-compatible provider.')
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')
    const turns = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }))
    let res: Response
    try {
      res = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: this.headers(),
        signal: withTimeout(signal, this.cfg.timeoutMs),
        body: JSON.stringify({ model: this.cfg.model, system, messages: turns, max_tokens: this.cfg.maxTokens, stream: this.cfg.streaming })
      })
    } catch (e) {
      throw explainFetchError(e, base, 'the Anthropic-compatible endpoint')
    }
    if (!res.ok) throw await httpError(res, 'The Anthropic-compatible endpoint')
    let full = ''
    if (!this.cfg.streaming) {
      const j = (await res.json()) as { content?: { type: string; text?: string }[] }
      full = (j.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
      if (full) onToken(full)
    } else {
      for await (const line of lines(res)) {
        if (!line.startsWith('data:')) continue
        try {
          const j = JSON.parse(line.slice(5).trim()) as { type?: string; delta?: { type?: string; text?: string }; error?: { message?: string } }
          if (j.type === 'error') throw new ProviderError(`Provider error: ${j.error?.message ?? 'unknown'}`)
          if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta' && j.delta.text) {
            full += j.delta.text
            onToken(j.delta.text)
          }
        } catch (e) {
          if (e instanceof ProviderError) throw e
        }
      }
    }
    if (!full.trim()) throw new ProviderError('The provider returned an empty answer.')
    return full.trim()
  }
}

/** Probe the default local ports so the settings screen can offer what is actually running. */
export async function discoverLocalServers(): Promise<{ lmstudio: boolean; ollama: boolean }> {
  const probe = async (url: string): Promise<boolean> => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1200) })
      return r.ok
    } catch {
      return false
    }
  }
  const [lmstudio, ollama] = await Promise.all([probe('http://127.0.0.1:1234/v1/models'), probe('http://127.0.0.1:11434/api/tags')])
  return { lmstudio, ollama }
}
