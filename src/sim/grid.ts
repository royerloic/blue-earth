import { directionToFaceST, FACE_BASIS, faceSTToDirection } from '../core/geo/cubeEAC'

/**
 * Finite-volume grid on the equiangular cube: 6·N² quadrilateral cells.
 *
 * Cell id = face·N² + j·N + i (i along s, j along t). Edge/neighbour order k:
 * 0 = +s, 1 = −s, 2 = +t, 3 = −t. `back[c·4+k]` is the direction index in neighbour
 * nb[c·4+k] that points back to c (differs from the opposite of k across face seams).
 * Geometry is computed in float64 on the unit sphere; lenOverArea is per metre for radius R.
 */
export interface CubeGrid {
  N: number
  cells: number
  /** Unit cell-centre directions (EAC texel centres), 3 per cell. */
  center: Float64Array
  /** Solid angle (sr) per cell. */
  solidAngle: Float64Array
  nb: Int32Array
  back: Uint8Array
  /** Outward unit edge normals (tangent at the edge midpoint), 3 per edge, 4 edges per cell. */
  normal: Float64Array
  /** Edge length / cell area (1/m) for radius R. */
  lenOverArea: Float64Array
  /** Edge length (m) for radius R. */
  edgeLength: Float64Array
}

export const OPPOSITE = [1, 0, 3, 2] as const

export function buildCubeGrid(N: number, R: number): CubeGrid {
  const cells = 6 * N * N
  const center = new Float64Array(cells * 3)
  const solidAngle = new Float64Array(cells)
  const nb = new Int32Array(cells * 4)
  const back = new Uint8Array(cells * 4)
  const normal = new Float64Array(cells * 12)
  const lenOverArea = new Float64Array(cells * 4)
  const edgeLength = new Float64Array(cells * 4)

  // Corner directions per face, (N+1)² each.
  const V = N + 1
  const corners = new Float64Array(6 * V * V * 3)
  for (let f = 0; f < 6; f++)
    for (let j = 0; j <= N; j++)
      for (let i = 0; i <= N; i++) corners.set(faceSTToDirection(f, i / N, j / N), ((f * V + j) * V + i) * 3)
  const corner = (f: number, i: number, j: number) => ((f * V + j) * V + i) * 3

  const id = (f: number, i: number, j: number) => f * N * N + j * N + i
  const dirs: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
  for (let f = 0; f < 6; f++) {
    const [major, sa, ta] = FACE_BASIS[f]
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const c = id(f, i, j)
        center.set(faceSTToDirection(f, (i + 0.5) / N, (j + 0.5) / N), c * 3)
        for (let k = 0; k < 4; k++) {
          const ni = i + dirs[k][0]
          const nj = j + dirs[k][1]
          if (ni >= 0 && ni < N && nj >= 0 && nj < N) nb[c * 4 + k] = id(f, ni, nj)
          else {
            // Step one texel past the edge in EAC coordinates and map back onto the cube.
            const a = Math.tan(((2 * (ni + 0.5)) / N - 1) * (Math.PI / 4))
            const b = Math.tan(((2 * (nj + 0.5)) / N - 1) * (Math.PI / 4))
            const d = [0, 1, 2].map((q) => major[q] + a * sa[q] + b * ta[q])
            const r = directionToFaceST(d[0], d[1], d[2])
            const i2 = Math.min(N - 1, Math.max(0, Math.floor(r.s * N)))
            const j2 = Math.min(N - 1, Math.max(0, Math.floor(r.t * N)))
            nb[c * 4 + k] = id(r.face, i2, j2)
          }
        }
        // Solid angle: two spherical triangles (Van Oosterom & Strackee).
        const p00 = corner(f, i, j)
        const p10 = corner(f, i + 1, j)
        const p01 = corner(f, i, j + 1)
        const p11 = corner(f, i + 1, j + 1)
        solidAngle[c] = triangle(corners, p00, p10, p11) + triangle(corners, p00, p11, p01)
        // Edges (corner pairs) in k order.
        const edges = [
          [p10, p11],
          [p00, p01],
          [p01, p11],
          [p00, p10],
        ]
        for (let k = 0; k < 4; k++) {
          const [pa, pb] = edges[k]
          const ax = corners[pa], ay = corners[pa + 1], az = corners[pa + 2]
          const bx = corners[pb], by = corners[pb + 1], bz = corners[pb + 2]
          let nx = ay * bz - az * by
          let ny = az * bx - ax * bz
          let nz = ax * by - ay * bx
          const cr = Math.hypot(nx, ny, nz)
          const angle = Math.atan2(cr, ax * bx + ay * by + az * bz)
          nx /= cr
          ny /= cr
          nz /= cr
          // Orient outward: away from this cell's centre.
          const cx = center[c * 3], cy = center[c * 3 + 1], cz = center[c * 3 + 2]
          if (nx * cx + ny * cy + nz * cz > 0) {
            nx = -nx
            ny = -ny
            nz = -nz
          }
          normal.set([nx, ny, nz], (c * 4 + k) * 3)
          edgeLength[c * 4 + k] = angle * R
        }
      }
  }
  for (let c = 0; c < cells; c++) {
    for (let k = 0; k < 4; k++) {
      const o = nb[c * 4 + k]
      let m = 0
      while (m < 4 && nb[o * 4 + m] !== c) m++
      if (m === 4) throw new Error(`cube grid: neighbour ${o} of ${c} does not link back`)
      back[c * 4 + k] = m
      lenOverArea[c * 4 + k] = edgeLength[c * 4 + k] / (solidAngle[c] * R * R)
    }
  }
  return { N, cells, center, solidAngle, nb, back, normal, lenOverArea, edgeLength }
}

function triangle(p: Float64Array, a: number, b: number, c: number): number {
  const ax = p[a], ay = p[a + 1], az = p[a + 2]
  const bx = p[b], by = p[b + 1], bz = p[b + 2]
  const cx = p[c], cy = p[c + 1], cz = p[c + 2]
  const triple = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
  const den = 1 + (ax * bx + ay * by + az * bz) + (bx * cx + by * cy + bz * cz) + (cx * ax + cy * ay + cz * az)
  return 2 * Math.atan2(Math.abs(triple), den)
}
