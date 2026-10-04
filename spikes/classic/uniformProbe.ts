import type * as THREE from 'three/webgpu'
import { uniform, vec4 } from 'three/tsl'
import { RTTExecutor } from '../../src/sim/executor/RTTExecutor'

/** Does a uniform change between two passes reach the second pass? */
export async function probeUniforms(renderer: THREE.WebGPURenderer) {
  const ex = new RTTExecutor(renderer)
  const f = ex.createField(4, 4)
  const u = uniform(1)
  const run = ex.pass(() => vec4(u, 0, 0, 1) as never, {}, f)
  const seen: number[] = []
  for (const v of [10, 20, 30]) {
    u.value = v
    run()
    seen.push((await ex.read(f))[0])
  }
  u.value = 40
  run()
  u.value = 50
  run()
  seen.push((await ex.read(f))[0])
  // Shared uniform across two passes (like ClassicGPU's step + shade).
  const g = ex.createField(4, 4)
  const runB = ex.pass(() => vec4(u.mul(2), 0, 0, 1) as never, {}, g)
  const shared: number[] = []
  for (const v of [60, 70, 80]) {
    u.value = v
    run()
    runB()
    shared.push((await ex.read(f))[0], (await ex.read(g))[0])
  }
  return { expected: [10, 20, 30, 50], seen, sharedExpected: [60, 120, 70, 140, 80, 160], shared }
}
