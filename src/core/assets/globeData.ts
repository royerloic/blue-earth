import type * as THREE from 'three/webgpu'
import { Ktx2Arrays } from './ktx2'

/** public/data/manifest.json, written by pipeline/blueearth_pipeline/build.py. */
export interface DataManifest {
  version: number
  gutter: number
  credits: string[]
  tiers: Record<
    string,
    {
      display: number
      sim: number
      bytes: number
      files: { terrain: string; sim: string; albedo: Record<string, string>; night: string; clouds: string }
    }
  >
}

export interface GlobeData {
  tier: string
  /** Face size (texels, excluding gutters) of the display textures, and the gutter width. */
  n: number
  gutter: number
  /** Simulation grid face size. */
  nSim: number
  /** RGBA16F: B surface elevation, E = F − B flood excess, L lake level (−1e4 = none), I ice. */
  terrain: THREE.Texture
  /** Same layers on the simulation grid, without gutters. */
  sim: THREE.Texture
  /** Monthly Blue Marble albedo, keyed "01" | "04" | "07" | "10". */
  albedo: Record<string, THREE.Texture>
  night: THREE.Texture
  clouds: THREE.Texture
  credits: string[]
}

export const NO_LAKE = -10000

const manifests = new Map<string, Promise<DataManifest>>()
const defaultBase = () => `${import.meta.env.VITE_ASSET_BASE ?? import.meta.env.BASE_URL}data/`

function manifestAt(base: string): Promise<DataManifest> {
  if (!manifests.has(base)) manifests.set(base, fetch(`${base}manifest.json`).then((r) => r.json()))
  return manifests.get(base)!
}

function tierOf(manifest: DataManifest, tier: string) {
  const t = manifest.tiers[tier]
  if (!t) throw new Error(`unknown data tier "${tier}" (have: ${Object.keys(manifest.tiers).join(', ')})`)
  return t
}

/** Only a tier's simulation bathymetry (small), e.g. to start the sim at full resolution early. */
export async function loadSimData(renderer: THREE.WebGPURenderer, tier: string, base = defaultBase()) {
  const t = tierOf(await manifestAt(base), tier)
  const sim = await new Ktx2Arrays(renderer, `${import.meta.env.BASE_URL}basis/`).load(`${base}${tier}/${t.files.sim}`)
  return { sim, nSim: t.sim }
}

/**
 * Loads every texture of one quality tier. `base` defaults to the app's data folder; pass an
 * already loaded `sim` texture to skip fetching it again.
 */
export async function loadGlobeData(
  renderer: THREE.WebGPURenderer,
  tier: string,
  base = defaultBase(),
  reuse: { sim?: THREE.Texture } = {},
): Promise<GlobeData> {
  const manifest = await manifestAt(base)
  const t = tierOf(manifest, tier)
  const loader = new Ktx2Arrays(renderer, `${import.meta.env.BASE_URL}basis/`)
  const url = (f: string) => `${base}${tier}/${f}`
  const months = Object.keys(t.files.albedo)
  const [terrain, sim, night, clouds, ...albedo] = await Promise.all([
    loader.load(url(t.files.terrain)),
    reuse.sim ? Promise.resolve(reuse.sim) : loader.load(url(t.files.sim)),
    loader.load(url(t.files.night)),
    loader.load(url(t.files.clouds)),
    ...months.map((m) => loader.load(url(t.files.albedo[m]))),
  ])
  return {
    tier,
    n: t.display,
    gutter: manifest.gutter,
    nSim: t.sim,
    terrain,
    sim,
    night,
    clouds,
    albedo: Object.fromEntries(months.map((m, i) => [m, albedo[i]])),
    credits: manifest.credits,
  }
}
