import type * as THREE from 'three/webgpu'
import { loadGlobeData } from '../../src/core/assets/globeData'
import { OceanSim } from '../../src/sim/OceanSim'
import { PRESETS } from '../../src/sim/presets/historical'

/** Runs a preset headlessly and reports modelled arrival times at named coastal points. */
export async function runPresetSpike(renderer: THREE.WebGPURenderer, backend: string) {
  const q = new URLSearchParams(location.search)
  const preset = PRESETS.find((p) => p.id === (q.get('preset') ?? 'sumatra2004'))!
  const data = await loadGlobeData(renderer, q.get('tier') ?? 'medium')
  const sim = new OceanSim(renderer, backend, data, 0)
  const uplift = sim.applyFault(preset.segments!)
  const hours = Number(q.get('hours') ?? 9)
  const steps = Math.ceil((hours * 3600) / sim.dt)
  for (let s = 0; s < steps; s += 50) sim.solver.step(Math.min(50, steps - s))
  const diag = await sim.solver.readDiagnostics()
  const g = sim.grid
  const at = (lat: number, lon: number) => {
    // Nearest wet cell to the point (offshore gauge).
    const r = Math.PI / 180
    const d = [Math.cos(lat * r) * Math.cos(lon * r), Math.cos(lat * r) * Math.sin(lon * r), Math.sin(lat * r)]
    let best = -1
    let bd = -2
    for (let c = 0; c < g.cells; c++) {
      const v = g.center[c * 3] * d[0] + g.center[c * 3 + 1] * d[1] + g.center[c * 3 + 2] * d[2]
      if (v > bd && diag[sim.solver.texelOf(c) + 1] !== 0) {
        bd = v
        best = c
      }
    }
    const t = diag[sim.solver.texelOf(best) + 1]
    return { arrivalH: t < 0 ? null : +(t / 3600).toFixed(2), maxM: +diag[sim.solver.texelOf(best)].toFixed(2) }
  }
  const gauges: Record<string, [number, number]> = (
    {
      sumatra2004: { 'Sri Lanka (Batticaloa)': [7.7, 82.0], 'Phuket': [7.9, 98.2], 'Chennai': [13.1, 80.4], 'Maldives (Malé)': [4.2, 73.6], 'Somalia (Hafun)': [10.4, 51.6] },
      tohoku2011: { 'Hawaii (Honolulu)': [21.2, -157.9], 'Crescent City': [41.7, -124.3], 'Chile (Talcahuano)': [-36.6, -73.2] },
    } as Record<string, Record<string, [number, number]>>
  )[preset.id] ?? {}
  return { preset: preset.id, uplift, simHours: hours, gauges: Object.fromEntries(Object.entries(gauges).map(([k, [la, lo]]) => [k, at(la, lo)])) }
}
