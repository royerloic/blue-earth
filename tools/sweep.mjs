// Visits many configurations of a deployed site; reports page errors / console errors and saves screenshots.
import { chromium } from '@playwright/test'
const base = process.argv[2] ?? 'https://royerloic.github.io/blue-earth/'
const out = process.argv[3] ?? '/tmp/sweep'
const cases = {
  intro: '?',
  'globe-webgl2': '?intro=0&backend=webgl2',
  'tier-low': '?intro=0&tier=low',
  'tier-medium': '?intro=0&tier=medium',
  'tier-high-zoom': '?intro=0&tier=high&lat=46.2&lon=8.5&alt=150',
  classic: '?mode=classic',
  'classic-webgl2': '?mode=classic&backend=webgl2',
  'ice-age': '?intro=0&S=-120&lat=3&lon=108&alt=4500',
  'ice-free': '?intro=0&S=70&lat=50&lon=10&alt=4500',
  ...Object.fromEntries(['sumatra2004', 'tohoku2011', 'valdivia1960', 'alaska1964', 'maule2010', 'cascadia', 'asteroid'].map((p) => [`preset-${p}`, `?preset=${p}&warp=3000`])),
  'overlay-max': '?preset=tohoku2011&warp=3000&overlay=1',
  'overlay-arrival': '?preset=sumatra2004&warp=3000&overlay=2',
  kiosk: '?intro=0&kiosk=1',
  'night': '?intro=0&lat=45&lon=10&alt=8000&date=2026-07-09T21:00:00Z',
}
const ignore = /Failed to load resource.*favicon|AtmosphereParameters|VALIDATE_STATUS|Vertex shader is not compiled|too many errors|INVALID_OPERATION|uniform buffer that is too small|^\s*$|^\d+:|^>/
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
const summary = []
for (const [name, q] of Object.entries(cases)) {
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
  const issues = []
  p.on('pageerror', (e) => issues.push('PAGEERROR ' + e.message))
  p.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !ignore.test(m.text())) issues.push(m.type() + ' ' + m.text().slice(0, 160)) })
  p.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) issues.push(`HTTP ${r.status()} ${r.url()}`) })
  const t0 = Date.now()
  await p.goto(base + q)
  await p.waitForTimeout(name.startsWith('preset') || name.startsWith('overlay') ? 14000 : 9000)
  const hud = await p.evaluate(() => (document.querySelector('.be-hud')?.textContent ?? document.getElementById('hud')?.textContent ?? '').match(/Perf[^R]*?(?=Relief)/)?.[0] ?? '')
  await p.screenshot({ path: `${out}-${name}.png` })
  summary.push(`${name.padEnd(20)} ${issues.length ? '✗ ' + [...new Set(issues)].slice(0, 3).join(' | ') : '✓'}  ${hud.slice(0, 70)}`)
  await p.close()
}
console.log(summary.join('\n'))
await b.close()
