import * as THREE from 'three/webgpu'
import { loadGlobeData } from '../../src/core/assets/globeData'
import { OceanSim } from '../../src/sim/OceanSim'
import { PRESETS } from '../../src/sim/presets/historical'

/**
 * Long-run robustness on real bathymetry: at S = −120, 0, +70 m, repeated large drops (incl. near
 * coasts) and earthquake sources, thousands of steps. Checks finiteness, h ≥ 0, speed bound and
 * volume conservation over pure stepping intervals.
 */
export async function runStressSpike(renderer: THREE.WebGPURenderer, backend: string) {
  const q = new URLSearchParams(location.search)
  const data = await loadGlobeData(renderer, q.get('tier') ?? 'medium')
  const sim = new OceanSim(renderer, backend, data, 0)
  const g = sim.grid
  const B = (sim as any).B as Float32Array
  const steps = Number(q.get('steps') ?? 1500)
  const R = 6_371_000
  const scan = async () => {
    const st = await sim.solver.readState()
    let nan = 0, neg = 0, vmax = 0, vol = 0
    for (let c = 0; c < g.cells; c++) {
      const t = sim.solver.texelOf(c)
      const eta = st[t], h = eta - B[c]
      const sp = Math.hypot(st[t + 1], st[t + 2], st[t + 3])
      if (!Number.isFinite(eta) || !Number.isFinite(sp)) nan++
      if (h < -1e-3) neg++
      if (h > 0.01) vmax = Math.max(vmax, sp / h)
      vol += Math.max(0, h) * g.solidAngle[c] * R * R
    }
    return { nan, neg, vmax, vol }
  }
  const out: Record<string, unknown>[] = []
  let rng = 12345
  const rand = () => ((rng = (rng * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  for (const S of [-120, 0, 70]) {
    sim.setSeaLevel(S)
    for (let k = 0; k < 24; k++) {
      // Random wet points; every other one forced near a coast (shallow < 200 m).
      let c = 0
      for (let tries = 0; tries < 20000; tries++) {
        c = Math.floor(rand() * g.cells)
        const depth = S - B[c]
        if (depth > 1 && (k % 2 === 0 || depth < 200)) break
      }
      const d = new THREE.Vector3(g.center[c * 3], g.center[c * 3 + 1], g.center[c * 3 + 2])
      sim.drop(d, 100, 3 + (k % 4))
    }
    for (const id of ['tohoku2011', 'sumatra2004']) sim.applyFault(PRESETS.find((p) => p.id === id)!.segments!)
    sim.solver.step(1)
    const a = await scan()
    for (let s = 0; s < steps; s += 100) sim.solver.step(Math.min(100, steps - s))
    const b = await scan()
    out.push({
      S,
      simDays: +((steps * sim.dt) / 86400).toFixed(1),
      nan: b.nan,
      negDepthCells: b.neg,
      maxSpeed: +b.vmax.toFixed(1),
      volumeDriftRel: +((b.vol - a.vol) / a.vol).toExponential(2),
    })
  }
  return out
}
