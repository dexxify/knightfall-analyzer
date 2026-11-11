import { launch } from './launch.mjs'
const shot = process.argv[2]
const { app, page, errors } = await launch()
await page.waitForTimeout(2500)
console.log('title:', await page.title())
console.log('text:', (await page.locator('body').innerText()).slice(0, 600).replace(/\n+/g, ' | '))
if (shot) await page.screenshot({ path: shot })
console.log('errors:', errors)
await app.close()
