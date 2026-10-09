import * as THREE from 'three/webgpu'
import {
  abs,
  min,
  texture,
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
  /** 0 = none, 1 = maximum wave height, 2 = arrival time. */
  readonly overlay = uniform(0)
  /** Wind speed (m/s) behind the water roughness. */
  wind = 7

  constructor() {
    this.setWind(this.wind)
  }

  /**
   * Cox & Munk (1954): total sea-surface slope variance σ² = 0.003 + 0.00512·W. Taking the
   * GGX α ≈ RMS slope gives roughness = √α (three's roughness is √α).
   */
  setWind(w: number) {
    this.wind = w
    this.waterRoughness.value = Math.sqrt(Math.sqrt(0.003 + 0.00512 * w))
  }
}

const any = (n: unknown) => n as any

/**
 * The globe surface: EAC-sampled albedo, terrain displacement and normals, and the water
 * rule at sea level S (ocean where F ≤ S, inland water where L > B). Lit by takram's
 * AtmosphereLight through MeshPhysicalNodeMaterial.
 */
/** Simulated ocean to display: gutter atlases on an n×n-per-face grid. */
export interface OceanDisplay {
  /** (η − η_rest, h, η, |u|). */
  texture: THREE.Texture
  /** (max anomaly, arrival time s or −1, max inundation, ·). */
  diagTexture: THREE.Texture
  n: number
}

