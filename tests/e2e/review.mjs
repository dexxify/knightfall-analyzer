// Import (PGN, Lichess, Chess.com), run a real Stockfish review, navigate, explore a variation.
import { launch } from './launch.mjs'
const [dataDir, shotDir] = process.argv.slice(2)
const { app, page, errors } = await launch(dataDir)
const shot = (n) => shotDir && page.screenshot({ path: `${shotDir}/${n}.png` })
const log = (...a) => console.log(...a)
const PGN = `[Event "Paris"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]
[Date "1858.11.02"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`

await page.getByText('Review a game').waitFor({ timeout: 30000 })

// --- Lichess player import (real API)
await page.getByRole('button', { name: 'Import a game' }).click()
await page.getByRole('button', { name: 'Lichess player' }).click()
await page.getByPlaceholder('username').fill('DrNykterstein')
await page.getByRole('combobox').last().selectOption('5')
await page.getByRole('button', { name: 'Import', exact: true }).click()
await page.getByText(/Imported \d+ game|already in your library/).first().waitFor({ timeout: 60000 })
log('LICHESS:', await page.getByText(/Imported \d+ game|already in your library/).first().innerText())

// --- Chess.com archive import (real Published-Data API)
await page.getByRole('button', { name: 'Chess.com player' }).click()
await page.getByPlaceholder('username').fill('hikaru')
await page.getByRole('button', { name: 'Find games' }).click()
await page.getByRole('checkbox').first().waitFor({ timeout: 60000 })
await page.getByRole('checkbox').first().check()
await page.getByRole('button', { name: /Import 1 selected/ }).click()
await page.getByText('Analyze Game').waitFor()
await page.locator('.board-shell').waitFor({ timeout: 60000 })
log('CHESSCOM: opened', await page.locator('aside').first().innerText().then((t) => t.slice(0, 90).replace(/\n/g, ' | ')))

// --- A bad link gives a clear message
await page.getByRole('button', { name: 'Dashboard' }).click()
await page.getByRole('button', { name: 'Import a game' }).click()
await page.getByPlaceholder(/lichess.org/).fill('https://lichess.org/zzzzzzzz')
await page.getByRole('button', { name: 'Import', exact: true }).click()
await page.getByText(/no public game/).waitFor({ timeout: 30000 })
log('BAD LINK:', await page.getByText(/no public game/).innerText())

// --- PGN paste
await page.getByRole('button', { name: 'PGN', exact: true }).click()
await page.getByRole('textbox').last().fill(PGN)
await page.getByRole('button', { name: 'Import PGN' }).click()
await page.locator('.board-shell').waitFor({ timeout: 30000 })
await shot('a1-loaded')

// --- Review
if (await page.getByRole('button', { name: 'Start review' }).count()) {
  await page.getByRole('combobox', { name: 'Review depth' }).selectOption('quick')
  const t = Date.now()
  await page.getByRole('button', { name: 'Start review' }).click()
  await page.getByText('Key moments').waitFor({ timeout: 300000 })
  log('REVIEW took', ((Date.now() - t) / 1000).toFixed(1), 's')
}
await page.getByRole('button', { name: 'review', exact: true }).click()
log('SUMMARY:', (await page.locator('aside').first().innerText()).replace(/\n+/g, ' | ').slice(0, 700))
await shot('a2-reviewed')

// --- Navigation: click a move, check the engine panel is in sync
await page.getByRole('button', { name: 'moves', exact: true }).click()
await page.getByRole('button', { name: 'Bg4' }).first().click()
await page.waitForTimeout(1500)
log('MOVE PANEL:', (await page.locator('aside').last().innerText()).replace(/\n+/g, ' | ').slice(0, 420))
await shot('a3-move')
await page.keyboard.press('End')
await page.waitForTimeout(800)
log('END:', (await page.locator('aside').last().innerText()).replace(/\n+/g, ' | ').slice(0, 160))
await shot('a4-mate')

// --- Variation: go back, play the engine's first line instead, then return
await page.getByRole('button', { name: 'Qe7' }).first().click()
await page.waitForTimeout(2500)
await page.locator('aside').last().getByTitle(/Play this move/).first().click()
await page.getByText('Your variation').waitFor({ timeout: 10000 })
await page.waitForTimeout(2500)
log('VARIATION:', (await page.getByText('Your variation').locator('..').locator('..').innerText()).replace(/\n+/g, ' '))
await shot('a5-variation')
await page.getByRole('button', { name: /Back to the game/ }).click()
await page.waitForTimeout(300)
log('BACK: variation gone =', (await page.getByText('Your variation').count()) === 0)

// --- Library persistence
await page.getByRole('button', { name: 'Game Library' }).click()
await page.waitForTimeout(800)
log('LIBRARY:', await page.getByText(/^\d+ games?$/).innerText())
await shot('lib')
log('errors:', errors)
await app.close()
