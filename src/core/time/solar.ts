import * as THREE from 'three/webgpu'
import { getECIToECEFRotationMatrix, getMoonDirectionECI, getSunDirectionECI } from '@takram/three-atmosphere'

/** Sun and moon directions in ECEF plus the ECI→ECEF rotation (for the star field) at `date`. */
export function celestialAt(date: Date, out: { sun: THREE.Vector3; moon: THREE.Vector3; eciToEcef: THREE.Matrix4 }) {
  getECIToECEFRotationMatrix(date, out.eciToEcef)
  getSunDirectionECI(date, out.sun).applyMatrix4(out.eciToEcef)
  getMoonDirectionECI(date, out.moon).applyMatrix4(out.eciToEcef)
  return out
}

/**
 * Monthly albedo weights for the Jan/Apr/Jul/Oct Blue Marble months: linear blend between
 * the two months bracketing the day of year (mid-month centres), wrapping Oct → Jan.
 */
export function monthWeights(date: Date): [number, number, number, number] {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1)
  const day = (date.getTime() - start) / 86_400_000
  const centres = [15, 105, 196, 288]
  const w: [number, number, number, number] = [0, 0, 0, 0]
  for (let k = 0; k < 4; k++) {
    const a = centres[k]
    const b = k === 3 ? centres[0] + 365 : centres[k + 1]
    const d = day < centres[0] ? day + 365 : day
    if (d >= a && d < b) {
      const f = (d - a) / (b - a)
      w[k] = 1 - f
      w[(k + 1) % 4] = f
    }
  }
  return w
}
