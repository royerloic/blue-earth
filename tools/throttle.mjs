// node tools/throttle.mjs <url> <Mbit/s>: prints load-phase logs under a throttled network.
import { chromium } from '@playwright/test'
const [url, mbit = '20'] = process.argv.slice(2)
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } })
const p = await ctx.newPage()
const cdp = await ctx.newCDPSession(p)
await cdp.send('Network.enable')
const bps = (Number(mbit) * 1e6) / 8
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: bps, uploadThroughput: bps })
const t0 = Date.now()
p.on('console', (m) => /^(first data|upgraded|ocean sim)/.test(m.text()) && console.log(`${Date.now() - t0} ms  ${m.text()}`))
await p.goto(url)
await p.waitForSelector('.be-hud', { timeout: 120000 })
console.log(`${Date.now() - t0} ms  HUD visible`)
await p.waitForTimeout(12000)
await b.close()
