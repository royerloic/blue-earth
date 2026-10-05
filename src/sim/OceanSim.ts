import * as THREE from 'three/webgpu'
import { float, max, vec4 } from 'three/tsl'
import type Node from 'three/src/nodes/core/Node.js'
import { NO_LAKE, type GlobeData } from '../core/assets/globeData'
import { EARTH_RADIUS } from '../core/geo/units'
import { ComputeExecutor } from './executor/ComputeExecutor'
import { RTTExecutor } from './executor/RTTExecutor'
import type { Executor, Field } from './executor/types'
import { buildCubeGrid, type CubeGrid } from './grid'
import { DEFAULT_PARAMS, stableDt } from './swe'
import { SWESolver } from './SWESolver'

/** Must match PROTECTED_LOWLAND_FLOOD in pipeline/blueearth_pipeline/dem.py. */
const PROTECTED_FLOOD = 2

/**
 * The world ocean: real bathymetry (the tier's sim.ktx2), the GPU solver, sea-level
 * initialisation, wave drops and time warp. `display` holds (η − η_rest, h, 0, 0) per cell
 * in the solver's 3×2 face atlas: the wave anomaly is what the renderer exaggerates.
 */
export class OceanSim {
  readonly grid: CubeGrid
  readonly solver: SWESolver
  readonly display: Field
  readonly displayTexture: THREE.Texture
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
    this.solver = new SWESolver(this.exec, this.grid, this.B, this.initialEta(seaLevel), DEFAULT_PARAMS)
    this.solver.dt.value = this.dt
    this.display = this.exec.createField(this.solver.width, this.solver.height)
    this.displayTexture = this.exec.texture(this.display)
    this.updateDisplay = this.solver.view(({ u, bed }, q) => {
      const s = u(q) as any
      const b = bed(q) as any
      return vec4(s.x.sub(b.y), max(s.x.sub(b.x), float(0)), 0, 1) as unknown as Node
    }, this.display)
    this.updateDisplay()
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

  setSeaLevel(S: number) {
    this.seaLevel = S
    this.solver.reset(this.initialEta(S))
    this.debt = 0
    this.updateDisplay()
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
    }
    return n
  }

  private solverHasPending() {
    return (this.solver as unknown as { pending: unknown[] }).pending.length > 0
  }
}
