import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { ClassicCPU } from '../../src/classic/cpuReference'
import { parseInputs } from '../../src/classic/inputs'
import { JavaRandom } from '../../src/classic/javaRandom'
import { parseMouseScript } from '../../src/classic/mouseScript'

const fx = (p: string) => new URL(`../fixtures/classic/${p}`, import.meta.url)
export const GOLDEN_FRAMES = [1, 2, 64, 255, 256, 300, 320, 345, 400, 470, 480, 600]

function golden(t: number): Int32Array {
  const b = gunzipSync(readFileSync(fx(`frame-${String(t).padStart(4, '0')}.binz`)))
  return new Int32Array(b.buffer, b.byteOffset, b.byteLength / 4)
}

describe('JavaRandom', () => {
  it('matches java.util.Random(42) reference values', () => {
    // From OpenJDK: new Random(42).nextInt() == -1170105035; nextDouble() of a fresh Random(42) == 0.7275636800328681
    expect(new JavaRandom(42).next(32)).toBe(-1170105035)
    expect(new JavaRandom(42).nextDouble()).toBe(0.7275636800328681)
  })
})

describe('Classic 2004 CPU port', () => {
  it('reproduces the Java golden frames bit-exactly', { timeout: 60_000 }, () => {
    const inputs = parseInputs(new Uint8Array(gunzipSync(readFileSync(new URL('../../public/classic/inputs.binz', import.meta.url)))))
    const mouse = parseMouseScript(readFileSync(fx('mouse-script.txt'), 'utf8'))
    const sim = new ClassicCPU(inputs, 2004)
    for (let t = 1; t <= 600; t++) {
      sim.step(mouse(t))
      if (!GOLDEN_FRAMES.includes(t)) continue
      const g = golden(t)
      let bad = 0
      let first = -1
      for (let i = 0; i < g.length; i++)
        if (g[i] !== sim.pixels[i]) {
          if (first < 0) first = i
          bad++
        }
      expect(bad, `frame ${t}: ${bad} px differ, first at ${first} (x=${first % 800}, y=${(first / 800) | 0})`).toBe(0)
    }
  })
})
