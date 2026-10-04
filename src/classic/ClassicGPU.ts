import { abs, clamp, float, int, ivec2, select, uniform, vec4 } from 'three/tsl'
import type Node from 'three/src/nodes/core/Node.js'
import type { Executor, Field, Kernel, Loader } from '../sim/executor/types'
import { H, LIGHT, W, type ClassicInputs } from './inputs'
import { JavaRandom } from './javaRandom'
import type { Mouse } from './mouseScript'

/**
 * GPU port of BlueEarth (2004), bit-exact with ClassicCPU / the Java original.
 *
 * Integers are stored exactly in rgba32f texels and computed with i32 in the shader.
 * Portability rules: division and modulo only on non-negative operands (or through
 * sign-safe idiv), no shifts or bit masks (GLSL ES leaves them undefined on negatives).
 *
 * state texel = (h1, h2, branch, 0)  // h1 = lHeightMatrix1 at frame start; branch: -1 out of band, 0 ocean, 1 flooded, 2 land
 * pixel texel = (R, G, B, A)         // A = 255 for ocean (PixelGrabber alpha), else 0
 */
const I = (n: number) => int(n) as any
/** Java int division (truncates toward zero) for any sign of a, b > 0. */
const idiv = (a: any, b: number) => {
  const q = (abs(a) as any).div(I(b))
  return select(a.lessThan(I(0)), q.negate(), q) as any
}
const SIZE = W * H
const BAND = (H / 5) * W

export class ClassicGPU {
  readonly sea = uniform(512)
  readonly sunX = uniform(W / 2)
  readonly sunY = uniform(H / 2)
  readonly clickOn = uniform(0)
  readonly clickX = uniform(0)
  readonly clickY = uniform(0)
  readonly clickC1 = uniform(0)
  readonly clickC2 = uniform(0)

  time = 0
  seaLevel = 512
  sunXi = W / 2
  sunYi = H / 2

  private readonly states: [Field, Field]
  readonly pixels: Field
  private readonly steps: [() => void, () => void]
  private readonly shades: [() => void, () => void]
  private cur = 0

  constructor(
    private readonly exec: Executor,
    inp: ClassicInputs,
    seed = 2004,
  ) {
    // Static inputs.
    const topo = new Float32Array(SIZE * 4)
    const world = new Float32Array(SIZE * 4)
    const init = new Float32Array(SIZE * 4)
    const rng = new JavaRandom(seed)
    for (let i = 0; i < SIZE; i++) {
      topo[i * 4] = inp.topo[i]
      if (i >= W && i < W * (H - 1)) {
        topo[i * 4 + 1] = inp.topo[i - 1] - inp.topo[i + 1]
        topo[i * 4 + 2] = inp.topo[i - W] - inp.topo[i + W]
      }
      world[i * 4] = inp.worldR[i]
      world[i * 4 + 1] = inp.worldG[i]
      world[i * 4 + 2] = inp.worldB[i]
      const h1 = Math.trunc(rng.nextDouble() * 8 - 4)
      init[i * 4] = h1
      init[i * 4 + 1] = (h1 / 2) | 0
      init[i * 4 + 2] = -1
    }
    const light = new Float32Array(LIGHT * LIGHT * 4)
    for (let i = 0; i < LIGHT * LIGHT; i++) {
      light[i * 4] = inp.lightR[i]
      light[i * 4 + 1] = inp.lightG[i]
      light[i * 4 + 2] = inp.lightB[i]
    }
    const topoF = exec.createStatic(W, H, topo)
    const worldF = exec.createStatic(W, H, world)
    const lightF = exec.createStatic(LIGHT, LIGHT, light)
    const initF = exec.createStatic(W, H, init)

    this.states = [exec.createField(W, H), exec.createField(W, H)]
    this.pixels = exec.createField(W, H)
    exec.pass<'src'>(({ src }, p) => src(p), { src: initF }, this.states[0])()

    const step = this.stepKernel()
    const shade = this.shadeKernel()
    this.steps = [
      exec.pass(step, { state: this.states[0], topo: topoF }, this.states[1]),
      exec.pass(step, { state: this.states[1], topo: topoF }, this.states[0]),
    ]
    this.shades = [
      exec.pass(shade, { state: this.states[1], world: worldF, light: lightF, topo: topoF }, this.pixels),
      exec.pass(shade, { state: this.states[0], world: worldF, light: lightF, topo: topoF }, this.pixels),
    ]
  }

