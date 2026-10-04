import * as THREE from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { celestialAt, monthWeights } from '../../src/core/time/solar'

describe('solar', () => {
  it('puts the subsolar point near lon 0 at 12:00 UTC on the March equinox', () => {
    const c = celestialAt(new Date('2026-03-20T12:07:00Z'), { sun: new THREE.Vector3(), moon: new THREE.Vector3(), eciToEcef: new THREE.Matrix4() })
    const lat = (Math.asin(c.sun.z) * 180) / Math.PI
    const lon = (Math.atan2(c.sun.y, c.sun.x) * 180) / Math.PI
    expect(Math.abs(lat)).toBeLessThan(0.5)
    expect(Math.abs(lon)).toBeLessThan(1.5) // equation of time ≈ −7 min on Mar 20
  })
  it('puts the subsolar latitude at +23.4° on the June solstice', () => {
    const c = celestialAt(new Date('2026-06-21T12:00:00Z'), { sun: new THREE.Vector3(), moon: new THREE.Vector3(), eciToEcef: new THREE.Matrix4() })
    expect((Math.asin(c.sun.z) * 180) / Math.PI).toBeCloseTo(23.44, 0)
  })
  it('blends monthly albedo weights', () => {
    // Jan 16 00:00 is day-of-year 15 (0-based), the January albedo centre.
    expect(monthWeights(new Date('2026-01-16T00:00:00Z'))).toEqual([1, 0, 0, 0])
    const w = monthWeights(new Date('2026-12-01T00:00:00Z')) // between Oct (288) and Jan (15+365)
    expect(w[0] + w[3]).toBeCloseTo(1)
    expect(w[1] + w[2]).toBe(0)
  })
})
