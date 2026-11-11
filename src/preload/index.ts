import { contextBridge, ipcRenderer, webUtils } from 'electron'

/**
 * The only bridge between the sandboxed UI and the main process. It exposes two generic
 * functions restricted to a fixed set of channel prefixes; the typed API is built on top of
 * them in the renderer (src/renderer/src/lib/api.ts).
 */
const NAMESPACES = ['app', 'settings', 'hardware', 'engine', 'games', 'review', 'analysis', 'coaches', 'ai', 'tts', 'downloads', 'data']
const EVENTS = ['download:progress', 'review:progress', 'analysis:update', 'ai:token']

contextBridge.exposeInMainWorld('bridge', {
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> => {
    const ns = channel.split('.')[0]
    if (!NAMESPACES.includes(ns) || !/^[a-zA-Z]+\.[a-zA-Z]+$/.test(channel)) return Promise.reject(new Error('Unknown channel'))
    return ipcRenderer.invoke(channel, ...args)
  },
  on: (channel: string, cb: (payload: unknown) => void): (() => void) => {
    if (!EVENTS.includes(channel)) return () => undefined
    const listener = (_e: unknown, payload: unknown): void => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  /** Resolve the real path of a file dropped onto the window. */
  pathForFile: (file: File): string => webUtils.getPathForFile(file)
})
