// Usage: node tools/shot.mjs <url> <out.png> [waitMs]
// Headless Chrome with WebGPU enabled; prints console + backend info.
import { chromium } from '@playwright/test'
const [url, out, wait = '4000'] = process.argv.slice(2)
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('console', (m) => console.log(`[${m.type()}]`, m.text()))
page.on('pageerror', (e) => console.log('[pageerror]', e.stack ?? e.message))
await page.goto(url)
await page.waitForTimeout(Number(wait))
await page.screenshot({ path: out })
await browser.close()
