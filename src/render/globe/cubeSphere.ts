import * as THREE from 'three/webgpu'
import { faceSTToDirection } from '../../core/geo/cubeEAC'

/**
 * Unit cube-sphere with vertices on the EAC grid (res × res quads per face), so vertex
 * spacing matches the face textures and nothing pinches at the poles. Positions are unit
 * ECEF directions; the material displaces them radially.
 */
export function createCubeSphere(res: number): THREE.BufferGeometry {
  const v = res + 1
  const positions = new Float32Array(6 * v * v * 3)
  const indices = new Uint32Array(6 * res * res * 6)
  let p = 0
  let q = 0
  for (let face = 0; face < 6; face++) {
    const base = face * v * v
    for (let j = 0; j < v; j++)
      for (let i = 0; i < v; i++) {
        const d = faceSTToDirection(face, i / res, j / res)
        positions[p++] = d[0]
        positions[p++] = d[1]
        positions[p++] = d[2]
      }
    for (let j = 0; j < res; j++)
      for (let i = 0; i < res; i++) {
        const a = base + j * v + i
        const b = a + 1
        const c = a + v
        const d = c + 1
        // Winding chosen so faces point outward for every cube face (checked via cross product).
        indices.set([a, c, b, b, c, d], q)
        q += 6
      }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  g.setIndex(new THREE.BufferAttribute(indices, 1))
  fixWinding(g)
  g.computeBoundingSphere()
  return g
}

/** Flips any triangle whose normal points inward (face bases differ in handedness). */
function fixWinding(g: THREE.BufferGeometry) {
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const idx = g.getIndex()!.array as Uint32Array
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  for (let t = 0; t < idx.length; t += 3) {
    a.fromBufferAttribute(pos, idx[t])
    b.fromBufferAttribute(pos, idx[t + 1])
    c.fromBufferAttribute(pos, idx[t + 2])
    const n = b.clone().sub(a).cross(c.clone().sub(a))
    if (n.dot(a) < 0) {
      const tmp = idx[t + 1]
      idx[t + 1] = idx[t + 2]
      idx[t + 2] = tmp
    }
  }
}
