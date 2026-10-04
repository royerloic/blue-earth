import { describe, expect, it } from 'vitest'
import { directionToFaceST, faceSTToDirection } from '../../src/core/geo/cubeEAC'

describe('cubeEAC', () => {
  it('round-trips face/s/t <-> direction', () => {
    for (let face = 0; face < 6; face++)
      for (let i = 0; i < 17; i++)
        for (let j = 0; j < 17; j++) {
          const s = (i + 0.5) / 17
          const t = (j + 0.5) / 17
          const r = directionToFaceST(...faceSTToDirection(face, s, t))
          expect(r.face).toBe(face)
          expect(Math.abs(r.s - s)).toBeLessThan(1e-12)
          expect(Math.abs(r.t - t)).toBeLessThan(1e-12)
        }
  })
  it('puts the poles and lon 0 on the expected faces', () => {
    expect(directionToFaceST(0, 0, 1).face).toBe(4) // north pole: +Z
    expect(directionToFaceST(1, 0, 0).face).toBe(0) // lon 0, lat 0: +X
    expect(directionToFaceST(0, 1, 0).face).toBe(2) // lon 90E: +Y
  })
})

import fixture from '../fixtures/eac-python.json'

describe('cubeEAC matches the Python pipeline', () => {
  it('agrees on 200 random directions', () => {
    for (const { d, face, s, t } of fixture as { d: [number, number, number]; face: number; s: number; t: number }[]) {
      const r = directionToFaceST(...d)
      expect(r.face).toBe(face)
      expect(Math.abs(r.s - s)).toBeLessThan(1e-12)
      expect(Math.abs(r.t - t)).toBeLessThan(1e-12)
    }
  })
})