export function createGlobeMaterial(
  data: GlobeData,
  u: GlobeUniforms,
  sunDirection: Node,
  ocean?: OceanDisplay,
  debug?: string | null,
  /** Vertex-stage geometry: unit direction, skirt flag and patch size (LOD mesh). */
  lod?: { dir: Node; skirt: Node; patchSize: Node; uv: Node; tile: Node },
  /** 500 m imagery tiles (texture array), addressed per LOD patch. */
  tiles?: { texture: THREE.Texture; size: number; maskMin: number },
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
    const inland = ocean.not().and(L.greaterThan(B)).and(L.greaterThan(NO_LAKE + 1))
    // Relict lakes: former sea basins cut off by a lower sea level (Baltic Ice Lake, Black Sea
    // at the LGM) fill to their spill point, which is exactly the flood level F.
    const relict = ocean.not().and(inland.not()).and(F.lessThanEqual(0)).and(F.greaterThan(B.add(0.5)))
    const lake = inland.or(relict)
    const still = select(ocean, max(S, B), select(inland, L, select(relict, F, B)))
    const water = ocean.or(lake)
    let level: any = still
    let eta: any = still
    let wet: any = water
    let depth: any = max(still.sub(B), 0)
    let anomaly: any = float(0)
    let speed: any = float(0)
    let inundated: any = float(0).greaterThan(1)
    if (ocean_) {
      const sim = simAt(d)
      anomaly = select(sim.y.greaterThan(0.05), sim.x, float(0))
      speed = sim.w
      // Waves: the anomaly η − η_rest, exaggerated on top of the still level.
      eta = still.add(anomaly)
      // Inundation: the simulated water surface stands above this (finer) land pixel, and
      // it is above rest there (so coarse coastal sim cells don't paint water at rest).
      inundated = water.not().and(anomaly.greaterThan(0.05)).and(sim.z.sub(B).greaterThan(0.1))
      wet = water.or(inundated)
      depth = select(water, depth, max(sim.z.sub(B), 0))
      level = select(water, still.add(anomaly.mul(u.waveExaggeration)), select(inundated, sim.z, B))
    }
    return { B, F, L, ocean, lake, water, wet, inundated, level, still, eta, anomaly, speed, depth }
  }

  const material = new THREE.MeshPhysicalNodeMaterial({ ior: 1.33 })

  // Vertex: radial displacement of the unit cube-sphere.
  const dirGeom = lod ? any(lod.dir) : any(positionGeometry).normalize()
  const vs = surface(dirGeom)
  let radius = float(EARTH_RADIUS).add(vs.level.mul(u.exaggeration))
  if (lod) {
    // Skirts drop by a fraction of the patch width (plus relief), hiding LOD cracks.
    const drop = any(lod.patchSize).mul(EARTH_RADIUS * 0.02).add(any(u.exaggeration).mul(300))
    radius = radius.sub(any(lod.skirt).mul(drop))
  }
  material.positionNode = dirGeom.mul(radius)

  // Fragment.
  const d = any(varying(dirGeom, 'vGlobeDir')).normalize()
  const s = surface(d)

  // Albedo: month blend.
  const w = any(u.monthWeights)
  const month = (k: string) => any(sampleEACArray(data.albedo[k], d, n, gutter)).rgb
  let albedo: any = month('01').mul(w.x).add(month('04').mul(w.y)).add(month('07').mul(w.z)).add(month('10').mul(w.w))
  // 500 m tiles (July): add their detail as a ratio to the global July albedo, so the date's
  // seasonal colours stay and tiled/untiled patches meet without seams.
  let tileMask: any = null
  let tileOn: any = float(0).greaterThan(1)
  if (lod && tiles) {
    const tl = any(lod.tile)
    tileOn = tl.x.greaterThanEqual(0)
    const n = tiles.size
    // Patch uv → tile uv (ancestor sub-rect), inset by half a texel so edges hit texel centres.
    const tuv = any(lod.uv).mul(tl.y).add(tl.zw).mul((n - 1) / n).add(0.5 / n)
    const tex = any(texture(tiles.texture, tuv)).depth(max(tl.x, 0))
    const ratio = any(tex.rgb).div(max(month('07'), vec3(0.015))).clamp(0.3, 3)
    albedo = select(tileOn, albedo.mul(ratio), albedo)
    tileMask = saturate(any(tex.a).mul(255).sub(tiles.maskMin).div(255 - tiles.maskMin))
  }


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
  // At (near) today's sea level the 500 m tile mask defines the coastline.
  const seaToday = abs(any(u.seaLevel)).lessThan(0.5)
  const wetF: any = tileMask ? select(tileOn.and(seaToday), tileMask.lessThan(0.5).or(s.inundated), s.wet) : s.wet
  const normalWorldN = select(wetF, waterNormal, terrainNormal)
  // normalNode is view space. (TSL's n.transformDirection(cameraViewMatrix) is the inverse,
  // view → world, as used in three's Normal.js.)
  material.normalNode = any(cameraViewMatrix).mul(vec4(any(normalWorldN), 0)).xyz.normalize()

  // Water optics. Light reaching the bottom and back is absorbed per channel over 2·depth
  // (red first), then the deep-water colour takes over (Beer–Lambert with a scattering colour).
  const absorb = vec3(0.35, 0.065, 0.03)
  const deepWater = vec3(0.004, 0.018, 0.05)
  const underwater = (bottom: any, depth: any) => {
    const T = any(absorb.mul(depth.mul(-2))).exp()
    return bottom.mul(T).add(deepWater.mul(float(1).sub(T)))
  }
  const wasOcean = s.F.lessThanEqual(0)
  // Exposed seabed (low sea level). At the Last Glacial Maximum the shelves were land: tropical
  // forest (Sundaland), steppe at mid latitudes, tundra poleward; sand near the new shoreline.
  // Under water the same palette darkens toward mud with depth. Texture comes from the Blue
  // Marble ocean colour, whose shading follows the bathymetry.
  const absLat = abs(d.z)
  const biome = mix(mix(vec3(0.16, 0.22, 0.1), vec3(0.4, 0.37, 0.25), smoothstep(0.3, 0.5, absLat)), vec3(0.5, 0.5, 0.46), smoothstep(0.75, 0.9, absLat))
  const aboveSea = any(s.B.sub(u.seaLevel))
  const shore = saturate(float(1).sub(aboveSea.div(12)))
  const lum = albedo.dot(vec3(0.3, 0.5, 0.2))
  const grain = saturate(lum.sub(0.035).mul(14).add(0.75))
  const exposed = mix(biome, vec3(0.6, 0.55, 0.43), shore).mul(grain)
  const seabed = select(s.B.lessThan(u.seaLevel), mix(vec3(0.55, 0.5, 0.4), vec3(0.3, 0.29, 0.27), saturate(s.B.negate().div(300))), exposed)
  // Today's ocean keeps the Blue Marble colour; as the sea drops it blends toward the model.
  const depthToday = max(s.B.negate(), 1)
  const todayOcean = mix(albedo, underwater(seabed, s.depth), saturate(float(1).sub(s.depth.div(depthToday))))
  const wetLand = albedo.mul(0.65)
  const floodedLand = underwater(wetLand, s.depth)
  let ground: any = select(
    s.ocean,
    select(wasOcean, todayOcean, floodedLand),
    select(s.lake, albedo, select(s.inundated, floodedLand, select(wasOcean, seabed, albedo))),
  )
  // Foam: breaking waves (amplitude large relative to depth) and fast shallow run-up.
  const breaking = saturate(any(s.anomaly).div(max(s.depth, 1)).sub(0.15).mul(4))
  const runup = select(s.inundated, saturate(any(s.speed).div(2)).mul(saturate(float(1).sub(s.depth.div(4)))), float(0))
  const foam = saturate(breaking.add(runup)).toConst()
  if (ocean_) {
    // Make waves legible from orbit: crests lighten toward sea-foam blue, troughs deepen.
    const an = any(s.eta.sub(s.still))
    // Soft saturation a/(a + 0.4 m): half strength at 0.4 m, still graded for 50 m waves.
    const soft = (x: any) => max(x, 0).div(max(x, 0).add(0.4))
    const crest = soft(an).mul(u.waveTint)
    const trough = soft(an.negate()).mul(u.waveTint)
    const waterTinted = mix(mix(ground, vec3(0.45, 0.75, 0.9), saturate(crest.mul(0.6))), ground.mul(0.25), saturate(trough.mul(0.7)))
    ground = select(s.water, waterTinted, ground)
  }
  ground = mix(ground, vec3(0.9, 0.93, 0.95), foam.mul(0.85))

  if (ocean_) {
    const dg = any(sampleFaceAtlas(ocean_.diagTexture, d, ocean_.n))
    // Maximum wave height: log scale 2 cm … 5 m; five-stop ramp (blue → cyan → yellow → red →
    // magenta), translucent at the low end so small values don't hide the ocean.
    const hmax = any(max(dg.x, dg.z))
    const tMax = saturate(hmax.div(0.02).log().div(Math.log(250)))
    const stops = [vec3(0.15, 0.25, 0.85), vec3(0.1, 0.8, 0.9), vec3(1, 0.9, 0.25), vec3(0.95, 0.2, 0.1), vec3(0.85, 0.15, 0.85)]
    const seg = (t: any, k: number) => saturate(t.mul(4).sub(k))
    let ramp: any = stops[0]
    for (let k = 1; k < 5; k++) ramp = mix(ramp, stops[k], seg(tMax, k - 1))
    const alpha = select(hmax.greaterThan(0.02), mix(float(0.35), float(0.9), saturate(tMax.mul(2))), float(0))
    const maxColor = mix(ground, ramp, alpha)
    // Arrival time: hourly isochrones (constant pixel width) over a faint fill coloured by hour.
    const hours = any(dg.y).div(3600)
    const arrived = dg.y.greaterThanEqual(0)
    const dist = any(abs(hours.fract().sub(0.5)).negate().add(0.5))
    const line = float(1).sub(smoothstep(0, any(hours).fwidth().mul(1.5), dist))
    const fill = mix(vec3(0.95, 0.85, 0.3), vec3(0.3, 0.45, 1), saturate(hours.div(24)))
    const arrColor = select(arrived, mix(mix(ground, fill, 0.35), vec3(1), line.mul(0.9)), ground)
    const mode = any(u.overlay)
    ground = select(mode.equal(1), maxColor, select(mode.equal(2), arrColor, ground))
  }

  // Clouds (on the surface, as in takram's Blue Marble example) with an offset shadow.
  const sun = any(sunDirection)
  const sunTangent = sun.sub(d.mul(sun.dot(d)))
  const clouds = any(sampleEACArray(data.clouds, d, n, gutter)).r.mul(u.cloudAmount).toConst()
  const shadowDir = d.sub(sunTangent.mul(0.004)).normalize()
  const shadow = any(sampleEACArray(data.clouds, shadowDir, n, gutter)).r.mul(u.cloudAmount)
  const shaded = ground.mul(float(1).sub(saturate(shadow.sub(clouds)).mul(0.6)))
  material.colorNode = vec4(mix(shaded, vec3(0.95), clouds), 1)

  // Water roughness from the wind (Cox–Munk, set by GlobeUniforms.setWind); foam, land and
  // clouds are rough.
  const waterRough = mix(float(u.waterRoughness as never), float(0.9), foam)
  material.roughnessNode = mix(select(wetF, waterRough, float(0.95)), float(1), clouds)

  // Night lights: dry land only, behind the terminator, dimmed by clouds.
  const night = any(sampleEACArray(data.night, d, n, gutter)).rgb
  const dark = smoothstep(0.05, -0.12, d.dot(sun))
  material.emissiveNode = night
    .mul(night)
    .mul(dark)
    .mul(float(1).sub(clouds.mul(0.8)))
    .mul(select(wetF, float(0), float(1)))
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
