// Drives the first-run wizard for real: detects hardware, installs Stockfish and the voice engine.
import { launch } from './launch.mjs'
const [dataDir, shotDir] = process.argv.slice(2)
const { app, page, errors } = await launch(dataDir)
const shot = (n) => shotDir && page.screenshot({ path: `${shotDir}/${n}.png` })
const log = (...a) => console.log(...a)

await page.getByText('AI acceleration').waitFor({ timeout: 60000 })
log('HARDWARE:', (await page.locator('.selectable').first().innerText()).replace(/\n/g, ' | '))
await shot('w1-welcome')

await page.getByRole('button', { name: 'Continue' }).click()
if (await page.getByRole('button', { name: 'Install Stockfish' }).count()) {
  await page.getByRole('button', { name: 'Install Stockfish' }).click()
  await page.waitForTimeout(1500)
  await shot('w2-installing')
}
await page.getByRole('button', { name: 'Test Stockfish' }).waitFor({ timeout: 600000 })
await page.getByRole('button', { name: 'Test Stockfish' }).click()
await page.getByText(/Working\./).waitFor({ timeout: 60000 })
log('ENGINE TEST:', await page.getByText(/Working\./).innerText())
await shot('w2-engine')

await page.getByRole('button', { name: 'Continue' }).click()
await page.getByText(/Recommended:/).first().waitFor({ timeout: 30000 })
log('LLM REC:', await page.getByText(/Recommended:/).first().innerText())
await shot('w3-ai')

await page.getByRole('button', { name: 'Continue' }).click()
await page.getByText('Voice quality').waitFor()
log('TTS REC:', await page.locator('text=/quality\./').first().innerText().catch(() => 'n/a'))
const dl = page.getByRole('button', { name: /^Download \d+ MB/ })
if (await dl.count()) {
  await dl.first().click()
  await page.getByRole('button', { name: 'Measure speed' }).waitFor({ timeout: 600000 })
}
await page.getByRole('button', { name: 'Measure speed' }).click()
await page.getByText(/Measured here/).waitFor({ timeout: 120000 })
log('TTS:', await page.getByText(/Measured here/).innerText())
await shot('w4-voice')

await page.getByRole('button', { name: 'Continue' }).click()
await page.getByRole('button', { name: 'Hear The Grandmaster' }).click()
await page.waitForTimeout(6000)
await shot('w5-coach')
await page.getByRole('button', { name: 'Continue' }).click()
await page.getByText('Storage').waitFor({ timeout: 60000 })
log('READY:', (await page.locator('.space-y-2').first().innerText()).replace(/\n/g, ' | '))
await shot('w6-ready')
await page.getByRole('button', { name: /Start using/ }).click()
await page.getByText('Review a game').waitFor()
await shot('dashboard')
log('errors:', errors)
await app.close()
