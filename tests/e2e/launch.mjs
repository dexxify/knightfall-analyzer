// Shared launcher for end-to-end scripts: starts the built app against a throwaway data folder.
import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export async function launch(dataDir) {
  const dir = dataDir ?? mkdtempSync(join(tmpdir(), 'knightfall-e2e-'))
  const app = await electron.launch({ args: [resolve('.')], env: { ...process.env, KNIGHTFALL_DATA_DIR: dir } })
  const page = await app.firstWindow()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.waitForLoadState('domcontentloaded')
  return { app, page, errors, dir }
}
