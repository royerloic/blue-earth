// Loads the app in Firefox and WebKit (Playwright builds): backend detection, globe, Classic, drop.
import { firefox, webkit } from '@playwright/test'
const base = process.argv[2] ?? 'http://localhost:5173/'
for (const [name, engine] of [['firefox', firefox], ['webkit', webkit]]) {
  const b = await engine.launch({ headless: true })
  for (const q of ['?intro=0&lat=5&lon=-160&alt=9000&date=2026-07-09T23:00:00Z&clouds=0&warp=1200', '?mode=classic']) {
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
    const errs = []
    let drops = 0
    p.on('pageerror', (e) => errs.push(e.message))
    p.on('console', (m) => { if (m.text().startsWith('drop')) drops++; if (m.type() === 'error') errs.push(m.text().slice(0, 140)) })
    await p.goto(base + q)
    await p.waitForTimeout(12000)
    const info = await p.evaluate(() => ({ gpu: !!navigator.gpu, note: document.querySelector('.be-hud-note')?.textContent?.match(/(webgpu|webgl2)\s*$/)?.[1] ?? document.getElementById('hud')?.textContent?.slice(0, 80) }))
    if (!q.includes('classic')) { await p.mouse.click(640, 400); await p.waitForTimeout(3000) }
    const shot = `/tmp/br-${name}-${q.includes('classic') ? 'classic' : 'globe'}.png`
    await p.screenshot({ path: shot })
    console.log(`${name} ${q.includes('classic') ? 'classic' : 'globe '} navigator.gpu=${info.gpu} backend=${info.note} drops=${drops} errors=${[...new Set(errs)].slice(0, 2).join(' | ') || 'none'}`)
    await p.close()
  }
  await b.close()
}