  /** Advances one frame (CPU part mirrors BlueEarth.start() lines 281–320). */
  step(m: Mouse): void {
    const t = ++this.time
    if (t < 256) this.seaLevel = 2 * 256 - 2 * t
    else if (m.y > 590 && m.left) this.seaLevel = (((m.x - 400) * 130) / 100) | 0
    this.sunXi = ((3 * this.sunXi + m.x) / 4) | 0
    this.sunYi = ((3 * this.sunYi + m.y) / 4) | 0
    this.sea.value = this.seaLevel
    this.sunX.value = this.sunXi
    this.sunY.value = this.sunYi
    this.clickOn.value = m.left ? 1 : 0
    this.clickX.value = m.x
    this.clickY.value = m.y
    // Source values are computed on the CPU in f64, exactly like Java's Math.cos/sin.
    this.clickC1.value = Math.trunc(180 * Math.cos(0.5 * t))
    this.clickC2.value = Math.trunc(180 * Math.sin(0.5 * t))
    this.steps[this.cur]()
    this.shades[this.cur]()
    this.cur ^= 1
  }

  /** Packs the pixel field into Java's 0xAARRGGBB ints. */
  async readPixels(): Promise<Int32Array> {
    const f = await this.exec.read(this.pixels)
    const out = new Int32Array(SIZE)
    for (let i = 0; i < SIZE; i++)
      out[i] = ((f[i * 4 + 3] << 24) | (f[i * 4] << 16) | (f[i * 4 + 1] << 8) | f[i * 4 + 2]) | 0
    return out
  }

  private stepKernel(): Kernel<'state' | 'topo'> {
    const u = this
    return ({ state, topo }, p) => {
      const at = (load: Loader, j: any) => load(ivec2(j.mod(I(W)), j.div(I(W))) as unknown as Node) as any
      const mx = int(u.clickX) as any
      const my = int(u.clickY) as any
      const sea = int(u.sea) as any
      const base = mx.add(my.mul(I(W)))
      const lo = base.sub(I(3 + 3 * W))
      const hi = base.add(I(2 + 2 * W))
      /** Is linear index j written by the 6×6 click patch (with Java's index clamping)? */
      const inPatch = (j: any) => {
        const d = j.sub(base)
        let hit: any = j.equal(I(0)).and(lo.lessThanEqual(I(0)))
        hit = hit.or(j.equal(I(SIZE - 1)).and(hi.greaterThanEqual(I(SIZE - 1))))
        for (let ly = -3; ly < 3; ly++) {
          const dx = d.sub(I(W * ly))
          hit = hit.or(dx.greaterThanEqual(I(-3)).and(dx.lessThanEqual(I(2))))
        }
        return hit
      }
      /** (h1, h2) at linear index j after the click injection. */
      const eff = (j: any) => {
        const s = at(state, j)
        const h1 = int(s.x) as any
        const h2 = int(s.y) as any
        const clicked = (u.clickOn as any)
          .greaterThan(0.5)
          .and(inPatch(j))
          .and(h2.add(sea).greaterThan(int(at(topo, j).x)))
        return { h1: select(clicked, int(u.clickC1), h1) as any, h2: select(clicked, int(u.clickC2), h2) as any }
      }
      const pp = p as any
      const i = pp.y.mul(I(W)).add(pp.x)
      const self = eff(i)
      const sum = eff(i.add(I(W))).h1.add(eff(i.sub(I(W))).h1).add(eff(i.add(I(1))).h1).add(eff(i.sub(I(1))).h1)
      const h2u = idiv(sum, 2).sub(self.h2)
      const tp = int(at(topo, i).x) as any
      const ocean = tp.lessThanEqual(sea)
      const flooded = h2u.add(sea).greaterThan(tp)
      const h2f = select(ocean, h2u, select(flooded, h2u.sub(idiv(h2u, 64)), idiv(tp, 6)))
      const branch = select(ocean, I(0), select(flooded, I(1), I(2)))
      const inBand = i.greaterThanEqual(I(BAND)).and(i.lessThan(I(SIZE - BAND)))
      // Buffers swap every frame: new h1 = updated h2 (or untouched h2 outside the band), new h2 = h1.
      const newH1 = select(inBand, h2f, self.h2)
      return vec4(float(newH1), float(self.h1), float(select(inBand, branch, I(-1))), 0) as unknown as Node
    }
  }

