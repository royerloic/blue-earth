import * as THREE from 'three/webgpu'
import { abs, float, floor, int, ivec2, max, min, mod, select, sqrt, uniform, vec3, vec4 } from 'three/tsl'
import type Node from 'three/src/nodes/core/Node.js'
import type { Executor, Field, Kernel, Loader } from './executor/types'
import { OPPOSITE, type CubeGrid } from './grid'
import { DEFAULT_PARAMS, type SWEParams } from './swe'

/**
 * GPU shallow-water solver: the algorithm of swe.ts as per-cell gather kernels.
 *
 * Atlas: faces in a 3×2 layout, cell (f, i, j) at texel ((f % 3)·N + i, ⌊f/3⌋·N + j).
 * State texel: (η, mx, my, mz). Static tables (rgba32f):
 *   nb   = 4 neighbour texels packed as x + 4096·y (exact in f32)
 *   cell = (centre xyz, back dirs packed b0 + 4b1 + 16b2 + 64b3)
 *   g0–3 = (edge normal xyz, ℓ/A) per edge k
 *   bed  = (B, F, 0, 0)   F = flood level (lowest sea level connecting the cell to the ocean)
 * Three state fields rotate: stage 1 writes U1, stage 2 reads U1 and Uⁿ and writes Uⁿ⁺¹
 * (render-to-texture cannot read and write the same target).
 */
type In = 'u' | 'base' | 'nb' | 'cell' | 'g0' | 'g1' | 'g2' | 'g3' | 'bed'
export const MAX_IMPULSES = 8

const any = (n: unknown) => n as any
const PACK = 4096

export interface Impulse {
  /** Unit ECEF direction of the centre. */
  dir: [number, number, number]
  /** Peak η change (m). */
  amplitude: number
  /** Gaussian radius (radians). */
  sigma: number
}

export class SWESolver {
  readonly N: number
  readonly width: number
  readonly height: number
  readonly dt = uniform(10)
  readonly coriolis = uniform(1)
  readonly manning = uniform(DEFAULT_PARAMS.manning)
  private readonly impulseCount = uniform(0)
  /** Impulse centre (xyz) and amplitude (w); radius in impulseSigma. */
  private readonly impulseDir = Array.from({ length: MAX_IMPULSES }, () => uniform(new THREE.Vector4()))
  private readonly impulseSigma = Array.from({ length: MAX_IMPULSES }, () => uniform(1))
  private readonly states: Field[]
  /** Diagnostics (max anomaly, first arrival time s or −1, max inundation depth, ·), ping-pong. */
  private readonly diags: Field[]
  private readonly diagPass: (() => void)[][] = []
  private readonly diagClear: (() => void)[] = []
  private dp = 0
  /** Simulated seconds since the last diagnostics reset (drives arrival times). */
  readonly clock = uniform(0)
  /** Anomaly (m) that counts as the wave's arrival (1 cm, like an offshore gauge pick). */
  readonly arrivalThreshold = uniform(0.01)
  private readonly statics: Record<'nb' | 'cell' | 'g0' | 'g1' | 'g2' | 'g3' | 'bed', Field>
  private readonly stage1: (() => void)[] = []
  private readonly stage2: (() => void)[] = []
  private readonly impulse: (() => void)[] = []
  private readonly seaPass: (() => void)[] = []
  private readonly addPass: (() => void)[] = []
  private readonly delta: Field
  readonly seaLevel = uniform(0)
  private readonly p: SWEParams
  private cur = 0
  private pending: Impulse[] = []
  time = 0

