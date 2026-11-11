import type { ProviderConfig, ProviderKind, ReviewPreset, Settings } from './types'
import { DEFAULT_THRESHOLDS } from './classify'

export const DEFAULT_PRESETS: ReviewPreset[] = [
  { id: 'quick', label: 'Quick review', depth: 12, movetimeMs: 250, multipv: 2 },
  { id: 'standard', label: 'Standard review', depth: 18, movetimeMs: 1000, multipv: 3 },
  { id: 'deep', label: 'Deep review', depth: 24, movetimeMs: 4000, multipv: 3 }
]

export const PROVIDER_DEFAULTS: Record<ProviderKind, ProviderConfig> = {
  builtin: { kind: 'builtin', baseUrl: '', model: '', contextWindow: 8192, temperature: 0.7, maxTokens: 260, streaming: true, timeoutMs: 120_000 },
  lmstudio: { kind: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', model: '', contextWindow: 8192, temperature: 0.7, maxTokens: 260, streaming: true, timeoutMs: 120_000 },
  ollama: { kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: '', contextWindow: 8192, temperature: 0.7, maxTokens: 260, streaming: true, timeoutMs: 120_000 },
  openai: { kind: 'openai', baseUrl: 'http://127.0.0.1:8080/v1', model: '', apiKey: '', contextWindow: 8192, temperature: 0.7, maxTokens: 260, streaming: true, timeoutMs: 120_000 },
  anthropic: { kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: '', apiKey: '', contextWindow: 200_000, temperature: 0.7, maxTokens: 260, streaming: true, timeoutMs: 120_000 }
}

export function defaultSettings(cpuCores: number, ramGb: number): Settings {
  return {
    setupComplete: false,
    theme: 'dark',
    boardTheme: 'forest',
    pieceSet: 'cburnett',
    showCoordinates: true,
    showBestArrow: true,
    sounds: true,
    boardSize: 100,
    engine: {
      threads: Math.max(1, Math.min(16, Math.floor(cpuCores / 2))),
      hashMb: ramGb >= 16 ? 512 : ramGb >= 8 ? 256 : 128
    },
    presets: DEFAULT_PRESETS,
    defaultPreset: 'standard',
    liveMultipv: 3,
    liveDepth: 20,
    thresholds: DEFAULT_THRESHOLDS,
    provider: PROVIDER_DEFAULTS.builtin,
    providers: {},
    skillLevel: 'auto',
    language: 'English',
    coachId: 'mentor',
    explainMode: 'every',
    autoExplain: true,
    autoSpeak: true,
    muted: false,
    volume: 0.9,
    speechSpeed: 1,
    ttsEngine: 'kokoro',
    ttsQuality: 'balanced',
    coachChangesVoice: true,
    pinnedVoice: null,
    voiceOverrides: {},
    customSystemPrompt: null,
    allowNetwork: true
  }
}