  private shadeKernel(): Kernel<'state' | 'world' | 'light' | 'topo'> {
    const u = this
    return ({ state, world, light, topo }, p) => {
      const pp = p as any
      const i = pp.y.mul(I(W)).add(pp.x)
      const at = (load: Loader, j: any) => load(ivec2(j.mod(I(W)), j.div(I(W))) as unknown as Node) as any
      const lightAt = (l: any) => light(ivec2(l.mod(I(LIGHT)), l.div(I(LIGHT))) as unknown as Node) as any
      const h1 = (j: any) => int(at(state, j).y) as any // the frame's (click-modified) h1
      const s = at(state, i)
      const branch = int(s.z) as any
      const x = pp.x
      const y = pp.y
      const dsx = idiv(x.sub(int(u.sunX)), 4)
      const dsy = idiv(y.sub(int(u.sunY)), 4)
      const clampL = (l: any) => clamp(l, I(0), I(LIGHT * LIGHT - 1))
      const gX = h1(i.sub(I(1))).sub(h1(i.add(I(1))))
      const gY = h1(i.sub(I(W))).sub(h1(i.add(I(W))))

      // Ocean: lightmap lookup offset by water slope and sun distance.
      const oceanL = clampL(I(256).add(gX).add(dsx).add(I(256).add(gY).add(dsy).mul(I(LIGHT))))
      const oc = lightAt(oceanL)
      const ocean = vec4(oc.x, oc.y, oc.z, 255)

      // Flooded land: map colour lit by the unperturbed lightmap + glint, halved.
      const wlx = I(256).add(dsx)
      const wly = I(256).add(dsy)
      const wl = lightAt(wlx.add(wly.mul(I(LIGHT))))
      const fl = lightAt(clampL(gX.add(wlx).add(gY.add(wly).mul(I(LIGHT)))))
      const wc = at(world, i)
      const ch = (w: any, lw: any, lf: any) => int(lf).add(int(w).mul(int(lw)).div(I(256))).div(I(2)).mod(I(256))
      const flooded = vec4(float(ch(wc.x, wl.x, fl.x)), float(ch(wc.y, wl.y, fl.y)), float(ch(wc.z, wl.z, fl.z)), 0)

      // Dry land: map colour × lightmap blue channel via the terrain gradient.
      const tg = at(topo, i)
      const landL = clampL(
        I(256)
          .add(int(tg.y))
          .add(dsx)
          .add(I(256).add(int(tg.z)).add(dsy).mul(I(LIGHT))),
      )
      const lb = int(lightAt(landL).z) as any
      const lc = (w: any) => float(int(w).mul(lb).div(I(256)))
      const land = vec4(lc(wc.x), lc(wc.y), lc(wc.z), 0)

      return select(
        branch.equal(I(0)),
        ocean,
        select(branch.equal(I(1)), flooded, select(branch.equal(I(2)), land, vec4(0, 0, 0, 0))),
      ) as unknown as Node
    }
  }
}
