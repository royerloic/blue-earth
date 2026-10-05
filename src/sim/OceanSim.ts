import * as THREE from 'three/webgpu'
import { clamp, float, floor, int, ivec2, max, mod, select, vec3, vec4 } from 'three/tsl'
import type Node from 'three/src/nodes/core/Node.js'
import { NO_LAKE, type GlobeData } from '../core/assets/globeData'
import { EARTH_RADIUS } from '../core/geo/units'
import { ComputeExecutor } from './executor/ComputeExecutor'
import { RTTExecutor } from './executor/RTTExecutor'
import type { Executor, Field } from './executor/types'
import { buildCubeGrid, type CubeGrid } from './grid'
import { DEFAULT_PARAMS, stableDt } from './swe'
import { SWESolver } from './SWESolver'
import { segmentUplift, type FaultSegment } from './okada'

/** Must match PROTECTED_LOWLAND_FLOOD in pipeline/blueearth_pipeline/dem.py. */
const PROTECTED_FLOOD = 2

/**
 * The world ocean: real bathymetry (the tier's sim.ktx2), the GPU solver, sea-level
 * initialisation, wave drops and time warp. `display` holds (η − η_rest, h, η, |u|) per cell
 * in a 3×2 face atlas with a 1-texel gutter per face side ((N+2)² per face), filled from the
 * neighbouring faces, so the renderer can filter across cube edges without seams.
 * The wave anomaly is what the renderer exaggerates.
 */
export class OceanSim {
  readonly grid: CubeGrid
  readonly solver: SWESolver
  readonly display: Field
  readonly displayTexture: THREE.Texture
  /** (max anomaly m, arrival s or −1, max inundation m, ·), same gutter atlas as `display`. */
  readonly diagDisplay: Field
  readonly diagTexture: THREE.Texture
  private readonly updateDiag: () => void
  private frame = 0
  readonly N: number
  readonly dt: number
  private readonly exec: Executor
  private readonly B: Float32Array
  private readonly F: Float32Array
  private readonly L: Float32Array
  private readonly updateDisplay: () => void
  private debt = 0
  seaLevel = 0

  constructor(renderer: THREE.WebGPURenderer, backend: string, data: GlobeData, seaLevel = 0) {
    this.N = data.nSim
    this.grid = buildCubeGrid(this.N, EARTH_RADIUS)
    const cells = this.grid.cells
    this.B = new Float32Array(cells)
    this.F = new Float32Array(cells)
    this.L = new Float32Array(cells)
    const half = (data.sim.image as { data: Uint16Array }).data
    for (let c = 0; c < cells; c++) {
      // sim.ktx2 is a 6-layer N×N RGBA16F array; layer-major order equals the cell id order.
      const b = THREE.DataUtils.fromHalfFloat(half[c * 4])
      const f = b + THREE.DataUtils.fromHalfFloat(half[c * 4 + 1])
      this.F[c] = f
      this.L[c] = THREE.DataUtils.fromHalfFloat(half[c * 4 + 2])
      // Protected lowlands (pipeline sets F = +2 m below-sea-level land): the dikes are not in
      // the DEM, so the sim sees them as ground at the flood level and keeps them dry.
      this.B[c] = b < PROTECTED_FLOOD && Math.abs(f - PROTECTED_FLOOD) < 0.5 ? PROTECTED_FLOOD : b
      // Inland lakes are static in v1: the sim sees their surface as flat ground, so coarse
      // lake-level estimates cannot spill into lower neighbours. (The renderer still draws them.)
      const l = this.L[c]
      if (f > 0 && l > NO_LAKE + 1 && l > b) this.B[c] = l
    }
    let deepest = 0
    for (const b of this.B) deepest = Math.min(deepest, b)
    this.dt = stableDt(this.grid, -deepest)
    this.exec = backend === 'webgpu' ? new ComputeExecutor(renderer) : new RTTExecutor(renderer)
    this.seaLevel = seaLevel
    this.solver = new SWESolver(this.exec, this.grid, this.B, this.initialEta(seaLevel), DEFAULT_PARAMS, this.F)
    this.solver.seaLevel.value = seaLevel
    this.solver.dt.value = this.dt
    const N = this.N
    const M = N + 2
    this.display = this.exec.createField(3 * M, 2 * M)
    this.displayTexture = this.exec.texture(this.display)
    /** Texel (in the solver atlas) shown at display texel q, including gutters from neighbours. */
    const gutterSource = (q: Node, nb: (p: Node) => Node): Node => {
      const X = (q as any).x
      const Y = (q as any).y
      const fx = X.div(M)
      const fy = Y.div(M)
      const lx = X.sub(fx.mul(M)).sub(1)
      const ly = Y.sub(fy.mul(M)).sub(1)
      const cx = clamp(lx, 0, N - 1)
      const cy = clamp(ly, 0, N - 1)
      const edge = ivec2(fx.mul(N).add(cx), fy.mul(N).add(cy)) as unknown as Node
      // Gutter texels read the neighbour across the face edge (−s, +s, −t, +t).
      const nbs = nb(edge) as any
      const packed = select(
        lx.lessThan(0),
        nbs.y,
        select(lx.greaterThanEqual(N), nbs.x, select(ly.lessThan(0), nbs.w, nbs.z)),
      ) as any
      const isGutter = lx.lessThan(0).or(lx.greaterThanEqual(N)).or(ly.lessThan(0)).or(ly.greaterThanEqual(N))
      const across = ivec2(int(mod(packed, 4096)), int(floor(packed.div(4096))))
      return select(isGutter, across, edge as any) as unknown as Node
    }
    this.updateDisplay = this.solver.view(({ u, bed, nb }, q) => {
      const src = gutterSource(q, nb)
      const s = u(src) as any
      const b = bed(src) as any
      // Still-water level for the current sea level (same rule as setSeaLevel).
      const S = this.solver.seaLevel as any
      const rest = select(b.y.lessThanEqual(S), max(S, b.x), b.x)
      const h = max(s.x.sub(b.x), float(0)) as any
      const speed = select(h.greaterThan(0.01), vec3(s.y, s.z, s.w).length().div(max(h, 0.01)), float(0))
      return vec4(s.x.sub(rest), h, s.x, speed) as unknown as Node
    }, this.display)
    this.diagDisplay = this.exec.createField(3 * M, 2 * M)
    this.diagTexture = this.exec.texture(this.diagDisplay)
    this.updateDiag = this.solver.view(({ u, nb }, q) => u(gutterSource(q, nb)), this.diagDisplay, 'diag')
    this.updateDisplay()
    this.updateDiag()
  }

