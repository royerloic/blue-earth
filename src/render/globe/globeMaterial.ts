import * as THREE from 'three/webgpu'
import {
  abs,
  min,
  cameraViewMatrix,
  cross,
  float,
  max,
  mix,
  positionGeometry,
  saturate,
  select,
  smoothstep,
  uniform,
  varying,
  vec3,
  vec4,
} from 'three/tsl'
import type Node from 'three/src/nodes/core/Node.js'
import { NO_LAKE, type GlobeData } from '../../core/assets/globeData'
import { sampleEACArray, sampleFaceAtlas } from '../../core/geo/cubeEAC'
import { EARTH_RADIUS } from '../../core/geo/units'

/** Uniforms the app drives every frame. */
export class GlobeUniforms {
  /** Sea level S (m) relative to today. */
  readonly seaLevel = uniform(0)
  /** Vertical exaggeration of terrain and water relief. */
  readonly exaggeration = uniform(15)
  /** Weights of the Jan/Apr/Jul/Oct albedo months. */
  readonly monthWeights = uniform(new THREE.Vector4(0, 0, 1, 0))
  readonly cloudAmount = uniform(1)
  readonly nightIntensity = uniform(0.4)
  readonly waterRoughness = uniform(0.35)
  /** Vertical exaggeration of simulated waves (relative to the static water level). */
  readonly waveExaggeration = uniform(300)
  /** Extra gain on wave slopes for shading (orbit-scale waves are very flat). */
  readonly waveNormalGain = uniform(4000)
  /** Crest/trough tint strength (0 = physically plain water). */
  readonly waveTint = uniform(1)
}

const any = (n: unknown) => n as any

/**
 * The globe surface: EAC-sampled albedo, terrain displacement and normals, and the water
 * rule at sea level S (ocean where F ≤ S, inland water where L > B). Lit by takram's
 * AtmosphereLight through MeshPhysicalNodeMaterial.
 */
/** Simulated ocean to display: atlas texture of (η, h, ·, ·) on an n×n-per-face grid. */
export interface OceanDisplay {
  texture: THREE.Texture
  n: number
}

