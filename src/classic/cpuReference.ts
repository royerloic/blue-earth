import { H, LIGHT, W, type ClassicInputs } from './inputs'
import { JavaRandom } from './javaRandom'
import type { Mouse } from './mouseScript'

/**
 * Bit-exact CPU port of BlueEarth.start() (2004), for 800×600. Java int semantics are kept
 * with `| 0` (truncating division, 32-bit wrap); line references are to the original
 * src/blueearth/BlueEarth.java. Used as the reference for the GPU kernels.
 */
export class ClassicCPU {
  readonly pixels = new Int32Array(W * H)
  h1 = new Int32Array(W * H)
  h2 = new Int32Array(W * H)
  time = 0
  seaLevel = 2 * 256
  sunX = W / 2
  sunY = H / 2
  readonly gradX = new Int32Array(W * H)
  readonly gradY = new Int32Array(W * H)
  /** Packed 0xFFRRGGBB light map, as PixelGrabber returns it. */
  readonly lightMap = new Int32Array(LIGHT * LIGHT)

  constructor(
    readonly inp: ClassicInputs,
    seed = 2004,
  ) {
    const { topo } = inp
    for (let i = W; i < W * (H - 1); i++) {
      this.gradX[i] = topo[i - 1] - topo[i + 1]
      this.gradY[i] = topo[i - W] - topo[i + W]
    }
    for (let i = 0; i < LIGHT * LIGHT; i++)
      this.lightMap[i] = (0xff000000 | (inp.lightR[i] << 16) | (inp.lightG[i] << 8) | inp.lightB[i]) | 0
    const rng = new JavaRandom(seed)
    for (let i = 0; i < W * H; i++) {
      this.h1[i] = Math.trunc(rng.nextDouble() * 8 - 4)
      this.h2[i] = (this.h1[i] / 2) | 0
    }
  }

  step(m: Mouse): void {
    const { worldR, worldG, worldB, topo, lightR, lightG, lightB } = this.inp
    const { lightMap, gradX, gradY, pixels } = this
    const h1 = this.h1
    const h2 = this.h2
    const size = W * H
    const t = ++this.time

    if (t < 256) this.seaLevel = 2 * 256 - 2 * t
    else if (m.y > 590 && m.left) this.seaLevel = (((m.x - 400) * 130) / 100) | 0
    const sea = this.seaLevel
    this.sunX = ((3 * this.sunX + m.x) / 4) | 0
    this.sunY = ((3 * this.sunY + m.y) / 4) | 0
    const sunX = this.sunX
    const sunY = this.sunY

    if (m.left) {
      const c1 = Math.trunc(180 * Math.cos(0.5 * t))
      const c2 = Math.trunc(180 * Math.sin(0.5 * t))
      for (let ly = -3; ly < 3; ly++)
        for (let lx = -3; lx < 3; lx++) {
          let idx = m.x + lx + W * (m.y + ly)
          if (idx < 0) idx = 0
          else if (idx >= size) idx = size - 1
          if (h2[idx] + sea > topo[idx]) {
            h1[idx] = c1
            h2[idx] = c2
          }
        }
    }

    const clampLight = (l: number) => (l >= LIGHT * LIGHT ? LIGHT * LIGHT - 1 : l < 0 ? 0 : l)
    const band = (H / 5) * W
    for (let i = band; i < size - band; i++) {
      h2[i] = (((h1[i + W] + h1[i - W] + h1[i + 1] + h1[i - 1]) / 2) | 0) - h2[i]
      const x = i % W
      const y = (i / W) | 0
      if (topo[i] <= sea) {
        // Ocean.
        const gX = h1[i - 1] - h1[i + 1]
        const gY = h1[i - W] - h1[i + W]
        const lx = 256 + gX + (((x - sunX) / 4) | 0)
        const lyy = 256 + gY + (((y - sunY) / 4) | 0)
        pixels[i] = lightMap[clampLight(lx + (lyy << 9))]
      } else if (h2[i] + sea > topo[i]) {
        // Flooded land.
        const gX = h1[i - 1] - h1[i + 1]
        const gY = h1[i - W] - h1[i + W]
        const wlx = 256 + (((x - sunX) / 4) | 0)
        const wly = 256 + (((y - sunY) / 4) | 0)
        const wl = wlx + (wly << 9)
        const l = clampLight(gX + wlx + ((gY + wly) << 9))
        const wr = (worldR[i] * lightR[wl]) >> 8
        const wg = (worldG[i] * lightG[wl]) >> 8
        const wb = (worldB[i] * lightB[wl]) >> 8
        pixels[i] =
          (((lightR[l] + wr) << 15) & 0x00ff0000) +
          (((lightG[l] + wg) << 7) & 0x0000ff00) +
          (((lightB[l] + wb) >> 1) & 0x000000ff)
        h2[i] = h2[i] - ((h2[i] / 64) | 0)
      } else {
        // Dry land.
        h2[i] = (topo[i] / 6) | 0
        const lx = 256 + gradX[i] + (((x - sunX) / 4) | 0)
        const lyy = 256 + gradY[i] + (((y - sunY) / 4) | 0)
        const l = lightMap[clampLight(lx + (lyy << 9))] & 0xff
        pixels[i] = (((worldR[i] * l) >> 8) << 16) + (((worldG[i] * l) >> 8) << 8) + ((worldB[i] * l) >> 8)
      }
    }
    this.h1 = h2
    this.h2 = h1
  }
}
