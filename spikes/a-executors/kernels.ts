import { clamp, exp, float, ivec2, vec4 } from 'three/tsl'
import type Node from 'three/src/nodes/core/Node.js'
import type { Kernel } from '../../src/sim/executor/types'

// Spike kernels: a damped float wave equation in the classic ripple form.
// State texel = (h, hPrev, 0, 0). Initial condition is analytic so CPU and GPU agree exactly.

export const DAMP = 0.999

/** Analytic, deliberately asymmetric initial field (detects any axis flip/transpose). */
export function initValue(x: number, y: number, w: number, h: number): number {
  const dx = x - 0.3 * w
  const dy = y - 0.62 * h
  return Math.exp(-(dx * dx + dy * dy) / 40) + (0.1 * x) / w
}

export function initKernel(w: number, h: number): Kernel<never> {
  return (_in, p) => {
    const fx = float((p as any).x)
    const fy = float((p as any).y)
    const dx = fx.sub(0.3 * w)
    const dy = fy.sub(0.62 * h)
    const v = exp(dx.mul(dx).add(dy.mul(dy)).div(-40)).add(fx.mul(0.1 / w))
    return vec4(v, v, 0, 0) as unknown as Node
  }
}

export function stepKernel(w: number, h: number): Kernel<'src'> {
  return ({ src }, p) => {
    const max = ivec2(w - 1, h - 1)
    const at = (ox: number, oy: number) =>
      src((clamp as any)((p as any).add(ivec2(ox, oy)), ivec2(0, 0), max) as Node) as any
    const c = src(p) as any
    const sum = at(1, 0).x.add(at(-1, 0).x).add(at(0, 1).x).add(at(0, -1).x)
    const next = sum.mul(0.5).sub(c.y).mul(DAMP)
    return vec4(next, c.x, 0, 0) as unknown as Node
  }
}

/** Float32 CPU reference of the same scheme. Returns h after `steps`. */
export function cpuReference(w: number, h: number, steps: number): Float32Array {
  let cur = new Float32Array(w * h)
  let prev = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cur[y * w + x] = prev[y * w + x] = initValue(x, y, w, h)
  const cx = (x: number) => Math.min(Math.max(x, 0), w - 1)
  const cy = (y: number) => Math.min(Math.max(y, 0), h - 1)
  for (let s = 0; s < steps; s++) {
    const next = new Float32Array(w * h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const sum = cur[y * w + cx(x + 1)] + cur[y * w + cx(x - 1)] + cur[cy(y + 1) * w + x] + cur[cy(y - 1) * w + x]
        next[y * w + x] = (sum * 0.5 - prev[y * w + x]) * DAMP
      }
    prev = cur
    cur = next
  }
  return cur
}
