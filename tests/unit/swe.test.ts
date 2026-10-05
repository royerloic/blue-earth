import { describe, expect, it } from 'vitest'
import { buildCubeGrid, type CubeGrid } from '../../src/sim/grid'
import { CpuSWE, DEFAULT_PARAMS, stableDt } from '../../src/sim/swe'

const R = 6_371_000
const noFriction = { ...DEFAULT_PARAMS, manning: 0, coriolis: false }

function rng(seed: number) {
  let s = seed
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

function nearestCell(g: CubeGrid, d: number[]): number {
  let best = 0
  let bd = -2
  for (let c = 0; c < g.cells; c++) {
    const v = g.center[c * 3] * d[0] + g.center[c * 3 + 1] * d[1] + g.center[c * 3 + 2] * d[2]
    if (v > bd) {
      bd = v
      best = c
    }
  }
  return best
}

describe('shallow water (float64 reference)', () => {
  it('keeps a lake at rest still, with random bathymetry and dry islands (η = +50 m)', () => {
    const g = buildCubeGrid(16, R)
    const r = rng(7)
    const B = new Float64Array(g.cells).map(() => (r() < 0.1 ? 60 + 400 * r() : -100 - 4900 * r()))
    const swe = new CpuSWE(g, B, DEFAULT_PARAMS)
    for (let c = 0; c < g.cells; c++) swe.eta[c] = Math.max(50, B[c])
    const eta0 = Float64Array.from(swe.eta)
    const dt = stableDt(g, 5000)
    for (let s = 0; s < 100; s++) swe.step(dt)
    let maxDeta = 0
    let maxM = 0
    for (let c = 0; c < g.cells; c++) {
      maxDeta = Math.max(maxDeta, Math.abs(swe.eta[c] - eta0[c]))
      maxM = Math.max(maxM, Math.hypot(swe.m[c * 3], swe.m[c * 3 + 1], swe.m[c * 3 + 2]))
    }
    expect(maxDeta).toBeLessThan(1e-9)
    expect(maxM).toBeLessThan(1e-8)
  })

  it('conserves water volume to 1e-12', () => {
    const g = buildCubeGrid(16, R)
    const B = new Float64Array(g.cells).fill(-4000)
    const swe = new CpuSWE(g, B, DEFAULT_PARAMS)
    const r = rng(3)
    for (let c = 0; c < g.cells; c++) swe.eta[c] = 10 * (r() - 0.5) * (r() - 0.5)
    const v0 = swe.volume(R)
    const dt = stableDt(g, 4000)
    for (let s = 0; s < 200; s++) swe.step(dt)
    expect(Math.abs(swe.volume(R) / v0 - 1)).toBeLessThan(1e-12)
  })

  /** Speed between two gauges on a great circle from `src` toward `dir`, flat 4000 m bed. */
  function measuredSpeed(N: number, src: number[], dir: number[]) {
    const g = buildCubeGrid(N, R)
    const B = new Float64Array(g.cells).fill(-4000)
    const swe = new CpuSWE(g, B, noFriction)
    const sigma = 500e3 / R
    for (let c = 0; c < g.cells; c++) {
      const cosA = g.center[c * 3] * src[0] + g.center[c * 3 + 1] * src[1] + g.center[c * 3 + 2] * src[2]
      const a = Math.acos(Math.min(1, cosA))
      swe.eta[c] = Math.exp(-((a / sigma) ** 2))
    }
    const at = (theta: number) => src.map((s, q) => s * Math.cos(theta) + dir[q] * Math.sin(theta))
    const d1 = 2000e3
    const d2 = 4500e3
    const g1 = nearestCell(g, at(d1 / R))
    const g2 = nearestCell(g, at(d2 / R))
    // Actual great-circle distances of the gauge cell centres from the source.
    const dist = (c: number) => R * Math.acos(g.center[c * 3] * src[0] + g.center[c * 3 + 1] * src[1] + g.center[c * 3 + 2] * src[2])
    const dt = stableDt(g, 4000)
    const series: [number[], number[]] = [[], []]
    for (let s = 0; s < Math.ceil(9 * 3600 / dt); s++) {
      swe.step(dt)
      series[0].push(swe.eta[g1])
      series[1].push(swe.eta[g2])
    }
    const peak = (y: number[]) => {
      let i = 1
      for (let k = 1; k < y.length - 1; k++) if (y[k] > y[i]) i = k
      const off = (0.5 * (y[i - 1] - y[i + 1])) / (y[i - 1] - 2 * y[i] + y[i + 1]) // parabolic refinement
      return (i + 1 + off) * dt
    }
    return (dist(g2) - dist(g1)) / (peak(series[1]) - peak(series[0]))
  }

  const c0 = Math.sqrt(9.81 * 4000)
  it('propagates at √(gh) along a face axis (±3%)', () => {
    const v = measuredSpeed(48, [1, 0, 0], [0, 1, 0])
    console.log(`wave speed (axis): ${v.toFixed(1)} m/s vs √(gh) = ${c0.toFixed(1)}`)
    expect(Math.abs(v / c0 - 1)).toBeLessThan(0.03)
  })
  it('is isotropic: diagonal and from a cube corner (±3%)', () => {
    const diag = measuredSpeed(48, [1, 0, 0], [0, Math.SQRT1_2, Math.SQRT1_2])
    const k = 1 / Math.sqrt(3)
    const corner = measuredSpeed(48, [k, k, k], [Math.SQRT1_2, -Math.SQRT1_2, 0])
    console.log(`wave speed (diagonal / corner): ${diag.toFixed(1)} / ${corner.toFixed(1)} m/s`)
    expect(Math.abs(diag / c0 - 1)).toBeLessThan(0.03)
    expect(Math.abs(corner / c0 - 1)).toBeLessThan(0.03)
  })

  it('survives a strong wave over islands and beaches: finite, h ≥ 0, volume kept', () => {
    const g = buildCubeGrid(24, R)
    const r = rng(11)
    // Smooth random relief from -3000 m to +800 m: many coastlines, shallows and islands.
    const B = new Float64Array(g.cells)
    for (let c = 0; c < g.cells; c++) {
      const x = g.center[c * 3], y = g.center[c * 3 + 1], z = g.center[c * 3 + 2]
      B[c] = -1100 + 1900 * Math.sin(5 * x + 1) * Math.cos(4 * y - 0.5) * Math.sin(3 * z + 2) + 50 * (r() - 0.5)
    }
    const swe = new CpuSWE(g, B, DEFAULT_PARAMS)
    for (let c = 0; c < g.cells; c++) {
      const a = Math.acos(Math.min(1, g.center[c * 3]))
      swe.eta[c] = Math.max(B[c], 30 * Math.exp(-((a / 0.08) ** 2)))
    }
    const v0 = swe.volume(R)
    const dt = stableDt(g, 3000)
    for (let s = 0; s < 300; s++) swe.step(dt)
    for (let c = 0; c < g.cells; c++) {
      expect(Number.isFinite(swe.eta[c])).toBe(true)
      expect(swe.eta[c] - B[c]).toBeGreaterThanOrEqual(0)
    }
    expect(Math.abs(swe.volume(R) / v0 - 1)).toBeLessThan(1e-6)
  })
})