  constructor(
    private readonly exec: Executor,
    grid: CubeGrid,
    bed: Float32Array | Float64Array,
    initialEta: Float32Array | Float64Array,
    params: SWEParams = DEFAULT_PARAMS,
    /** Flood level per cell (enables setSeaLevel); defaults to B (everything connected). */
    floodLevel?: Float32Array | Float64Array,
  ) {
    const p = (this.p = params)
    const N = (this.N = grid.N)
    this.width = 3 * N
    this.height = 2 * N
    const W = this.width
    const H = this.height
    const texel = new Int32Array(grid.cells)
    for (let c = 0; c < grid.cells; c++) {
      const f = Math.floor(c / (N * N))
      const r = c % (N * N)
      texel[c] = (f % 3) * N + (r % N) + PACK * (Math.floor(f / 3) * N + Math.floor(r / N))
    }
    const tex = () => new Float32Array(W * H * 4)
    const nb = tex()
    const cell = tex()
    const gk = [tex(), tex(), tex(), tex()]
    const bedT = tex()
    const init = tex()
    for (let c = 0; c < grid.cells; c++) {
      const t = texel[c]
      const o = ((t % PACK) + W * Math.floor(t / PACK)) * 4
      let backs = 0
      for (let k = 0; k < 4; k++) {
        nb[o + k] = texel[grid.nb[c * 4 + k]]
        backs += grid.back[c * 4 + k] * 4 ** k
        gk[k].set(grid.normal.subarray((c * 4 + k) * 3, (c * 4 + k) * 3 + 3), o)
        gk[k][o + 3] = grid.lenOverArea[c * 4 + k]
      }
      cell.set(grid.center.subarray(c * 3, c * 3 + 3), o)
      cell[o + 3] = backs
      bedT[o] = bed[c]
      bedT[o + 1] = floodLevel ? floodLevel[c] : bed[c]
      init[o] = initialEta[c]
    }
    const st = (d: Float32Array) => exec.createStatic(W, H, d)
    this.statics = { nb: st(nb), cell: st(cell), g0: st(gk[0]), g1: st(gk[1]), g2: st(gk[2]), g3: st(gk[3]), bed: st(bedT) }
    this.states = [exec.createField(W, H), exec.createField(W, H), exec.createField(W, H)]
    this.diags = [exec.createField(W, H), exec.createField(W, H)]
    this.delta = exec.createStatic(W, H, new Float32Array(W * H * 4))
    exec.pass<'src'>(({ src }, q) => src(q), { src: st(init) }, this.states[0])()
    for (const d of this.diags) {
      const clear = exec.pass(() => vec4(0, -1, 0, 0) as unknown as Node, {}, d)
      this.diagClear.push(clear)
      clear()
    }
    this.manning.value = p.manning
    this.coriolis.value = p.coriolis ? 1 : 0

    const k1 = this.stageKernel(1)
    const k2 = this.stageKernel(2)
    const ki = this.impulseKernel()
    // Adds a per-cell η field (e.g. Okada seafloor uplift) to wet cells.
    const ka: Kernel<In> = ({ u, base, bed }, q) => {
      const st = u(q) as any
      const add = (base(q) as any).x
      const wet = st.x.sub((bed(q) as any).x).greaterThan(this.p.hDry)
      return vec4(select(wet, st.x.add(add), st.x), st.y, st.z, st.w) as unknown as Node
    }
    // Diagnostics update from the state just written (u) and the previous diagnostics (base).
    const kd: Kernel<In> = ({ u, base, bed }, q) => {
      const st = u(q) as any
      const dg = base(q) as any
      const b = bed(q) as any
      const S = this.seaLevel as any
      const ocean = b.y.lessThanEqual(S)
      const rest = select(ocean, max(S, b.x), b.x)
      const h = max(st.x.sub(b.x), 0) as any
      const anomaly = select(h.greaterThan(0.05), st.x.sub(rest), float(0)) as any
      const arrived = dg.y.lessThan(0).and(anomaly.greaterThan(this.arrivalThreshold))
      const inund = select(ocean.not(), h, float(0))
      return vec4(max(dg.x, anomaly), select(arrived, this.clock, dg.y), max(dg.z, inund), 0) as unknown as Node
    }
    const ks: Kernel<In> = ({ bed }, q) => {
      const b = bed(q) as any
      const S = this.seaLevel as any
      return vec4(select(b.y.lessThanEqual(S), max(S, b.x), b.x), 0, 0, 0) as unknown as Node
    }
    for (let r = 0; r < 3; r++) {
      const A = this.states[r]
      const B = this.states[(r + 1) % 3]
      const C = this.states[(r + 2) % 3]
      this.stage1.push(exec.pass(k1, { u: A, base: A, ...this.statics }, B))
      this.stage2.push(exec.pass(k2, { u: B, base: A, ...this.statics }, C))
      this.impulse.push(exec.pass(ki, { u: A, base: A, ...this.statics }, B))
      this.seaPass.push(exec.pass(ks, { u: A, base: A, ...this.statics }, B))
      this.addPass.push(exec.pass(ka, { u: A, base: this.delta, ...this.statics }, B))
      this.diagPass.push([0, 1].map((d) => exec.pass(kd, { u: A, base: this.diags[d], ...this.statics }, this.diags[1 - d])))
    }
  }

