import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * All application data lives under one root (Electron's userData in production, a temp
 * directory in tests). Nothing here imports Electron so the modules stay unit-testable.
 */
let root = ''
let resources = ''

export function setDataRoot(dir: string): void {
  root = dir
  mkdirSync(dir, { recursive: true })
}

export function setResourcesRoot(dir: string): void {
  resources = dir
}

function sub(...parts: string[]): string {
  if (!root) throw new Error('Data root has not been set')
  const dir = join(root, ...parts)
  mkdirSync(dir, { recursive: true })
  return dir
}

export const paths = {
  root: (): string => sub(),
  db: (): string => join(sub(), 'knightfall.db'),
  engines: (): string => sub('engines'),
  llmModels: (): string => sub('models', 'llm'),
  ttsModels: (): string => sub('models', 'tts'),
  runtimes: (): string => sub('runtimes'),
  coaches: (): string => sub('coaches'),
  voices: (): string => sub('voices'),
  backups: (): string => sub('backups'),
  cache: (): string => sub('cache'),
  /** Read-only files shipped with the app (built-in coach profiles, opening book). */
  resources: (): string => {
    if (!resources) throw new Error('Resources root has not been set')
    return resources
  }
}