  /** η at rest for sea level S: ocean where F ≤ S (connected to the sea), else dry. */
  initialEta(S: number): Float32Array {
    const eta = new Float32Array(this.grid.cells)
    for (let c = 0; c < eta.length; c++) {
      const b = this.B[c]
      eta[c] = this.F[c] <= S ? Math.max(S, b) : b
    }
    return eta
  }

  /** Instant sea level (GPU): the ocean at rest at S. Cheap enough to animate every frame. */
  setSeaLevel(S: number) {
    this.seaLevel = S
    this.solver.setSeaLevel(S)
    this.debt = 0
    this.updateDisplay()
    this.updateDiag()
  }

  /** Nearest cell id to an ECEF direction (linear scan; called rarely). */
  cellAt(p: THREE.Vector3, wetOnly = false): number {
    const g = this.grid
    const d = p.clone().normalize()
    let best = -1
    let bd = -2
    for (let c = 0; c < g.cells; c++) {
      if (wetOnly && !(this.F[c] <= this.seaLevel && this.B[c] < this.seaLevel)) continue
      const v = g.center[c * 3] * d.x + g.center[c * 3 + 1] * d.y + g.center[c * 3 + 2] * d.z
      if (v > bd) {
        bd = v
        best = c
      }
    }
    return best
  }

  /** A random deep-ocean point (for the screensaver). */
  randomOceanPoint(minDepth = 2000): THREE.Vector3 {
    const g = this.grid
    for (let tries = 0; tries < 10_000; tries++) {
      const c = Math.floor(Math.random() * g.cells)
      if (this.F[c] <= this.seaLevel && this.B[c] < this.seaLevel - minDepth)
        return new THREE.Vector3(g.center[c * 3], g.center[c * 3 + 1], g.center[c * 3 + 2])
    }
    return new THREE.Vector3(1, 0, 0)
  }

  /** Calm sea: the ocean back at rest at the current sea level, diagnostics cleared. */
  calm() {
    this.setSeaLevel(this.seaLevel)
  }

  /**
   * Earthquake source: Okada seafloor uplift of the fault segments, added to the sea surface
   * (instantaneous rupture, long-wave approximation). Returns the peak uplift (m).
   */
  applyFault(segments: FaultSegment[]): { maxUp: number; maxDown: number } {
    const g = this.grid
    const delta = new Float32Array(g.cells)
    const rad = Math.PI / 180
    const centres = segments.map((s) => [Math.cos(s.lat * rad) * Math.cos(s.lon * rad), Math.cos(s.lat * rad) * Math.sin(s.lon * rad), Math.sin(s.lat * rad)])
    const near = Math.cos(15 * rad)
    let maxUp = 0
    let maxDown = 0
    for (let c = 0; c < g.cells; c++) {
      const x = g.center[c * 3], y = g.center[c * 3 + 1], z = g.center[c * 3 + 2]
      let uz = 0
      let hit = false
      for (let k = 0; k < segments.length; k++) {
        const p = centres[k]
        if (x * p[0] + y * p[1] + z * p[2] < near) continue
        hit = true
        uz += segmentUplift(segments[k], Math.asin(z) / rad, Math.atan2(y, x) / rad)
      }
      if (!hit) continue
      delta[c] = uz
      maxUp = Math.max(maxUp, uz)
      maxDown = Math.min(maxDown, uz)
    }
    this.solver.addEta(delta)
    // Snapshot after the uplift: arrivals are changes relative to the initial deformation.
    this.solver.clearDiagnostics()
    this.updateDisplay()
    this.updateDiag()
    return { maxUp, maxDown }
  }

  /** Drops a Gaussian wave (amplitude m, radius in cells) at an ECEF point. */
  drop(p: THREE.Vector3, amplitude = 20, radiusCells = 3) {
    const d = p.clone().normalize()
    console.log(`drop ${amplitude} m at ${d.toArray().map((v) => v.toFixed(3))}`)
    this.solver.addImpulse({ dir: [d.x, d.y, d.z], amplitude, sigma: (radiusCells * Math.PI) / 2 / this.N })
  }

  /** Advances by realSeconds × warp of simulated time, at most `maxSteps` solver steps. */
  advance(realSeconds: number, warp: number, maxSteps = 4): number {
    this.debt = Math.min(this.debt + realSeconds * warp, maxSteps * this.dt)
    const n = Math.floor(this.debt / this.dt)
    if (n > 0 || this.solverHasPending()) {
      this.solver.step(n)
      this.debt -= n * this.dt
      this.updateDisplay()
      if (++this.frame % 4 === 0) this.updateDiag()
    }
    return n
  }

  private solverHasPending() {
    return (this.solver as unknown as { pending: unknown[] }).pending.length > 0
  }
}
