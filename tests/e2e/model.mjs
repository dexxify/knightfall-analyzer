// Installs a built-in AI model through the Settings screen. Large downloads may need several runs:
// the script closes the app cleanly after its time budget and the next run resumes the download.
import { launch } from './launch.mjs'
const [dataDir, shotDir, model = 'Qwen3.5 9B', budgetMin = '9'] = process.argv.slice(2)
const { app, page, errors } = await launch(dataDir)
const timer = setTimeout(async () => {
  console.log('TIME BUDGET REACHED: closing the app; run again to resume the download')
  await app.close()
  process.exit(2)
}, Number(budgetMin) * 60000)
await page.getByRole('button', { name: 'Settings' }).click()
await page.getByRole('button', { name: 'AI Coach' }).last().click()
await page.getByText(/Recommended:/).first().waitFor({ timeout: 30000 })
const card = page.locator('div.rounded-lg', { hasText: model }).last()
const btn = card.getByRole('button', { name: /Download|Repair/ })
if (await btn.count()) {
  await btn.click()
  await page.waitForTimeout(4000)
  if (shotDir) await page.screenshot({ path: `${shotDir}/m1-downloading.png` })
}
await card.getByText('Installed', { exact: true }).waitFor({ timeout: 3600000 })
clearTimeout(timer)
if (await card.getByRole('button', { name: 'Use this model' }).count()) await card.getByRole('button', { name: 'Use this model' }).click()
await page.getByText(/is installed and will load|is loaded/).waitFor({ timeout: 30000 })
console.log('STATUS:', await page.getByText(/is installed and will load|is loaded/).innerText())
if (shotDir) await page.screenshot({ path: `${shotDir}/m2-installed.png` })
console.log('errors:', errors)
await app.close()
