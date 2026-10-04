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
  const atmosphere = new Atmosphere(renderer, scene, camera)
  if (q.has('exposure')) atmosphere.exposure.value = Number(q.get('exposure'))
  if (q.has('night')) uniforms.nightIntensity.value = Number(q.get('night'))
  if (q.has('rough')) uniforms.waterRoughness.value = Number(q.get('rough'))
  if (q.has('raymarch')) atmosphere.context.raymarchScattering = q.get('raymarch') !== '0'
  const globe = new THREE.Mesh(createCubeSphere(256), createGlobeMaterial(data, uniforms, atmosphere.context.sunDirectionECEF, q.get('debug')))
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
    if (p && (scheme === 'classic' ? e.buttons === 0 : e.shiftKey)) {
      sunForGlintAt(p, camera.position, manualTarget)
      if (sunMode === 'real') manualSun.copy(celestial.sun)
      sunMode = 'manual'
      sunText.textContent = 'manual (R = real sun)'
    }
  })
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase()
    if (k === 'k') {
      scheme = scheme === 'classic' ? 'explorer' : 'classic'
      applyScheme()
    } else if (k === 'r') {
      sunMode = 'real'
      sunText.textContent = 'real (date & time)'
    }
  })

  // --- HUD -----------------------------------------------------------------------------
  const hud = new Hud('Blue Earth')
  hud.slider('Sea level', -130, 80, 1, uniforms.seaLevel.value, (v) => `${v > 0 ? '+' : ''}${v} m`, (v) => (uniforms.seaLevel.value = v))
  hud.slider('Relief', 1, 50, 1, uniforms.exaggeration.value, (v) => `×${v}`, (v) => (uniforms.exaggeration.value = v))
  const dayOfYear = (d: Date) => Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000)
  const setDay = (doy: number) => {
    const t = new Date(Date.UTC(date.getUTCFullYear(), 0, 1) + doy * 86_400_000)
    t.setUTCHours(date.getUTCHours(), date.getUTCMinutes())
    date = t
  }
  const daySlider = hud.slider('Day', 0, 364, 1, dayOfYear(date), (v) => new Date(Date.UTC(2026, 0, 1 + v)).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }), setDay)
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
  hud.note(`K: switch controls · R: real sun · C: Classic 2004 · tier ${data.tier} · ${backend}`)
  applyScheme()

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(innerWidth, innerHeight)
  })

  let last = performance.now()
  renderer.setAnimationLoop(() => {
    const now = performance.now()
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now
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
