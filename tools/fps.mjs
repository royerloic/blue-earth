// Measures fps of a page after a click: node tools/fps.mjs <url>
import { chromium } from '@playwright/test'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
await p.goto(process.argv[2])
await p.waitForTimeout(5000)
await p.mouse.click(640, 400)
await p.waitForTimeout(1000)
const fps = await p.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => (++n === 180 ? r((n * 1000) / (performance.now() - t0)) : requestAnimationFrame(f)); requestAnimationFrame(f) }))
console.log('fps', fps.toFixed(1))
await b.close()
