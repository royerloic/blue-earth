// Drives the real Safari (not Playwright's WebKit) through safaridriver: load, scripted drop, logs + screenshots.
//   One-time: Safari Settings → Advanced "Show features for web developers", Developer → "Allow remote
//   automation", and `sudo safaridriver --enable`. Then: safaridriver -p 4444 &  node tools/safari.mjs [url]
// WebDriver pointer actions never reach the page in Safari (not even on example.com), so the drop is a
// synthetic PointerEvent; console output is only captured after navigation (early logs are lost).
import { writeFileSync } from 'node:fs'
const url = process.argv[2] || 'https://royerloic.github.io/blue-earth/?intro=0&lat=5&lon=-160&alt=9000&date=2026-07-09T23:00:00Z&clouds=0'
const out = process.argv[3] || '/tmp/safari'
const W = 'http://localhost:4444'
const j = async (m, p, b) => (await (await fetch(W + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b && JSON.stringify(b) })).json()).value
const sleep = (t) => new Promise((r) => setTimeout(r, t))
const S = '/session/' + (await j('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } })).sessionId
const ex = (script) => j('POST', S + '/execute/sync', { script, args: [] })
const shot = async (n) => writeFileSync(`${out}-${n}.png`, Buffer.from(await j('GET', S + '/screenshot'), 'base64'))
try {
  await j('POST', S + '/window/rect', { width: 1400, height: 900 })
  await j('POST', S + '/url', { url })
  await ex(`window.__log=[];addEventListener('error',e=>__log.push('X '+e.message));addEventListener('unhandledrejection',e=>__log.push('X '+e.reason));
    for(const k of ['log','warn','error']){const f=console[k];console[k]=(...a)=>{__log.push(k[0].toUpperCase()+' '+a.join(' ').slice(0,300));f(...a)}}`)
  await sleep(15000)
  console.log(await ex(`return 'navigator.gpu=' + !!navigator.gpu + ' visibility=' + document.visibilityState`))
  await shot('start')
  await ex(`const c=document.querySelector('canvas'),b=c.getBoundingClientRect(),o={bubbles:true,clientX:b.width/2,clientY:b.height/2,button:0,buttons:1,pointerId:1,pointerType:'mouse',isPrimary:true};
    c.dispatchEvent(new PointerEvent('pointerdown',o));setTimeout(()=>c.dispatchEvent(new PointerEvent('pointerup',{...o,buttons:0})),60)`)
  await sleep(10000)
  await shot('drop')
  console.log((await ex('return __log')).join('\n'))
  console.log(`screenshots: ${out}-start.png ${out}-drop.png`)
} finally {
  await j('DELETE', S)
}
