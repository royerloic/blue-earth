import type * as THREE from 'three/webgpu'
import { loadGlobeData } from '../../src/core/assets/globeData'
import { OceanSim } from '../../src/sim/OceanSim'

/** Real-bathymetry rest test: no drops; where does |η − η_rest| grow? */
export async function runRestSpike(renderer: THREE.WebGPURenderer, backend: string) {
  const data = await loadGlobeData(renderer, new URLSearchParams(location.search).get('tier') ?? 'low')
  const sim = new OceanSim(renderer, backend, data, 0)
  const eta0 = sim.initialEta(0)
  const steps = Number(new URLSearchParams(location.search).get('steps') ?? 20)
  sim.solver.step(steps)
  const st = await sim.solver.readState()
  const worst: { c: number; de: number; m: number; B: number; eta0: number }[] = []
  let maxDe = 0
  let maxM = 0
  for (let c = 0; c < sim.grid.cells; c++) {
    const t = sim.solver.texelOf(c)
    const de = Math.abs(st[t] - eta0[c])
    const m = Math.hypot(st[t + 1], st[t + 2], st[t + 3])
    maxDe = Math.max(maxDe, de)
    maxM = Math.max(maxM, m)
    if (de > 1e-3) worst.push({ c, de, m, B: (sim as any).B[c], eta0: eta0[c] })
  }
  worst.sort((a, b) => b.de - a.de)
  const nb = (c: number) => Array.from(sim.grid.nb.subarray(c * 4, c * 4 + 4)).map((o) => [+(sim as any).B[o].toFixed(1), +eta0[o].toFixed(2)])
  return { steps, maxDe, maxM, count: worst.length, top: worst.slice(0, 4).map((w) => ({ ...w, nb: nb(w.c) })) }
}
