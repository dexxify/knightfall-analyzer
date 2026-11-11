// Launches the PACKAGED app with an empty data folder and checks the bundled payload loads.
import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const exe = process.argv[2]
const app = await electron.launch({ executablePath: exe, env: { ...process.env, KNIGHTFALL_DATA_DIR: mkdtempSync(join(tmpdir(), 'knightfall-pkg-')) } })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
const call = (ch, ...args) => page.evaluate(([c, a]) => window.bridge.invoke(c, ...a), [ch, args])
await page.getByText('AI acceleration').waitFor({ timeout: 90000 })
const info = (await call('app.info')).data
console.log('APP:', info.name, info.version, 'packaged =', info.packaged)
console.log('COACHES:', (await call('coaches.list')).data.length)
const hw = (await call('hardware.detect')).data
console.log('AI RUNTIME:', hw.acceleration[0], '|', hw.gpus.map((g) => `${g.name} ${g.vramGb ?? ''}`).join(', '))
console.log('CORE PROMPT LOADED:', (await call('ai.systemPrompt')).data.core.length > 3000)
console.log('VOICES:', (await call('tts.voices', 'kokoro')).data.length)
const imp = (await call('games.importPgn', '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 *')).data
const g = (await call('games.get', imp.imported[0].id)).data
console.log('DB + OPENING TABLE:', g.opening?.name)
console.log('errors:', errors)
await app.close()
