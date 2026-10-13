import { chromium } from '@playwright/test'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--enable-precise-memory-info'] })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
await p.goto((process.argv[2] ?? 'https://royerloic.github.io/blue-earth/') + '?intro=0&kiosk=1&warp=3000&tier=high&lat=40&lon=10&alt=3000')
await p.locator('.be-hud').waitFor({ state: 'attached', timeout: 30000 })
const cdp = await p.context().newCDPSession(p)
const samples = []
for (let i = 0; i <= 6; i++) {
  await cdp.send('HeapProfiler.collectGarbage')
  const m = await p.evaluate(() => ({ heap: performance.memory.usedJSHeapSize / 1e6, dom: document.getElementsByTagName('*').length }))
  samples.push(`t=${i * 30}s heap=${m.heap.toFixed(1)}MB dom=${m.dom}`)
  if (i < 6) await p.waitForTimeout(30000)
}
console.log(samples.join('\n'))
console.log((await p.locator('.be-hud').textContent()).match(/Perf.*?(?=Relief)/)?.[0])
await b.close()
