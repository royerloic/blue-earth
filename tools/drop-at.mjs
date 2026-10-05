// Clicks at a screen offset from centre, then screenshots over time:
// node tools/drop-at.mjs <url> <out-prefix> <dx> <dy> <t1,t2,...ms>
import { chromium } from '@playwright/test'
const [url, out, dx = '0', dy = '0', times = '2000,5000'] = process.argv.slice(2)
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
p.on('console', (m) => /^drop/.test(m.text()) && console.log(m.text()))
p.on('pageerror', (e) => console.log('ERR', e.message))
await p.goto(url)
await p.waitForTimeout(6000)
await p.mouse.click(640 + Number(dx), 400 + Number(dy))
let last = 0
for (const [i, t] of times.split(',').map(Number).entries()) {
  await p.waitForTimeout(t - last)
  last = t
  await p.screenshot({ path: `${out}-${i}.png` })
}
await b.close()