  /** The field holding the current state (η, mx, my, mz). */
  get state(): Field {
    return this.states[this.cur]
  }

  /** Replaces the state with η = `eta` (per cell id) and zero momentum; η becomes η_rest. */
  reset(eta: Float32Array | Float64Array) {
    const init = new Float32Array(this.width * this.height * 4)
    for (let c = 0; c < eta.length; c++) init[this.texelOf(c)] = eta[c]
    const f = this.exec.createStatic(this.width, this.height, init)
    this.exec.pass<'src'>(({ src }, q) => src(q), { src: f }, this.states[this.cur])()
    ;(f as unknown as { texture: { dispose(): void } }).texture.dispose()
    this.pending = []
  }

  /**
   * A pass from the current state (and bed) into a fixed output field, e.g. the display
   * texture the renderer samples. Returns a function that runs it for whichever state is current.
   */
  view(kernel: Kernel<'u' | 'bed' | 'nb'>, output: Field, source: 'state' | 'diag' = 'state'): () => void {
    const src = source === 'state' ? this.states : this.diags
    const passes = src.map((st) => this.exec.pass(kernel, { u: st, bed: this.statics.bed, nb: this.statics.nb }, output))
    return () => passes[source === 'state' ? this.cur : this.dp]()
  }

  /** Clears max height / arrival time and restarts the diagnostics clock. */
  clearDiagnostics() {
    for (const c of this.diagClear) c()
    this.clock.value = 0
  }

  /**
   * Instant sea level S: the ocean (F ≤ S) at rest at S, everything else dry. Runs on the GPU,
   * so it can be animated every frame (the intro drains the sea from +500 m).
   */
  setSeaLevel(S: number) {
    this.seaLevel.value = S
    this.seaPass[this.cur]()
    this.cur = (this.cur + 1) % 3
    this.pending = []
    this.clearDiagnostics()
  }

  /** Adds `delta[c]` (m) to η of every wet cell c (per cell id). */
  addEta(delta: Float32Array) {
    const tex = (this.delta as unknown as { texture: THREE.DataTexture }).texture
    const data = tex.image.data as Float32Array
    data.fill(0)
    for (let c = 0; c < delta.length; c++) if (delta[c] !== 0) data[this.texelOf(c)] = delta[c]
    tex.needsUpdate = true
    this.addPass[this.cur]()
    this.cur = (this.cur + 1) % 3
  }

  addImpulse(i: Impulse) {
    this.pending.push(i)
  }

  /** Advances `n` steps of dt seconds (dt.value). */
  step(n = 1) {
    if (this.pending.length) this.applyImpulses()
    for (let s = 0; s < n; s++) {
      this.stage1[this.cur]()
      this.stage2[this.cur]()
      this.cur = (this.cur + 2) % 3
      this.time += this.dt.value
      this.clock.value += this.dt.value
      this.diagPass[this.cur][this.dp]()
      this.dp ^= 1
    }
  }

  /** Current diagnostics (max anomaly, arrival s or −1, max inundation, ·) per texel. */
  async readDiagnostics(): Promise<Float32Array> {
    return this.exec.read(this.diags[this.dp])
  }

  async readState(): Promise<Float32Array> {
    return this.exec.read(this.state)
  }

  /** Texel index (into readState()) of cell id c. */
  texelOf(c: number): number {
    const N = this.N
    const f = Math.floor(c / (N * N))
    const r = c % (N * N)
    return ((Math.floor(f / 3) * N + Math.floor(r / N)) * this.width + (f % 3) * N + (r % N)) * 4
  }

  private applyImpulses() {
    const batch = this.pending.splice(0, MAX_IMPULSES)
    batch.forEach((b, k) => {
      this.impulseDir[k].value.set(b.dir[0], b.dir[1], b.dir[2], b.amplitude)
      this.impulseSigma[k].value = b.sigma
    })
    this.impulseCount.value = batch.length
    this.impulse[this.cur]()
    this.cur = (this.cur + 1) % 3
    if (this.pending.length) this.applyImpulses()
  }

