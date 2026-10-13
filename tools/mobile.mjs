import { chromium, devices } from '@playwright/test'
const base = process.argv[2] ?? 'http://localhost:5173/'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
for (const [name, dev] of [['iphone', devices['iPhone 15']], ['pixel', devices['Pixel 7']], ['small-laptop', { viewport: { width: 1024, height: 640 } }]]) {
  const ctx = await b.newContext({ ...dev })
  const p = await ctx.newPage()
  const errs = []
  let drops = 0
  p.on('pageerror', (e) => errs.push(e.message))
  p.on('console', (m) => { if (m.text().startsWith('drop')) drops++ })
  await p.goto(base + '?intro=0&lat=20&lon=-30&alt=20000&date=2026-07-09T14:00:00Z')
  await p.locator('.be-hud').waitFor({ state: 'attached', timeout: 30000 }); await p.waitForTimeout(4000)
  const vp = p.viewportSize()
  if (dev.hasTouch) await p.touchscreen.tap(vp.width / 2, vp.height / 3)
  else await p.mouse.click(vp.width / 2, vp.height / 3)
  await p.waitForTimeout(800)
  const box = await p.locator('.be-hud').boundingBox()
  const tier = (await p.locator('.be-hud').textContent()).match(/tier (\w+)/)?.[1]
  await p.screenshot({ path: `/tmp/mob-${name}.png` })
  console.log(`${name}: viewport ${vp.width}x${vp.height} tier=${tier} tapDrops=${drops} hud ${Math.round(box.width)}x${Math.round(box.height)} covers ${Math.round((100 * box.width * box.height) / (vp.width * vp.height))}% of screen, errors=${errs.length}`)
  await ctx.close()
}
await b.close()
