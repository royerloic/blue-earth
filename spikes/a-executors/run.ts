import type * as THREE from 'three/webgpu'
import { ComputeExecutor } from '../../src/sim/executor/ComputeExecutor'
import { RTTExecutor } from '../../src/sim/executor/RTTExecutor'
import type { Executor } from '../../src/sim/executor/types'
import { cpuReference, initKernel, stepKernel } from './kernels'

export interface ExecResult {
  executor: string
  maxAbsErr: number
  msPerStep: number
  ok: boolean
}

/** Runs `steps` ping-pong steps, returns the final buffer and wall time per step. */
async function runOn(exec: Executor, w: number, h: number, steps: number) {
  const a = exec.createField(w, h)
  const b = exec.createField(w, h)
  exec.pass(initKernel(w, h), {}, a)()
  const ab = exec.pass(stepKernel(w, h), { src: a }, b)
  const ba = exec.pass(stepKernel(w, h), { src: b }, a)
  // Warm up compilation with a single extra round trip on throwaway fields.
  await exec.read(a)
  exec.pass(initKernel(w, h), {}, a)()
  const t0 = performance.now()
  for (let s = 0; s < steps; s++) (s % 2 === 0 ? ab : ba)()
  const out = await exec.read(steps % 2 === 0 ? a : b)
  return { out, ms: (performance.now() - t0) / steps }
}

export async function runExecutorSpike(renderer: THREE.WebGPURenderer, backend: string): Promise<ExecResult[]> {
  const results: ExecResult[] = []
  const execs: Executor[] = [new RTTExecutor(renderer)]
  if (backend === 'webgpu') execs.unshift(new ComputeExecutor(renderer))

  // Correctness: small grid vs CPU reference.
  const W = 96
  const H = 64
  const STEPS = 200
  const ref = cpuReference(W, H, STEPS)
  for (const exec of execs) {
    const { out } = await runOn(exec, W, H, STEPS)
    let err = 0
    for (let i = 0; i < W * H; i++) err = Math.max(err, Math.abs(out[i * 4] - ref[i]))
    // Speed: 1024x1024 atlas-sized field.
    const { ms } = await runOn(exec, 1024, 1024, 400)
    results.push({ executor: `${exec.kind}/${backend}`, maxAbsErr: err, msPerStep: ms, ok: err < 1e-4 })
  }
  return results
}
