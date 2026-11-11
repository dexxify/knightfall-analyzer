// The voiced-coach acceptance flow: auto explanation, speech, cancel on navigation, coach switch,
// follow-up question, pause / replay / mute, and persistence across a restart.
import { launch } from './launch.mjs'
const [dataDir, shotDir] = process.argv.slice(2)
let { app, page, errors } = await launch(dataDir)
const shot = (n) => shotDir && page.screenshot({ path: `${shotDir}/${n}.png` })
const log = (...a) => console.log(...a)
const right = () => page.locator('aside').last()
const coachTexts = () => right().locator('.whitespace-pre-wrap').allInnerTexts()
const speaking = () => page.locator('.speaking').count()
const move = (san) => page.locator('aside').first().locator('button').filter({ has: page.getByText(san, { exact: true }) }).first()

async function openMorphy() {
  await page.getByRole('button', { name: 'Game Library' }).click()
  await page.getByRole('button', { name: /Paul Morphy/ }).first().click()
  await page.locator('.board-shell').waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: 'moves', exact: true }).click()
}
async function waitAnswer(prevCount, timeout = 240000) {
  const t = Date.now()
  await page.waitForFunction(
    (n) => {
      const els = [...document.querySelectorAll('aside:last-of-type .whitespace-pre-wrap')]
      return els.length > n && els[els.length - 1].textContent.trim().length > 20 && !document.querySelector('aside:last-of-type .typing')
    },
    prevCount,
    { timeout }
  )
  // wait until the text stops growing (stream finished)
  let last = ''
  for (;;) {
    const cur = (await coachTexts()).at(-1)
    if (cur === last) break
    last = cur
    await page.waitForTimeout(1200)
  }
  return { text: last, ms: Date.now() - t }
}

await page.getByText('Review a game').waitFor({ timeout: 30000 })
await openMorphy()
await right().getByRole('combobox', { name: 'Coach' }).selectOption('mentor')

// 1. select a blunder-ish move -> automatic explanation + speech
await move('b5').click()
let a = await waitAnswer(0)
log(`MENTOR on 9...b5 (${a.ms} ms):`, a.text)
await page.waitForTimeout(2500)
log('speaking after explanation:', (await speaking()) > 0)
await shot('c1-mentor')

// 2. navigate while speaking -> old speech stops, new move explained
const before = (await coachTexts()).length
await move('Qb8+').click()
await page.waitForTimeout(250)
log('speech stopped right after navigating:', (await speaking()) === 0)
a = await waitAnswer(before)
log(`MENTOR on 16.Qb8+ (${a.ms} ms):`, a.text)

// 3. switch coach mid-review -> new personality explains the same move, new voice
const n3 = (await coachTexts()).length
await right().getByRole('combobox', { name: 'Coach' }).selectOption('toxic-best-friend')
a = await waitAnswer(n3)
log(`TOXIC BEST FRIEND on 16.Qb8+ (${a.ms} ms):`, a.text)
log('toxic voice:', await page.evaluate(() => window.bridge.invoke('tts.coachVoice', 'toxic-best-friend').then((r) => r.data)), '| mentor voice:', await page.evaluate(() => window.bridge.invoke('tts.coachVoice', 'mentor').then((r) => r.data)))
await shot('c2-toxic')

// 4. follow-up question
const n4 = (await coachTexts()).length
await page.getByPlaceholder(/Ask about/).fill('Why could Black not just ignore the queen?')
await page.getByRole('button', { name: 'Ask', exact: true }).click()
a = await waitAnswer(n4)
log(`FOLLOW-UP (${a.ms} ms):`, a.text)
log('warnings shown:', await right().getByText(/not in the engine analysis/).count())

// 5. player controls
await page.waitForTimeout(1500)
if (await speaking()) {
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.waitForTimeout(400)
  log('paused:', (await page.locator('.speaking.paused').count()) > 0)
  await page.getByRole('button', { name: 'Resume' }).click()
}
await page.getByRole('button', { name: 'Stop' }).click().catch(() => {})
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'Replay' }).click()
await page.waitForTimeout(1500)
log('replay speaks:', (await speaking()) > 0)
await page.getByRole('button', { name: 'Mute' }).click()
await page.waitForTimeout(500)
log('muted -> silent:', (await speaking()) === 0)
await page.getByRole('button', { name: 'Unmute' }).click()

// 6. written explanations only
await right().getByLabel('Speak').uncheck()
const n6 = (await coachTexts()).length
await move('Rd8#').click()
a = await waitAnswer(n6)
await page.waitForTimeout(1500)
log('auto-speech off -> text only:', a.text.length > 20 && (await speaking()) === 0)
await right().getByLabel('Speak').check()

// 7. variation awareness
await move('Qe7').click()
await page.waitForTimeout(3000)
const n7 = (await coachTexts()).length
await right().getByTitle(/Play this move/).first().click()
a = await waitAnswer(n7)
log(`VARIATION (${a.ms} ms):`, a.text)
await shot('c3-variation')
log('errors:', errors)
await app.close()

// 8. restart: coach, model, engine and conversation are still there
;({ app, page, errors } = await launch(dataDir))
await page.getByText('Review a game').waitFor({ timeout: 30000 })
await openMorphy()
log('RESTART: coach =', await right().getByRole('combobox', { name: 'Coach' }).inputValue(), '| saved messages =', (await coachTexts()).length, '| review kept =', (await page.getByText('Reviewed with').count()) > 0)
await app.close()
