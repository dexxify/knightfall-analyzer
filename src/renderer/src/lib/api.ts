import { API_NAMESPACES, type Api, type ApiEvents } from '@shared/api'

interface Bridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, cb: (payload: unknown) => void): () => void
  pathForFile(file: File): string
}

declare global {
  interface Window {
    bridge: Bridge
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly help?: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Typed client for the main process: api.games.list(...) -> invoke("games.list", ...). */
export const api = Object.fromEntries(
  API_NAMESPACES.map((ns) => [
    ns,
    new Proxy(
      {},
      {
        get:
          (_t, method: string) =>
          async (...args: unknown[]) => {
            const r = (await window.bridge.invoke(`${ns}.${method}`, ...args)) as { ok: boolean; data?: unknown; error?: string; help?: string }
            if (!r.ok) throw new ApiError(r.error ?? 'Something went wrong', r.help)
            return r.data
          }
      }
    )
  ])
) as unknown as Api

export function onEvent<K extends keyof ApiEvents>(channel: K, cb: (payload: ApiEvents[K]) => void): () => void {
  return window.bridge.on(channel, cb as (p: unknown) => void)
}

export const pathForFile = (f: File): string => window.bridge.pathForFile(f)

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(n >= 10 * 1024 ** 3 ? 0 : 1)} GB`
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}
