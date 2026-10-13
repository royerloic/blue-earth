import { chromium } from '@playwright/test'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
for (const backend of ['webgpu', 'webgl2']) {
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
  let tileReqs = 0
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  // Tiles fail (simulated outage): count how often they are requested.
  await p.route('**/tiles/07/**', (r) => { tileReqs++; return r.abort() })
  await p.goto(`http://localhost:5173/?intro=0&tier=high&progressive=0&lat=46.2&lon=8.5&alt=150&backend=${backend}`)
  await p.locator('.be-hud').waitFor({ state: 'attached', timeout: 60000 })
  await p.waitForTimeout(10000)
  console.log(`${backend}: tile requests in 10 s while failing: ${tileReqs}, page errors: ${errs.length}`)
  await p.unroute('**/tiles/07/**')
  await p.waitForTimeout(15000)
  const t = (await p.locator('.be-hud').textContent()).match(/500 m tiles (\d+)/)?.[1]
  console.log(`${backend}: after recovery, tiles loaded: ${t}`)
  await p.screenshot({ path: `/tmp/off-${backend}.png` })
  await p.close()
}
await b.close()
