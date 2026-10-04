import * as THREE from 'three/webgpu'
import { float, max, mix, positionLocal, saturate, select, smoothstep, uniform, vec3 } from 'three/tsl'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type Node from 'three/src/nodes/core/Node.js'
import { loadGlobeData, NO_LAKE } from '../../src/core/assets/globeData'
import { sampleEACArray } from '../../src/core/geo/cubeEAC'

/**
 * M2 data preview: real albedo + terrain on the globe with a sea-level slider.
 * Water rule: ocean where F = B + E <= S (connected to the sea); inland water where L > B.
 * Exposed seabed when S < 0 gets a sediment colour; newly flooded land is tinted by depth.
 */
export async function runDataPreview(renderer: THREE.WebGPURenderer) {
  const q = new URLSearchParams(location.search)
  const t0 = performance.now()
  const data = await loadGlobeData(renderer, q.get('tier') ?? 'medium')
  const loadMs = performance.now() - t0

  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(innerWidth, innerHeight)
  document.body.appendChild(renderer.domElement)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 100)
  camera.up.set(0, 0, 1)
  const lat = (Number(q.get('lat') ?? 20) * Math.PI) / 180
  const lon = (Number(q.get('lon') ?? 10) * Math.PI) / 180
  const dist = Number(q.get('dist') ?? 3.6)
  camera.position.set(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)).multiplyScalar(dist)

  const S = uniform(Number(q.get('S') ?? 0))
  const d = (positionLocal as any).normalize() as Node
  const terr = sampleEACArray(data.terrain, d, data.n, data.gutter, false) as any
  const B = terr.x
  const F = B.add(terr.y)
  const L = terr.z
  const month = q.get('month') ?? '07'
  const albedo = (sampleEACArray(data.albedo[month] ?? data.albedo['07'], d, data.n, data.gutter) as any).rgb
  const clouds = (sampleEACArray(data.clouds, d, data.n, data.gutter) as any).r
  const night = (sampleEACArray(data.night, d, data.n, data.gutter) as any).rgb

  const oceanNow = F.lessThanEqual(S)
  const lake = L.greaterThan(B).and(L.greaterThan(NO_LAKE + 1))
  const wasOcean = F.lessThanEqual(0)
  const depth = max(S.sub(B), 0)
  const deepBlue = vec3(0.01, 0.05, 0.16)
  const flooded = mix(albedo.mul(vec3(0.5, 0.7, 0.9)), deepBlue, saturate(depth.div(60)))
  const seabed = mix(vec3(0.55, 0.5, 0.4), vec3(0.32, 0.31, 0.3), saturate(B.negate().div(800)))
  let color: any = select(oceanNow, select(wasOcean, albedo, flooded), select(wasOcean.and(lake.not()), seabed, albedo))
  if (q.get('clouds') !== '0') color = mix(color, vec3(1), clouds.mul(0.85))

  const sun = new THREE.Vector3(1, 0.6, 0.35).normalize()
  const ndl = (d as any).dot(vec3(sun.x, sun.y, sun.z))
  const lit = color.mul(saturate(ndl).mul(0.95).add(0.03))
  const lights = night.mul(smoothstep(0.05, -0.15, ndl)).mul(oceanNow.not().and(lake.not()).select(float(1), float(0)))
  const material = new THREE.MeshBasicNodeMaterial()
  material.colorNode = lit.add(lights.mul(1.2))
  const geometry = new THREE.SphereGeometry(1, 512, 256)
  geometry.rotateX(Math.PI / 2)
  scene.add(new THREE.Mesh(geometry, material))

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.minDistance = 1.2

  const ui = document.createElement('div')
  ui.style.cssText = 'position:fixed;left:12px;bottom:12px;color:#cde;font:13px system-ui;background:#0008;padding:8px 12px;border-radius:6px'
  ui.innerHTML = `<label>Sea level <input id="sl" type="range" min="-130" max="80" step="1" value="${S.value}" style="width:260px;vertical-align:middle"> <b id="sv"></b> m</label>
    <div style="opacity:.7;margin-top:4px">tier ${data.tier} · faces ${data.n}² · ${(loadMs / 1000).toFixed(1)} s load</div>`
  document.body.appendChild(ui)
  const sl = ui.querySelector<HTMLInputElement>('#sl')!
  const sv = ui.querySelector<HTMLElement>('#sv')!
  const upd = () => {
    S.value = Number(sl.value)
    sv.textContent = (S.value > 0 ? '+' : '') + S.value
  }
  sl.addEventListener('input', upd)
  upd()

  renderer.setAnimationLoop(() => {
    controls.update()
    renderer.render(scene, camera)
  })
  return { tier: data.tier, n: data.n, loadMs: Math.round(loadMs) }
}
