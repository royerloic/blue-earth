import type * as THREE from 'three/webgpu'
import { ClassicGPU } from '../../src/classic/ClassicGPU'
import { loadInputs } from '../../src/classic/inputs'
import { parseMouseScript } from '../../src/classic/mouseScript'
import { ComputeExecutor } from '../../src/sim/executor/ComputeExecutor'
import { RTTExecutor } from '../../src/sim/executor/RTTExecutor'

const GOLDEN = [1, 2, 64, 255, 256, 300, 320, 345, 400, 470, 480, 600]

async function gunzip(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  return new Uint8Array(await new Response(res.body!.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
}

/** Runs the GPU Classic port against the Java golden frames on every available executor. */
export async function runClassicSpike(renderer: THREE.WebGPURenderer, backend: string) {
  const inputs = await loadInputs(`${import.meta.env.BASE_URL}classic/inputs.binz`)
  const mouse = parseMouseScript(await (await fetch('/tests/fixtures/classic/mouse-script.txt')).text())
  const golden = new Map<number, Int32Array>()
  for (const t of GOLDEN) {
    const b = await gunzip(`/tests/fixtures/classic/frame-${String(t).padStart(4, '0')}.binz`)
    golden.set(t, new Int32Array(b.buffer, b.byteOffset, b.byteLength / 4))
  }
  const execs = backend === 'webgpu' ? [new ComputeExecutor(renderer), new RTTExecutor(renderer)] : [new RTTExecutor(renderer)]
  const results = []
  for (const exec of execs) {
    const sim = new ClassicGPU(exec, inputs, 2004)
    const mismatches: Record<number, string> = {}
    let simMs = 0
    for (let t = 1; t <= 600; t++) {
      const t0 = performance.now()
      sim.step(mouse(t))
      simMs += performance.now() - t0
      const g = golden.get(t)
      if (!g) continue
      const px = await sim.readPixels()
      let bad = 0
      let first = -1
      const where: string[] = []
      for (let i = 0; i < g.length; i++)
        if (px[i] !== g[i]) {
          if (first < 0) first = i
          if (where.length < 6) where.push(`${i % 800},${(i / 800) | 0}`)
          bad++
        }
      if (bad && t === 1) console.log('MISMATCH1', where.join(' '))
      if (bad)
        mismatches[t] =
          `${bad} px; first (${first % 800},${(first / 800) | 0}) got ${(px[first] >>> 0).toString(16)} want ${(g[first] >>> 0).toString(16)}`
    }
    results.push({ executor: `${exec.kind}/${backend}`, exact: Object.keys(mismatches).length === 0, mismatches, cpuSubmitMsPerFrame: +(simMs / 600).toFixed(3) })
  }
  return results
}
