// Runs the PACKAGED application (not the dev build) to prove the installer payload is complete:
// bundled coaches, opening table, native AI runtime, speech runtime, engine and database.
import { _electron as electron } from 'playwright-core'
const [exe, dataDir, shotDir] = process.argv.slice(2)
const app = await electron.launch({ executablePath: exe, env: { ...process.env, KNIGHTFALL_DATA_DIR: dataDir } })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
const call = (ch, ...args) => page.evaluate(([c, a]) => window.bridge.invoke(c, ...a), [ch, args])
await page.getByText('Review a game').waitFor({ timeout: 60000 })
console.log('APP:', JSON.stringify((await call('app.info')).data))
console.log('COACHES:', (await call('coaches.list')).data.length)
const hw = (await call('hardware.detect', true)).data
console.log('HARDWARE:', hw.acceleration[0], hw.gpus.map((g) => `${g.name} ${g.vramGb ?? ''}`).join(', '))
console.log('ENGINE TEST:', JSON.stringify((await call('engine.test')).data))
console.log('AI STATUS:', (await call('ai.status')).data.message)
console.log('PROMPT LOADED:', (await call('ai.systemPrompt')).data.core.length > 3000)
await page.getByRole('button', { name: 'Game Library' }).click()
await page.getByRole('button', { name: /Paul Morphy/ }).first().click()
await page.locator('.board-shell').waitFor({ timeout: 30000 })
console.log('OPENING:', await page.locator('aside').first().locator('div').first().innerText().then((t) => t.split('\n')[0]))
await page.getByRole('button', { name: 'moves', exact: true }).click()
await page.locator('aside').last().getByRole('combobox', { name: 'Coach' }).selectOption('grandmaster')
await page.locator('aside').first().locator('button').filter({ has: page.getByText('Rxd7', { exact: true }) }).first().click()
const t = Date.now()
await page.waitForFunction(() => {
  const els = [...document.querySelectorAll('aside:last-of-type .whitespace-pre-wrap')]
  return els.length > 0 && els.at(-1).textContent.trim().length > 40
}, null, { timeout: 240000 })
console.log('FIRST WORDS AFTER', Date.now() - t, 'ms')
await page.locator('.speaking').first().waitFor({ timeout: 120000 })
console.log('SPEAKING AFTER', Date.now() - t, 'ms')
await page.waitForTimeout(5000)
console.log('GRANDMASTER:', (await page.locator('aside').last().locator('.whitespace-pre-wrap').allInnerTexts()).at(-1))
if (shotDir) await page.screenshot({ path: `${shotDir}/packaged.png` })
console.log('errors:', errors)
await app.close()
