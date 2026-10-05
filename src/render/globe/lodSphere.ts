import * as THREE from 'three/webgpu'
import { attribute } from 'three/tsl'
import type Node from 'three/src/nodes/core/Node.js'
import { faceSTDirection, faceSTToDirection } from '../../core/geo/cubeEAC'

const P = 32 // quads per patch side
const MAX_PATCHES = 6000

/**
 * Chunked-LOD cube-sphere: a quadtree over each EAC face whose leaves are instances of one
 * P×P grid patch. Patches split near the camera (down to `maxLevel`) and are dropped beyond
 * the horizon. A border ring of "skirt" vertices, pushed down radially, hides the cracks
 * between neighbouring levels.
 *
 * Vertex attributes (lodGrid, lodPatch; "patch" is a reserved word in WGSL) are read by
 * `LodSphere.nodes()` for the material.
 */
export class LodSphere {
  readonly mesh: THREE.InstancedMesh
  private readonly patch: THREE.InstancedBufferAttribute
  count = 0

  constructor(
    material: THREE.Material,
    private readonly minLevel = 3,
    public maxLevel = 6,
    /** Split when the camera is closer than splitFactor × patch width. */
    private readonly splitFactor = 3,
  ) {
    const geometry = patchGeometry()
    this.patch = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PATCHES * 4), 4)
    this.patch.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('lodPatch', this.patch)
    this.mesh = new THREE.InstancedMesh(geometry, material, MAX_PATCHES)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
  }

  /** TSL accessors for the material's vertex stage. */
  static nodes(): { dir: Node; skirt: Node; patchSize: Node } {
    const uvs = attribute('lodGrid', 'vec3') as any
    const pa = attribute('lodPatch', 'vec4') as any
    const s = pa.y.add(uvs.x.mul(pa.w))
    const t = pa.z.add(uvs.y.mul(pa.w))
    return { dir: faceSTDirection(pa.x, s, t), skirt: uvs.z as Node, patchSize: pa.w as Node }
  }

  /** Re-selects patches for the camera (ECEF, metres) and radius R. */
  update(camera: THREE.Camera, R: number) {
    const cam = camera.position
    const D = cam.length()
    const camDir = cam.clone().divideScalar(D)
    const horizon = Math.acos(Math.min(1, R / D))
    const arr = this.patch.array as Float32Array
    let n = 0
    const visit = (face: number, s0: number, t0: number, size: number, level: number) => {
      const c = faceSTToDirection(face, s0 + size / 2, t0 + size / 2)
      const ang = Math.acos(Math.max(-1, Math.min(1, c[0] * camDir.x + c[1] * camDir.y + c[2] * camDir.z)))
      const rho = (Math.PI / 2) * size * 0.75 // angular radius of the patch
      if (ang > horizon + rho + 0.05) return // behind the horizon
      const width = R * (Math.PI / 2) * size
      const dist = Math.hypot(c[0] * R - cam.x, c[1] * R - cam.y, c[2] * R - cam.z)
      const split = level < this.minLevel || (level < this.maxLevel && dist < this.splitFactor * width)
      if (split && n < MAX_PATCHES - 4) {
        const h = size / 2
        visit(face, s0, t0, h, level + 1)
        visit(face, s0 + h, t0, h, level + 1)
        visit(face, s0, t0 + h, h, level + 1)
        visit(face, s0 + h, t0 + h, h, level + 1)
      } else if (n < MAX_PATCHES) {
        arr.set([face, s0, t0, size], n * 4)
        n++
      }
    }
    for (let f = 0; f < 6; f++) visit(f, 0, 0, 1, 0)
    this.count = n
    this.mesh.count = n
    this.patch.clearUpdateRanges()
    this.patch.addUpdateRange(0, n * 4)
    this.patch.needsUpdate = true
  }
}

/** (P+3)² vertices: the patch grid plus a skirt ring (flag z = 1) at the clamped edge coords. */
function patchGeometry(): THREE.BufferGeometry {
  const V = P + 3
  const grid = new Float32Array(V * V * 3)
  for (let j = 0; j < V; j++)
    for (let i = 0; i < V; i++) {
      const gi = i - 1
      const gj = j - 1
      const skirt = gi < 0 || gi > P || gj < 0 || gj > P ? 1 : 0
      grid.set([Math.min(P, Math.max(0, gi)) / P, Math.min(P, Math.max(0, gj)) / P, skirt], (j * V + i) * 3)
    }
  const idx: number[] = []
  for (let j = 0; j < V - 1; j++)
    for (let i = 0; i < V - 1; i++) {
      const a = j * V + i
      // Outward for every face: all GL cube faces have s × t = −major axis.
      idx.push(a, a + V, a + 1, a + 1, a + V, a + V + 1)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('lodGrid', new THREE.BufferAttribute(grid, 3))
  // A dummy position attribute (three requires one); the material computes positions.
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(V * V * 3), 3))
  g.setIndex(idx)
  return g
}
