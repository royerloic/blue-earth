import type * as THREE from 'three/webgpu'
import { ComputeExecutor } from '../../src/sim/executor/ComputeExecutor'
import { RTTExecutor } from '../../src/sim/executor/RTTExecutor'
import type { Executor } from '../../src/sim/executor/types'
import { buildCubeGrid, type CubeGrid } from '../../src/sim/grid'
import { CpuSWE, DEFAULT_PARAMS, stableDt } from '../../src/sim/swe'
import { SWESolver } from '../../src/sim/SWESolver'

const R = 6_371_000

function relief(g: CubeGrid): Float64Array {
  const B = new Float64Array(g.cells)
  for (let c = 0; c < g.cells; c++) {
    const x = g.center[c * 3], y = g.center[c * 3 + 1], z = g.center[c * 3 + 2]
    B[c] = -1100 + 1900 * Math.sin(5 * x + 1) * Math.cos(4 * y - 0.5) * Math.sin(3 * z + 2)
  }
  return B
}

/** GPU solver vs the float64 reference, lake-at-rest in f32, and throughput at N = 512. */
export async function runSweSpike(renderer: THREE.WebGPURenderer, backend: string) {
  const execs: Executor[] = backend === 'webgpu' ? [new ComputeExecutor(renderer), new RTTExecutor(renderer)] : [new RTTExecutor(renderer)]
  const out: Record<string, unknown>[] = []
  const g = buildCubeGrid(32, R)
  const B = relief(g)
  const eta0 = new Float64Array(g.cells)
  for (let c = 0; c < g.cells; c++) eta0[c] = Math.max(B[c], 30 * Math.exp(-((Math.acos(Math.min(1, g.center[c * 3])) / 0.12) ** 2)))
  const dt = stableDt(g, 3000)
  const STEPS = 60
  const cpu = new CpuSWE(g, B, DEFAULT_PARAMS)
  cpu.eta.set(Float32Array.from(eta0)) // same f32-rounded start as the GPU
  for (let s = 0; s < STEPS; s++) cpu.step(dt)

  for (const exec of execs) {
    const res: Record<string, unknown> = { executor: `${exec.kind}/${backend}` }
    // Parity.
    const gpu = new SWESolver(exec, g, Float32Array.from(B), Float32Array.from(eta0), DEFAULT_PARAMS)
    gpu.dt.value = dt
    gpu.step(STEPS)
    const st = await gpu.readState()
    let dEta = 0
    let dM = 0
    let mScale = 0
    for (let c = 0; c < g.cells; c++) {
      const t = gpu.texelOf(c)
      dEta = Math.max(dEta, Math.abs(st[t] - cpu.eta[c]))
      for (let q = 0; q < 3; q++) dM = Math.max(dM, Math.abs(st[t + 1 + q] - cpu.m[c * 3 + q]))
      mScale = Math.max(mScale, Math.hypot(cpu.m[c * 3], cpu.m[c * 3 + 1], cpu.m[c * 3 + 2]))
    }
    res.parityMaxDeta = +dEta.toExponential(2)
    res.parityMaxDmRel = +(dM / mScale).toExponential(2)

    // Lake at rest (η = +50 m, dry islands) in f32: 200 steps.
    const rest = Float32Array.from(B, (b) => Math.max(50, b))
    const lake = new SWESolver(exec, g, Float32Array.from(B), rest, DEFAULT_PARAMS)
    lake.dt.value = dt
    lake.step(200)
    const ls = await lake.readState()
    let lm = 0
    let le = 0
    for (let c = 0; c < g.cells; c++) {
      const t = lake.texelOf(c)
      lm = Math.max(lm, Math.hypot(ls[t + 1], ls[t + 2], ls[t + 3]))
      le = Math.max(le, Math.abs(ls[t] - rest[c]))
    }
    res.lakeMaxM = lm
    res.lakeMaxDeta = le
    out.push(res)
  }

  // Throughput at the Medium sim size (?perf=1; slow on software renderers).
  if (!new URLSearchParams(location.search).has('perf')) return out
  const big = buildCubeGrid(512, R)
  const bigB = relief(big)
  const exec = execs[0]
  const solver = new SWESolver(exec, big, Float32Array.from(bigB), Float32Array.from(bigB, (b) => Math.max(0, b)), DEFAULT_PARAMS)
  solver.dt.value = 10
  solver.step(2)
  await solver.readState()
  const t0 = performance.now()
  solver.step(50)
  await solver.readState()
  out.push({ throughput: `${exec.kind}/${backend}`, cells: big.cells, msPerStep: +((performance.now() - t0) / 50).toFixed(2) })
  return out
}