  /** Adds Gaussian η bumps to wet cells. */
  private impulseKernel(): Kernel<In> {
    return ({ u, cell, bed }, q) => {
      const s = any(u(q))
      const c = any(cell(q)).xyz
      const B = any(bed(q)).x
      let eta = s.x
      for (let k = 0; k < MAX_IMPULSES; k++) {
        const d = any(this.impulseDir[k])
        const cosA = c.dot(d.xyz)
        // Gaussian in chord distance, |c − d|² = 2(1 − cos a) ≈ a² for σ ≪ 1 rad.
        const sg = any(this.impulseSigma[k])
        const g = float(1).sub(cosA).mul(2).div(sg.mul(sg)).negate().exp()
        const on = float(k).lessThan(this.impulseCount).and(cosA.greaterThan(0))
        eta = eta.add(select(on, d.w.mul(g), float(0)))
      }
      const wet = s.x.sub(B).greaterThan(this.p.hDry)
      return vec4(select(wet, eta, s.x), s.y, s.z, s.w) as unknown as Node
    }
  }

  private stageKernel(stage: 1 | 2): Kernel<In> {
    const P = this.p
    const g = P.g
    return (I, q) => {
      const unpack = (v: any) => ivec2(int(mod(v, PACK)), int(floor(v.div(PACK)))) as unknown as Node
      const comp = (v: any, k: number) => [v.x, v.y, v.z, v.w][k]
      const dyn = (v: any, idx: any) => select(idx.equal(0), v.x, select(idx.equal(1), v.y, select(idx.equal(2), v.z, v.w)))
      const ld = (L: Loader, t: Node) => any(L(t))
      const self = ld(I.u, q)
      const nbs = ld(I.nb, q)
      const cl = ld(I.cell, q)
      const center = cl.xyz
      const Bc = ld(I.bed, q).x
      const myPacked = float(any(q).x).add(float(any(q).y).mul(PACK))

      /** Monotonized-central limiter (same as swe.ts mc). */
      const minmod = (a: any, b: any) =>
        select(a.mul(b).lessThanEqual(0), float(0), any(a).sign().mul(min(min(abs(a).mul(2), abs(b).mul(2)), abs(a.add(b)).mul(0.5))))
      /** Value at b reconstructed toward d (line a–b–d), first order near dry cells. */
      const rec = (Sa: any, Ba: any, Sb: any, Bb: any, Sd: any, Bd: any) => {
        const wet = Sa.x.sub(Ba).greaterThan(P.hEps).and(Sb.x.sub(Bb).greaterThan(P.hEps)).and(Sd.x.sub(Bd).greaterThan(P.hEps))
        const half = select(wet, float(0.5), float(0))
        return vec4(
          Sb.x.add(half.mul(minmod(Sb.x.sub(Sa.x), Sd.x.sub(Sb.x)))),
          Sb.y.add(half.mul(minmod(Sb.y.sub(Sa.y), Sd.y.sub(Sb.y)))),
          Sb.z.add(half.mul(minmod(Sb.z.sub(Sa.z), Sd.z.sub(Sb.z)))),
          Sb.w.add(half.mul(minmod(Sb.w.sub(Sa.w), Sd.w.sub(Sb.w)))),
        ) as any
      }
      const side = (r: any, bCell: any, bf: any) => {
        const hRec = max(r.x.sub(bCell), 0) as any
        const h = max(r.x.sub(bf), 0) as any
        const bfs = min(bf, r.x)
        const h4 = hRec.mul(hRec).mul(hRec).mul(hRec)
        const inv = select(hRec.greaterThan(0), hRec.mul(Math.SQRT2).div(sqrt(h4.add(max(h4, P.hEps ** 4)))), float(0))
        return { h, bf: bfs, eta: r.x, u: vec3(r.y, r.z, r.w).mul(inv) as any }
      }
      /**
       * Pressure ½g(e² − 2eb) relative to the reference (er, br), written in differences:
       * ½g[(e−er)(e+er) − 2((e−er)·b + er·(b−br))]. It is exactly 0 at rest however the
       * compiler contracts the arithmetic (FMA), unlike subtracting two rounded pressures.
       */
      const pRel = (e: any, b: any, er: any, br: any) => {
        const de = e.sub(er)
        return float(0.5 * g).mul(de.mul(e.add(er)).sub(de.mul(b).add(er.mul(b.sub(br))).mul(2)))
      }
      /** HLL: returns vec4(mass, momentum xyz), pressures relative to (er, br). */
      const hll = (L: any, R: any, n: any, er: any, br: any) => {
        const unL = L.u.dot(n)
        const unR = R.u.dot(n)
        const pL = pRel(L.eta, L.bf, er, br)
        const pR = pRel(R.eta, R.bf, er, br)
        const cL = sqrt(L.h.mul(g))
        const cR = sqrt(R.h.mul(g))
        const sL = min(unL.sub(cL), unR.sub(cR)) as any
        const sR = max(unL.add(cL), unR.add(cR)) as any
        const fL = vec4(L.h.mul(unL), L.u.mul(L.h.mul(unL)).add(n.mul(pL))) as any
        const fR = vec4(R.h.mul(unR), R.u.mul(R.h.mul(unR)).add(n.mul(pR))) as any
        const uL = vec4(L.h, L.u.mul(L.h)) as any
        const uR = vec4(R.h, R.u.mul(R.h)) as any
        const mid = fL.mul(sR).sub(fR.mul(sL)).add(uR.sub(uL).mul(sL.mul(sR))).div(max(sR.sub(sL), 1e-12))
        const bothDry = L.h.lessThan(P.hDry).and(R.h.lessThan(P.hDry))
        return select(bothDry, vec4(0, n.mul(pL)), select(sL.greaterThanEqual(0), fL, select(sR.lessThanEqual(0), fR, mid))) as any
      }

      let de: any = float(0)
      let dm: any = vec3(0, 0, 0)
      const G = [I.g0, I.g1, I.g2, I.g3]
      for (let k = 0; k < 4; k++) {
        const oT = unpack(comp(nbs, k))
        const cmT = unpack(comp(nbs, OPPOSITE[k]))
        const bk = mod(floor(cl.w.div(4 ** k)), 4)
        const oppBk = select(bk.equal(0), float(1), select(bk.equal(1), float(0), select(bk.equal(2), float(3), float(2))))
        const nbo = ld(I.nb, oT)
        const opT = unpack(dyn(nbo, oppBk))
        const So = ld(I.u, oT)
        const Scm = ld(I.u, cmT)
        const Sop = ld(I.u, opT)
        const Bo = ld(I.bed, oT).x
        const Bcm = ld(I.bed, cmT).x
        const Bop = ld(I.bed, opT).x
        const rc = rec(Scm, Bcm, self, Bc, So, Bo)
        const ro = rec(Sop, Bop, So, Bo, self, Bc)
        const bf = max(Bc, Bo)
        const sc = side(rc, Bc, bf)
        const so = side(ro, Bo, bf)
        const gk = ld(G[k], q)
        const n = gk.xyz
        // Momentum relative to the cell-centre pressure (well-balanced bed source).
        const fm = hll(sc, so, n, self.x, sc.bf)
        const zero = float(0)
        const fMassRev = hll(so, sc, n.negate(), zero, zero).x.negate()
        const oPacked = comp(nbs, k)
        const mass = select(myPacked.lessThan(oPacked), hll(sc, so, n, zero, zero).x, fMassRev)
        de = de.sub(gk.w.mul(mass))
        dm = dm.sub(vec3(fm.y, fm.z, fm.w).mul(gk.w))
      }
      const f2 = float(2 * P.omega).mul(this.coriolis)
      dm = dm.add(vec3(self.z.mul(f2), self.y.mul(f2).negate(), 0))
      dm = dm.sub(center.mul(dm.dot(center)))

      const base = ld(I.base, q)
      const dt = any(this.dt)
      let eta: any
      let m: any
      if (stage === 1) {
        eta = self.x.add(dt.mul(de))
        m = vec3(self.y, self.z, self.w).add(dm.mul(dt))
      } else {
        eta = base.x.mul(0.5).add(self.x.add(dt.mul(de)).mul(0.5))
        m = vec3(base.y, base.z, base.w).mul(0.5).add(vec3(self.y, self.z, self.w).add(dm.mul(dt)).mul(0.5))
      }
      // Post-process: positivity, dry cells, tangent projection, speed limit (+ friction).
      eta = max(eta, Bc)
      const h = eta.sub(Bc)
      m = m.sub(center.mul(m.dot(center)))
      const sp = m.length()
      m = m.mul(min(float(1), h.mul(P.uMax).div(max(sp, 1e-30))))
      if (stage === 2) {
        const hs = max(h, P.hDry)
        const speed = m.length().div(hs)
        const d = float(1).add(dt.mul(g).mul(any(this.manning)).mul(this.manning).mul(speed).div(hs.pow(4 / 3)))
        m = m.div(d)
      }
      m = select(h.lessThan(P.hDry), vec3(0, 0, 0), m)
      return vec4(eta, m) as unknown as Node
    }
  }
}

