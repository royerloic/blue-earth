import { describe, expect, it } from 'vitest'
import { okadaUz, segmentUplift } from '../../src/sim/okada'
import fixture from '../fixtures/okada-dc3d.json'

describe('Okada (1985) vertical surface displacement', () => {
  it('matches DC3D (okada_wrapper) on 200 random faults', () => {
    let worst = 0
    for (const c of fixture as { x: number; y: number; d: number; dip: number; L: number; W: number; U: number[]; uz: number }[]) {
      const uz = okadaUz(c.x, c.y, c.d, c.dip, c.L, c.W, c.U[0], c.U[1], c.U[2])
      worst = Math.max(worst, Math.abs(uz - c.uz) / (Math.abs(c.uz) + 1e-3 * Math.hypot(...c.U)))
    }
    expect(worst).toBeLessThan(1e-6)
  })

  it('a megathrust lifts the seafloor above the rupture and drops it landward', () => {
    // Trench-parallel thrust: strike 0° (north), dipping east 15°, top edge at 5 km.
    const seg = { lat: 0, lon: 0, top: 5e3, strike: 0, dip: 15, rake: 90, length: 300e3, width: 100e3, slip: 10 }
    const over = segmentUplift(seg, 0, 0.3) // above the shallow part, east of the trace
    const landward = segmentUplift(seg, 0, 1.4) // beyond the down-dip edge
    const far = segmentUplift(seg, 0, 5)
    expect(over).toBeGreaterThan(1)
    expect(landward).toBeLessThan(0)
    expect(Math.abs(far)).toBeLessThan(0.05)
  })
})
