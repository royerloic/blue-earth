import { describe, expect, it } from 'vitest'
import { buildCubeGrid } from '../../src/sim/grid'

describe('cube FV grid', () => {
  const g = buildCubeGrid(12, 1)
  it('covers the sphere', () => {
    expect(Math.abs(g.solidAngle.reduce((a, b) => a + b, 0) - 4 * Math.PI)).toBeLessThan(1e-12)
  })
  it('has mutual neighbours, shared edges and opposite normals', () => {
    for (let c = 0; c < g.cells; c++)
      for (let k = 0; k < 4; k++) {
        const o = g.nb[c * 4 + k]
        const m = g.back[c * 4 + k]
        expect(g.nb[o * 4 + m]).toBe(c)
        expect(Math.abs(g.edgeLength[c * 4 + k] - g.edgeLength[o * 4 + m])).toBeLessThan(1e-12)
        for (let q = 0; q < 3; q++)
          expect(Math.abs(g.normal[(c * 4 + k) * 3 + q] + g.normal[(o * 4 + m) * 3 + q])).toBeLessThan(1e-12)
      }
  })
  it('closes each cell: Σ ℓ·n is purely radial-ish (small tangential residual)', () => {
    let worst = 0
    for (let c = 0; c < g.cells; c++) {
      const s = [0, 0, 0]
      for (let k = 0; k < 4; k++) for (let q = 0; q < 3; q++) s[q] += g.edgeLength[c * 4 + k] * g.normal[(c * 4 + k) * 3 + q]
      const cx = g.center.subarray(c * 3, c * 3 + 3)
      const radial = s[0] * cx[0] + s[1] * cx[1] + s[2] * cx[2]
      const tang = Math.hypot(s[0] - radial * cx[0], s[1] - radial * cx[1], s[2] - radial * cx[2])
      worst = Math.max(worst, tang / g.edgeLength[c * 4])
    }
    expect(worst).toBeLessThan(0.05)
  })
})
