import { abs, atan, clamp, dFdx, dFdy, float, floor, int, ivec2, log2, max, mix, mod, select, texture, textureLoad, vec2, vec3 } from 'three/tsl'
import type { Texture } from 'three/webgpu'
import type Node from 'three/src/nodes/core/Node.js'

/**
 * Equiangular cube (EAC) mapping, mirrored from pipeline/blueearth_pipeline/cube.py.
 * Faces use the OpenGL/KTX cube convention (+X, -X, +Y, -Y, +Z, -Z) applied directly to
 * ECEF directions (x: lon 0, y: lon 90°E, z: north). Face texel s grows along column, t along row.
 */

type V3 = readonly [number, number, number]
/** Per face: [major axis, axis of increasing s, axis of increasing t]. */
export const FACE_BASIS: readonly (readonly [V3, V3, V3])[] = [
  [[+1, 0, 0], [0, 0, -1], [0, -1, 0]],
  [[-1, 0, 0], [0, 0, +1], [0, -1, 0]],
  [[0, +1, 0], [+1, 0, 0], [0, 0, +1]],
  [[0, -1, 0], [+1, 0, 0], [0, 0, -1]],
  [[0, 0, +1], [+1, 0, 0], [0, -1, 0]],
  [[0, 0, -1], [-1, 0, 0], [0, -1, 0]],
]

/** CPU: ECEF unit direction -> face index and EAC coordinates s, t in [0, 1]. */
export function directionToFaceST(x: number, y: number, z: number): { face: number; s: number; t: number } {
  const ax = Math.abs(x)
  const ay = Math.abs(y)
  const az = Math.abs(z)
  const axis = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2
  const comp = [x, y, z][axis]
  const face = axis * 2 + (comp < 0 ? 1 : 0)
  const ma = Math.abs(comp)
  const [, sa, ta] = FACE_BASIS[face]
  const a = (x * sa[0] + y * sa[1] + z * sa[2]) / ma
  const b = (x * ta[0] + y * ta[1] + z * ta[2]) / ma
  return { face, s: ((Math.atan(a) * 4) / Math.PI + 1) / 2, t: ((Math.atan(b) * 4) / Math.PI + 1) / 2 }
}

/** CPU: face + EAC (s, t) -> ECEF unit direction. */
export function faceSTToDirection(face: number, s: number, t: number): [number, number, number] {
  const a = Math.tan(((2 * s - 1) * Math.PI) / 4)
  const b = Math.tan(((2 * t - 1) * Math.PI) / 4)
  const [m, sa, ta] = FACE_BASIS[face]
  const d = [0, 1, 2].map((k) => m[k] + a * sa[k] + b * ta[k])
  const n = Math.hypot(d[0], d[1], d[2])
  return [d[0] / n, d[1] / n, d[2] / n]
}

/**
 * TSL: direction to pass to a hardware cube lookup so that an EAC-encoded cube map is read
 * at direction `d`. Branch-free: on the major axis atan(±1)·4/π = ±1; the two minor
 * components go from gnomonic to equiangular. x is pre-negated to cancel three.js'
 * cube-texture x flip (CubeTextureNode.setupUV).
 */
export function eacCubeLookup(d: Node): Node {
  const dd = d as any
  const m = max(max(abs(dd.x), abs(dd.y)), abs(dd.z))
  const w = (atan as any)(dd.div(m)).mul(4 / Math.PI)
  return vec3(w.x.negate(), w.y, w.z) as unknown as Node
}

/** TSL: direction -> { face (float 0..5), st (vec2 in [0,1]) } for array/atlas sampling. */
export function eacFaceST(d: Node): { face: Node; st: Node } {
  const v = d as any
  const ax = abs(v.x)
  const ay = abs(v.y)
  const az = abs(v.z)
  const isX = ax.greaterThanEqual(ay).and(ax.greaterThanEqual(az))
  const isY = isX.not().and(ay.greaterThanEqual(az))
  const neg = (c: any) => select(c.lessThan(0), float(1), float(0))
  const face = select(isX, neg(v.x), select(isY, float(2).add(neg(v.y)), float(4).add(neg(v.z))))
  // sc/tc per the GL table, selected by face.
  const sc = select(
    isX,
    select(v.x.greaterThanEqual(0), v.z.negate(), v.z),
    select(isY, v.x, select(v.z.greaterThanEqual(0), v.x, v.x.negate())),
  )
  const tc = select(isY, select(v.y.greaterThanEqual(0), v.z, v.z.negate()), v.y.negate())
  const ma = max(max(ax, ay), az)
  const st = (vec2(atan(sc.div(ma)), atan(tc.div(ma))) as any).mul(2 / Math.PI).add(0.5)
  return { face: face as unknown as Node, st: st as unknown as Node }
}

/**
 * TSL: sample a 6-layer EAC face array (faces of n×n texels plus `gutter` texels per side)
 * at unit direction `d`. With `mipmapped`, the LOD comes from screen-space derivatives of
 * `d`, which are continuous across face seams (st derivatives are not, and would spike the
 * LOD into a visible seam line).
 */
export function sampleEACArray(tex: Texture, d: Node, n: number, gutter: number, mipmapped = true): Node {
  const { face, st } = eacFaceST(d)
  const uvp = (st as any).mul(n).add(gutter).div(n + 2 * gutter)
  let node = (texture(tex, uvp) as any).depth(face)
  if (mipmapped) {
    const dd = d as any
    const footprint = max((dFdx(dd) as any).length(), (dFdy(dd) as any).length())
    const lod = max(log2(footprint.div(Math.PI / 2 / n)), 0)
    node = node.level(lod)
  }
  return node as Node
}

/**
 * TSL: bilinear sample of a simulation display atlas (faces in a 3×2 layout, n×n cells each
 * plus `gutter` texels per side copied from the neighbouring faces) at unit direction d.
 * Uses textureLoad, so it works for unfilterable float32 textures and in vertex shaders.
 */
export function sampleFaceAtlas(tex: Texture, d: Node, n: number, gutter = 1): Node {
  const { face, st } = eacFaceST(d)
  const m = n + 2 * gutter
  const fx = mod(face as any, 3) as any
  const fy = floor((face as any).div(3)) as any
  const p = (st as any).mul(n).sub(0.5)
  const p0 = floor(p) as any
  const w = p.sub(p0)
  const ld = (ox: number, oy: number) => {
    const ix = clamp(p0.x.add(ox), -gutter, n - 1 + gutter) as any
    const iy = clamp(p0.y.add(oy), -gutter, n - 1 + gutter) as any
    return textureLoad(tex, ivec2(int(fx.mul(m).add(ix).add(gutter)), int(fy.mul(m).add(iy).add(gutter)))) as any
  }
  return mix(mix(ld(0, 0), ld(1, 0), w.x), mix(ld(0, 1), ld(1, 1), w.x), w.y) as unknown as Node
}
