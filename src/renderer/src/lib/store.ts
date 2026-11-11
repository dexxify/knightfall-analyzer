import { create } from 'zustand'
import type { DownloadProgress, EngineInfo, Settings } from '@shared/types'
import type { CoachProfile } from '@shared/coach'
import type { AppInfo } from '@shared/api'
import { api, errorText, onEvent } from './api'
import { applyThemes } from './themes'

export type View = 'dashboard' | 'analyze' | 'library' | 'coaches' | 'settings'
export type SettingsTab = 'general' | 'engine' | 'ai' | 'voice' | 'data' | 'developer'

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  text: string
}

interface AppState {
  ready: boolean
  info: AppInfo | null
  settings: Settings | null
  view: View
  settingsTab: SettingsTab
  importOpen: boolean
  coaches: CoachProfile[]
  engine: EngineInfo | null
  downloads: Record<string, DownloadProgress>
  toasts: Toast[]
  init(): Promise<void>
  setView(v: View, tab?: SettingsTab): void
  setImportOpen(open: boolean): void
  update(patch: Partial<Settings>): Promise<void>
  refreshCoaches(): Promise<void>
  refreshEngine(checkLatest?: boolean): Promise<void>
  toast(kind: Toast['kind'], text: string): void
  dismissToast(id: number): void
  clearDownload(id: string): void
}

let toastId = 0

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  info: null,
  settings: null,
  view: 'dashboard',
  settingsTab: 'general',
  importOpen: false,
  coaches: [],
  engine: null,
  downloads: {},
  toasts: [],

  async init() {
    const [info, settings, coaches, engine] = await Promise.all([api.app.info(), api.settings.get(), api.coaches.list(), api.engine.info(false)])
    applyThemes(settings.theme, settings.boardTheme, settings.pieceSet)
    onEvent('download:progress', (p) => {
      set((s) => ({ downloads: { ...s.downloads, [p.id]: p } }))
      if (p.phase === 'done' || p.phase === 'cancelled') setTimeout(() => get().clearDownload(p.id), p.phase === 'done' ? 2500 : 800)
    })
    set({ ready: true, info, settings, coaches, engine })
  },

  setView(view, tab) {
    set(tab ? { view, settingsTab: tab } : { view })
  },
  setImportOpen(importOpen) {
    set({ importOpen })
  },

  async update(patch) {
    const prev = get().settings
    if (!prev) return
    // Optimistic: the UI reacts at once; the main process is the source of truth.
    const optimistic = { ...prev, ...patch }
    set({ settings: optimistic })
    applyThemes(optimistic.theme, optimistic.boardTheme, optimistic.pieceSet)
    try {
      const saved = await api.settings.set(patch)
      set({ settings: saved })
    } catch (e) {
      set({ settings: prev })
      get().toast('error', `Could not save settings: ${errorText(e)}`)
    }
  },

  async refreshCoaches() {
    set({ coaches: await api.coaches.list() })
  },
  async refreshEngine(checkLatest = false) {
    set({ engine: await api.engine.info(checkLatest) })
  },

  toast(kind, text) {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }))
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 9000 : 4500)
  },
  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
  clearDownload(id) {
    set((s) => {
      const { [id]: _gone, ...rest } = s.downloads
      return { downloads: rest }
    })
  }
}))

export const useSettings = (): Settings => useApp((s) => s.settings)!

export function currentCoach(): CoachProfile | null {
  const s = useApp.getState()
  return s.coaches.find((c) => c.id === s.settings?.coachId) ?? s.coaches[0] ?? null
}