export function createGlobeMaterial(
  data: GlobeData,
  u: GlobeUniforms,
  sunDirection: Node,
  ocean?: OceanDisplay,
  debug?: string | null,
): THREE.MeshPhysicalNodeMaterial {
  const { n, gutter } = data
  const ocean_ = ocean
  const terrainAt = (d: Node) => any(sampleEACArray(data.terrain, d, n, gutter, false))
  const simAt = (d: Node) => any(sampleFaceAtlas(ocean!.texture, d, ocean!.n))

  /** Surface classification and level (m) at unit direction d. */
  const surface = (d: Node) => {
    const t = terrainAt(d)
    const B = t.x
    const F = B.add(t.y)
    const L = t.z
    const S = any(u.seaLevel)
    const ocean = F.lessThanEqual(S)
    const lake = ocean.not().and(L.greaterThan(B)).and(L.greaterThan(NO_LAKE + 1))
    const still = select(ocean, max(S, B), select(lake, L, B))
    const water = ocean.or(lake)
    let level: any = still
    let eta: any = still
    if (ocean_) {
      // Wave anomaly (η − η_rest) from the sim, exaggerated on top of the still level.
      const sim = simAt(d)
      const anomaly = select(sim.y.greaterThan(0.05), sim.x, float(0))
      eta = still.add(anomaly)
      level = select(water, still.add(anomaly.mul(u.waveExaggeration)), B)
    }
    return { B, F, L, ocean, lake, water, level, still, eta, depth: max(still.sub(B), 0) }
  }

  const material = new THREE.MeshPhysicalNodeMaterial({ ior: 1.33 })

  // Vertex: radial displacement of the unit cube-sphere.
  const dirGeom = any(positionGeometry).normalize()
  const vs = surface(dirGeom)
  material.positionNode = dirGeom.mul(float(EARTH_RADIUS).add(vs.level.mul(u.exaggeration)))

  // Fragment.
  const d = any(varying(positionGeometry, 'vGlobeDir')).normalize()
  const s = surface(d)

  // Height-derived normal from ±1 texel samples along a local east/north frame.
  const ref = select(abs(d.z).greaterThan(0.99), vec3(1, 0, 0), vec3(0, 0, 1))
  const east = any(cross(ref, d)).normalize()
  const north = any(cross(d, east))
  const delta = Math.PI / 2 / n
  const lv = (dir: any) => surface(dir.normalize()).level
  const scale = any(u.exaggeration).div(2 * delta * EARTH_RADIUS)
  const gx = lv(d.add(east.mul(delta))).sub(lv(d.sub(east.mul(delta)))).mul(scale)
  const gy = lv(d.add(north.mul(delta))).sub(lv(d.sub(north.mul(delta)))).mul(scale)
  const terrainNormal = d.sub(east.mul(gx)).sub(north.mul(gy)).normalize()
  let waterNormal: any = d
  if (ocean_) {
    // Wave slopes from the simulated η at ±1 sim cell, with a shading gain.
    const ds = Math.PI / 2 / ocean_.n
    const ev = (dir: any) => surface(dir.normalize()).eta
    const ws = any(u.waveNormalGain).div(2 * ds * EARTH_RADIUS)
    const wx = ev(d.add(east.mul(ds))).sub(ev(d.sub(east.mul(ds)))).mul(ws)
    const wy = ev(d.add(north.mul(ds))).sub(ev(d.sub(north.mul(ds)))).mul(ws)
    // Clamp the tilt so steep near-field waves don't flip the normal.
    const tilt = vec3(wx, wy, 0) as any
    const lim = min(float(1), float(0.6).div(max(tilt.length(), 1e-6)))
    waterNormal = d.sub(east.mul(wx.mul(lim))).sub(north.mul(wy.mul(lim))).normalize()
  }
  const normalWorldN = select(s.water, waterNormal, terrainNormal)
  // normalNode is view space. (TSL's n.transformDirection(cameraViewMatrix) is the inverse,
  // view → world, as used in three's Normal.js.)
  material.normalNode = any(cameraViewMatrix).mul(vec4(any(normalWorldN), 0)).xyz.normalize()

  // Albedo: month blend.
  const w = any(u.monthWeights)
  const month = (k: string) => any(sampleEACArray(data.albedo[k], d, n, gutter)).rgb
  const albedo = month('01').mul(w.x).add(month('04').mul(w.y)).add(month('07').mul(w.z)).add(month('10').mul(w.w))

  // Water and exposed seabed.
  const wasOcean = s.F.lessThanEqual(0)
  const deepBlue = vec3(0.004, 0.02, 0.06)
  const flooded = mix(albedo.mul(vec3(0.45, 0.65, 0.85)), deepBlue, saturate(s.depth.div(40)))
  const seabed = mix(vec3(0.5, 0.45, 0.36), vec3(0.3, 0.29, 0.28), saturate(s.B.negate().div(1500)))
  let ground: any = select(s.ocean, select(wasOcean, albedo, flooded), select(wasOcean.and(s.lake.not()), seabed, albedo))
  if (ocean_) {
    // Make waves legible from orbit: crests lighten toward sea-foam blue, troughs deepen.
    const an = any(s.eta.sub(s.still))
    const crest = saturate(an.div(0.4)).mul(u.waveTint)
    const trough = saturate(an.negate().div(0.4)).mul(u.waveTint)
    const waterTinted = mix(mix(ground, vec3(0.45, 0.75, 0.9), saturate(crest.mul(0.75))), ground.mul(0.25), saturate(trough.mul(0.7)))
    ground = select(s.water, waterTinted, ground)
  }

  // Clouds (on the surface, as in takram's Blue Marble example) with an offset shadow.
  const sun = any(sunDirection)
  const sunTangent = sun.sub(d.mul(sun.dot(d)))
  const clouds = any(sampleEACArray(data.clouds, d, n, gutter)).r.mul(u.cloudAmount).toConst()
  const shadowDir = d.sub(sunTangent.mul(0.004)).normalize()
  const shadow = any(sampleEACArray(data.clouds, shadowDir, n, gutter)).r.mul(u.cloudAmount)
  const shaded = ground.mul(float(1).sub(saturate(shadow.sub(clouds)).mul(0.6)))
  material.colorNode = vec4(mix(shaded, vec3(0.95), clouds), 1)

  // Water is macroscopically glossy (sun glint); land and clouds are rough.
  material.roughnessNode = mix(select(s.water, float(u.waterRoughness as never), float(0.95)), float(1), clouds)

  // Night lights: dry land only, behind the terminator, dimmed by clouds.
  const night = any(sampleEACArray(data.night, d, n, gutter)).rgb
  const dark = smoothstep(0.05, -0.12, d.dot(sun))
  material.emissiveNode = night
    .mul(night)
    .mul(dark)
    .mul(float(1).sub(clouds.mul(0.8)))
    .mul(select(s.water, float(0), float(1)))
    .mul(u.nightIntensity)
  const flags = new Set((debug ?? '').split(','))
  if (flags.has('nonormal')) material.normalNode = null
  if (flags.has('nodisp')) material.positionNode = dirGeom.mul(EARTH_RADIUS)
  if (flags.has('rough')) material.roughnessNode = float(0.1)
  if (flags.has('wave')) {
    // Red = crest, blue = trough, saturating at ±0.5 m.
    const a = saturate(any(s.eta.sub(s.still)).div(0.5))
    const b = saturate(any(s.still.sub(s.eta)).div(0.5))
    material.colorNode = vec4(mix(mix(vec3(0.05), vec3(1, 0.2, 0.1), a), vec3(0.1, 0.3, 1), b), 1)
  }
  if (debug === 'normal') {
    material.colorNode = vec4(0, 0, 0, 1)
    material.emissiveNode = any(normalWorldN).mul(0.5).add(0.5)
  }
  if (debug === 'ndl') {
    material.colorNode = vec4(0, 0, 0, 1)
    material.emissiveNode = vec3(any(saturate(any(normalWorldN).dot(sun))))
  }
  return material
}
