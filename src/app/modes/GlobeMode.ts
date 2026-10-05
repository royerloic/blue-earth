import * as THREE from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { loadGlobeData } from '../../core/assets/globeData'
import { fromLatLon, pickGlobe, sunForGlintAt, toLatLon } from '../../core/geo/picking'
import { EARTH_RADIUS } from '../../core/geo/units'
import type { RendererInfo } from '../../core/renderer'
import { celestialAt, monthWeights } from '../../core/time/solar'
import { Atmosphere } from '../../render/atmosphere/atmosphere'
import { createCubeSphere } from '../../render/globe/cubeSphere'
import { createGlobeMaterial, GlobeUniforms } from '../../render/globe/globeMaterial'
import { Hud } from '../../ui/hud'
import { OceanSim } from '../../sim/OceanSim'
import { PRESETS } from '../../sim/presets/historical'
import { GaugePanel, toast } from '../../ui/gauges'

type Scheme = 'explorer' | 'classic'

/**
 * The main 3D globe (M3): real-data Earth with atmosphere, day/night, clouds and sea level.
 * Explorer controls: drag = orbit, wheel = zoom, Shift+move = sun (glint under the cursor).
 * Classic controls (K): pointer = sun like 2004, right-drag = orbit.
 */
export async function startGlobeMode({ renderer, backend }: RendererInfo) {
  const q = new URLSearchParams(location.search)
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(innerWidth, innerHeight)
  document.body.appendChild(renderer.domElement)

  const tier = q.get('tier') ?? (matchMedia('(pointer: coarse)').matches ? 'low' : 'medium')
  const data = await loadGlobeData(renderer, tier)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 1e4, 1e9)
  camera.up.set(0, 0, 1)
  const alt0 = Number(q.get('alt') ?? 30_000) * 1000
  fromLatLon(Number(q.get('lat') ?? 25), Number(q.get('lon') ?? 15), EARTH_RADIUS + alt0, camera.position)
  camera.lookAt(0, 0, 0)

  const uniforms = new GlobeUniforms()
  uniforms.seaLevel.value = Number(q.get('S') ?? 0)
  const t0 = performance.now()
  const sim = new OceanSim(renderer, backend, data, uniforms.seaLevel.value)
  console.log(`ocean sim: ${sim.grid.cells} cells, dt ${sim.dt.toFixed(1)} s, setup ${(performance.now() - t0).toFixed(0)} ms`)
  const atmosphere = new Atmosphere(renderer, scene, camera)
  if (q.has('exposure')) atmosphere.exposure.value = Number(q.get('exposure'))
  if (q.has('night')) uniforms.nightIntensity.value = Number(q.get('night'))
  if (q.has('rough')) uniforms.waterRoughness.value = Number(q.get('rough'))
  if (q.has('wind')) uniforms.setWind(Number(q.get('wind')))
  if (q.has('raymarch')) atmosphere.context.raymarchScattering = q.get('raymarch') !== '0'
  const globe = new THREE.Mesh(createCubeSphere(256), createGlobeMaterial(data, uniforms, atmosphere.context.sunDirectionECEF, { texture: sim.displayTexture, diagTexture: sim.diagTexture, n: sim.N }, q.get('debug')))
  globe.frustumCulled = false
  scene.add(globe)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.enablePan = false
  controls.minDistance = EARTH_RADIUS + 400_000
  controls.maxDistance = EARTH_RADIUS * 12

  // --- Sun & time ---------------------------------------------------------------------
  const celestial = { sun: new THREE.Vector3(), moon: new THREE.Vector3(), eciToEcef: new THREE.Matrix4() }
  let date = q.get('date') ? new Date(q.get('date')!) : new Date()
  let timeLapse = 0 // simulated hours per real second
  let sunMode: 'real' | 'manual' = 'real'
  const manualSun = new THREE.Vector3(1, 0, 0)
  const manualTarget = new THREE.Vector3(1, 0, 0)

  // --- Controls ------------------------------------------------------------------------
  let scheme: Scheme = q.get('controls') === 'classic' ? 'classic' : 'explorer'
  const applyScheme = () => {
    controls.mouseButtons =
      scheme === 'classic'
        ? { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
        : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
    schemeText.textContent = scheme === 'classic' ? 'Classic — pointer = sun, right-drag = orbit' : 'Explorer — drag = orbit, Shift+move = sun'
  }
  const el = renderer.domElement
  el.addEventListener('contextmenu', (e) => e.preventDefault())
  const hit = new THREE.Vector3()
  el.addEventListener('pointermove', (e) => {
    const p = pickGlobe(camera, el, e.clientX, e.clientY, hit)
    if (p) {
      const { lat, lon } = toLatLon(p)
      posText.textContent = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`
    }
    if (p) lastHit = p.clone()
    if (p && (scheme === 'classic' ? e.buttons === 0 : e.shiftKey)) {
      sunForGlintAt(p, camera.position, manualTarget)
      if (sunMode === 'real') manualSun.copy(celestial.sun)
      sunMode = 'manual'
      sunText.textContent = 'manual (R = real sun)'
    }
  })
  // Click (no drag) drops a wave where the pointer hits the globe.
  // Holding still (> 0.5 s) instead makes an oscillating source, like the 2004 original.
  let down: { x: number; y: number; t: number; p: THREE.Vector3 | null; moved: boolean } | null = null
  let lastHit: THREE.Vector3 | null = null
  el.addEventListener('pointerdown', (e) => {
    if (e.button === 0) down = { x: e.clientX, y: e.clientY, t: performance.now(), p: pickGlobe(camera, el, e.clientX, e.clientY, new THREE.Vector3()), moved: false }
  })
  el.addEventListener('pointermove', (e) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) >= 5) down.moved = true
  })
  addEventListener('pointerup', (e) => {
    if (!down || e.button !== 0) return
    if (!down.moved && performance.now() - down.t < 500 && down.p) sim.drop(down.p, waveAmplitude)
    down = null
  })
  const oscillating = () => down !== null && !down.moved && down.p !== null && performance.now() - down.t > 500
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase()
    if (k === 'k') {
      scheme = scheme === 'classic' ? 'explorer' : 'classic'
      applyScheme()
    } else if (k === 'g' && lastHit) {
      if (addGauge(`Gauge ${gauges.gauges.length + 1}`, lastHit) < 0) toast('At most 8 gauges')
    } else if (k === 'l') {
      const { lat, lon } = toLatLon(camera.position)
      const u = new URL(location.origin + location.pathname)
      u.search = new URLSearchParams({
        lat: lat.toFixed(2),
        lon: lon.toFixed(2),
        alt: ((camera.position.length() - EARTH_RADIUS) / 1000).toFixed(0),
        S: String(uniforms.seaLevel.value),
        date: date.toISOString().slice(0, 16) + 'Z',
        intro: '0',
      }).toString()
      void navigator.clipboard?.writeText(u.toString()).then(() => toast('Link copied'), () => toast(u.toString()))
    } else if (k === 'i') {
      showAbout(data.credits)
    } else if (k === 'h') {
      hud.root.style.display = hud.root.style.display === 'none' ? '' : 'none'
    } else if (k === 'r') {
      sunMode = 'real'
      sunText.textContent = 'real (date & time)'
    }
  })

  // --- HUD -----------------------------------------------------------------------------
  const hud = new Hud('Blue Earth')
  const gaugesRef: { current?: GaugePanel } = {}
  const sea = hud.slider('Sea level', -130, 80, 1, uniforms.seaLevel.value, (v) => `${v > 0 ? '+' : ''}${v} m`, (v) => (uniforms.seaLevel.value = v))
  sea.input.addEventListener('change', () => sim.setSeaLevel(uniforms.seaLevel.value))
  const setSea = (v: number) => {
    uniforms.seaLevel.value = v
    sea.set(v)
    sim.setSeaLevel(v)
    gaugesRef.current?.resetSamples()
  }
  // Sea-level presets (approximate; IPCC AR6): LGM ≈ −120 m (20 kyr ago), Greenland ≈ +7.4 m,
  // all ice ≈ +70 m (here without isostatic rebound).
  hud.buttons('Presets', [
    { text: 'Ice age −120', title: 'Last Glacial Maximum, ~20,000 years ago', onClick: () => setSea(-120) },
    { text: 'Today', onClick: () => setSea(0) },
    { text: 'Greenland +7', title: 'Greenland ice sheet melted', onClick: () => setSea(7) },
    { text: 'All ice +70', title: 'All land ice melted (no isostatic rebound)', onClick: () => setSea(70) },
  ])
  let warp = Number(q.get('warp') ?? 600)
  let waveAmplitude = Number(q.get('drop') ?? 20)
  hud.slider('Sim speed', 0, 3000, 50, warp, (v) => (v ? `×${v}` : 'paused'), (v) => (warp = v))
  hud.slider('Drop height', 1, 100, 1, waveAmplitude, (v) => `${v} m`, (v) => (waveAmplitude = v))
  hud.slider('Waves', 0, 2, 0.05, uniforms.waveTint.value, (v) => (v ? `highlight ×${v.toFixed(2)}` : 'realistic'), (v) => {
    uniforms.waveTint.value = v
    uniforms.waveNormalGain.value = 4000 * v + 1
  })
  hud.slider('Wind', 0, 20, 0.5, uniforms.wind, (v) => `${v} m/s`, (v) => uniforms.setWind(v))
  hud.buttons('Map', [
    { text: 'Waves', onClick: () => (uniforms.overlay.value = 0) },
    { text: 'Max height', title: 'Maximum wave height so far (log scale 5 cm – 20 m)', onClick: () => (uniforms.overlay.value = 1) },
    { text: 'Arrival', title: 'Wave arrival time, hourly isochrones', onClick: () => (uniforms.overlay.value = 2) },
    { text: 'Calm sea', title: 'Reset the ocean to rest', onClick: () => (sim.calm(), gauges.resetSamples()) },
  ])
  if (q.has('overlay')) uniforms.overlay.value = Number(q.get('overlay'))
  const gauges = new GaugePanel()
  gaugesRef.current = gauges
  const addGauge = (name: string, pos: THREE.Vector3) => {
    const k = gauges.add(name, pos)
    if (k >= 0) sim.solver.setGauge(k, sim.cellAt(pos, true))
    return k
  }
  const eventText = document.createElement('div')
  eventText.className = 'be-hud-note'
  const runPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id)
    if (!p) return
    finishIntro()
    setSea(0)
    date = new Date(p.date)
    daySlider.set(dayOfYear(date))
    hourSlider.set(date.getUTCHours() + date.getUTCMinutes() / 60)
    sunMode = 'real'
    fromLatLon(p.view.lat, p.view.lon, EARTH_RADIUS + p.view.alt * 1000, camera.position)
    let info = ''
    if (p.segments) {
      const r = sim.applyFault(p.segments)
      info = ` · seafloor +${r.maxUp.toFixed(1)} / ${r.maxDown.toFixed(1)} m`
    } else if (p.impulse) sim.drop(fromLatLon(p.impulse.lat, p.impulse.lon, 1), p.impulse.amplitude, p.impulse.radiusCells)
    gauges.clear()
    for (let k = 0; k < 8; k++) sim.solver.setGauge(k, -1)
    for (const [name, [la, lo]] of Object.entries(p.gauges ?? {})) addGauge(name, fromLatLon(la, lo, 1))
    eventText.innerHTML = `<b>${p.name}</b> · ${p.magnitude}${info}<br>${p.note}<br><i>Simplified source model.</i>`
  }
  hud.select('Tsunami', [{ value: '', text: 'Historical event…' }, ...PRESETS.map((p) => ({ value: p.id, text: `${p.name} (${p.magnitude})` }))], runPreset)
  hud.root.appendChild(eventText)
  const simText = hud.text('Sim time')
  hud.slider('Relief', 1, 50, 1, uniforms.exaggeration.value, (v) => `×${v}`, (v) => (uniforms.exaggeration.value = v))
  const dayOfYear = (d: Date) => Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000)
  const setDay = (doy: number) => {
    const t = new Date(Date.UTC(date.getUTCFullYear(), 0, 1) + doy * 86_400_000)
    t.setUTCHours(date.getUTCHours(), date.getUTCMinutes())
    date = t
  }
  const daySlider = hud.slider('Day', 0, 364, 1, dayOfYear(date), (v) => new Date(Date.UTC(date.getUTCFullYear(), 0, 1 + v)).toLocaleDateString('en', { month: 'short', day: 'numeric', year: date.getUTCFullYear() === new Date().getUTCFullYear() ? undefined : 'numeric', timeZone: 'UTC' }), setDay)
  const hourSlider = hud.slider('Time (UTC)', 0, 23.99, 0.05, date.getUTCHours() + date.getUTCMinutes() / 60, (v) => `${String(Math.floor(v)).padStart(2, '0')}:${String(Math.floor((v % 1) * 60)).padStart(2, '0')}`, (v) => {
    date = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) + v * 3_600_000)
  })
  hud.slider('Time-lapse', 0, 24, 0.5, timeLapse, (v) => (v ? `${v} h/s` : 'off'), (v) => (timeLapse = v))
  uniforms.cloudAmount.value = q.get('clouds') === '0' ? 0 : 1
  hud.toggle('Clouds', uniforms.cloudAmount.value > 0, (v) => (uniforms.cloudAmount.value = v ? 1 : 0))
  const sunText = hud.text('Sun')
  sunText.textContent = 'real (date & time)'
  const posText = hud.text('Cursor')
  const schemeText = hud.text('Controls')
  if (q.get('hud') === '0') hud.root.style.display = 'none'
  hud.note(`Click: drop a wave (hold: oscillate) · G: tide gauge at cursor · L: copy link · I: about · Space: fullscreen · H: hide panel · K: switch controls · R: real sun · C: Classic 2004 · tier ${data.tier} · ${backend}`)
  applyScheme()

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(innerWidth, innerHeight)
  })

  // --- Intro (the 2004 opening): the world starts flooded and the sea drains away while the
  // camera dollies in. Any click or key skips it.
  const INTRO = 7
  // +2000 m drowns everything but the highest plateaus and the ice sheets, like the 2004 opening.
  const S_START = 2000
  const targetSea = uniforms.seaLevel.value
  const startDist = camera.position.length() * 2.2
  const endDist = camera.position.length()
  let introT = q.get('intro') === '0' ? Infinity : 0
  const title = introTitle()
  const finishIntro = () => {
    if (introT === Infinity) return
    introT = Infinity
    camera.position.setLength(endDist)
    setSea(targetSea)
    title.classList.add('out')
    setTimeout(() => title.remove(), 2500)
  }
  if (introT === 0) {
    camera.position.setLength(startDist)
    setSea(S_START)
    el.addEventListener('pointerdown', finishIntro, { once: true })
    addEventListener('keydown', finishIntro, { once: true })
  } else title.remove()
  if (q.has('preset')) runPreset(q.get('preset')!)

  // --- Screensaver / kiosk: after 90 s without input (or ?kiosk=1): slow orbit, time-lapse
  // sun, a random wave now and then. Any input ends it.
  let lastInput = performance.now()
  let kiosk = false
  let kioskDrop = 0
  let savedLapse = 0
  const setKiosk = (on: boolean) => {
    if (on === kiosk) return
    kiosk = on
    controls.autoRotate = on
    controls.autoRotateSpeed = 0.35
    if (on) {
      savedLapse = timeLapse
      timeLapse = 0.5
      hud.root.style.opacity = '0.35'
    } else {
      timeLapse = savedLapse
      hud.root.style.opacity = ''
    }
  }
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const)
    addEventListener(ev, () => {
      lastInput = performance.now()
      if (q.get('kiosk') !== '1') setKiosk(false)
    })
  if (q.get('kiosk') === '1') setKiosk(true)
  let gaugeBusy = false
  let gaugeT = -1

  let last = performance.now()
  renderer.setAnimationLoop(() => {
    const now = performance.now()
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now
    if (introT < INTRO) {
      introT += dt
      const e = Math.min(1, introT / INTRO)
      const S = targetSea + (S_START - targetSea) * (1 - e) ** 3
      uniforms.seaLevel.value = S
      sea.set(Math.round(S))
      sim.setSeaLevel(S)
      const k = 1 - (1 - e) ** 2
      camera.position.setLength(startDist + (endDist - startDist) * k)
      if (introT > INTRO * 0.7) title.classList.add('out')
      if (introT >= INTRO) finishIntro()
    }
    if (timeLapse > 0) {
      date = new Date(date.getTime() + timeLapse * 3_600_000 * dt)
      hourSlider.set(date.getUTCHours() + date.getUTCMinutes() / 60)
      daySlider.set(dayOfYear(date))
    }
    celestialAt(date, celestial)
    if (sunMode === 'manual') {
      // Frame-rate independent version of the 2004 smoothing sun = (3·sun + mouse) / 4 at 60 fps.
      manualSun.lerp(manualTarget, 1 - Math.exp(-dt / 0.058)).normalize()
      celestial.sun.copy(manualSun)
    }
    atmosphere.setCelestial(celestial.sun, celestial.moon, celestial.eciToEcef)
    if (!kiosk && introT === Infinity && now - lastInput > 90_000) setKiosk(true)
    if (kiosk && (kioskDrop -= dt) <= 0) {
      kioskDrop = 25
      sim.drop(sim.randomOceanPoint(), 30)
    }
    const steps = sim.advance(dt, warp)
    if (oscillating() && steps > 0) {
      // Source η = A·sin(2πt/T): add its increment over this frame's simulated time.
      const T = 600
      const tNow = sim.solver.time
      const tPrev = tNow - steps * sim.dt
      const a = (waveAmplitude / 4) * (Math.sin((2 * Math.PI * tNow) / T) - Math.sin((2 * Math.PI * tPrev) / T))
      sim.drop(down!.p!, a, 2)
    }
    if (gauges.gauges.length && !gaugeBusy && sim.solver.clock.value - gaugeT >= Math.max(30, sim.dt)) {
      gaugeBusy = true
      const t = sim.solver.clock.value
      void sim.solver.readGauges().then((v) => {
        gauges.record(t, v)
        gaugeT = t
        gaugeBusy = false
      })
    }
    gauges.update(camera, el)
    const h = sim.solver.time / 3600
    simText.textContent = `${Math.floor(h)} h ${String(Math.floor((h % 1) * 60)).padStart(2, '0')} min · dt ${sim.dt.toFixed(0)} s`
    uniforms.monthWeights.value.fromArray(monthWeights(date))

    // Keep depth precision: near/far follow the altitude.
    const dist = camera.position.length()
    camera.near = Math.max(1000, (dist - EARTH_RADIUS - 200_000) * 0.5)
    camera.far = dist + EARTH_RADIUS * 1.5
    camera.updateProjectionMatrix()
    controls.rotateSpeed = Math.min(1, Math.max(0.05, (dist - EARTH_RADIUS) / (EARTH_RADIUS * 3)))
    controls.update()
    atmosphere.render()
  })
}

/** "Blue Earth" title for the intro, a nod to the 2004 original. */
function introTitle(): HTMLDivElement {
  const div = document.createElement('div')
  div.className = 'be-intro'
  div.innerHTML = `<div class="be-intro-title">Blue Earth</div>
    <div class="be-intro-sub">Designed and coded by Loic Royer in 100% pure Java, 2004 · Reimagined for the web, 2026</div>`
  const style = document.createElement('style')
  style.textContent = `
  .be-intro { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
    padding-top: 9vh; pointer-events: none; animation: be-in 1.6s ease-out backwards; transition: opacity 1.8s ease-in; }
  .be-intro.out { opacity: 0; }
  .be-intro-title { font: italic 600 min(12vw, 120px)/1 system-ui, -apple-system, "Helvetica Neue", sans-serif; letter-spacing: .02em;
    color: #3d5dff; text-shadow: 0.06em 0.03em 0 rgba(20, 30, 120, 0.8), 0 0 40px rgba(80, 120, 255, 0.35); }
  .be-intro-sub { margin-top: 1.2em; font: italic 15px system-ui, sans-serif; color: rgba(220, 230, 255, 0.85); }
  @keyframes be-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }`
  document.head.appendChild(style)
  document.body.appendChild(div)
  return div
}

/** Credits and a short explanation (I). */
function showAbout(credits: string[]) {
  const div = document.createElement('div')
  div.style.cssText =
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#000a;z-index:20;font:13px/1.55 system-ui,sans-serif;color:#dbe6ff'
  div.innerHTML = `<div style="max-width:560px;padding:22px 26px;border-radius:12px;background:#0b1226f0;border:1px solid #8aa6ff33">
    <div style="font:italic 600 26px system-ui;color:#6f8dff;margin-bottom:6px">Blue Earth</div>
    <p>A web remake of Loic Royer's 2004 Java demo. Real shallow-water physics runs on the GPU over real
    bathymetry: waves travel at √(g·depth), reflect off coasts and flood low land. The sea level can go from
    Ice Age to an ice-free world. Historical tsunamis use simplified Okada fault sources.</p>
    <p style="opacity:.85"><b>Data:</b> ${credits.join(' · ')}</p>
    <p style="opacity:.85"><b>Software:</b> three.js (MIT) · @takram/three-atmosphere (MIT, Bruneton/Hillaire scattering)</p>
    <p style="opacity:.6">Vertical scales are exaggerated. Simplified physics and sources, not for hazard assessment.</p>
    <p style="opacity:.6">Click anywhere to close.</p></div>`
  div.addEventListener('click', () => div.remove())
  document.body.appendChild(div)
}
