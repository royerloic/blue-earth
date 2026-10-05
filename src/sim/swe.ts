import { OPPOSITE, type CubeGrid } from './grid'

/**
 * Nonlinear shallow-water equations on the sphere, finite volumes on the cube grid.
 *
 * State per cell: η (free-surface elevation, m) and m = h·u, a 3D Cartesian momentum vector
 * kept in the local tangent plane. Scheme (see docs/NUMERICS.md):
 *  - MUSCL (minmod) reconstruction of η and m along each edge's line of cells;
 *  - hydrostatic reconstruction (Audusse) with Liang & Marche's bed lowering at dry faces;
 *  - η-form pressure ½g(η² − 2ηB), so the bed source cancels the flux exactly at rest;
 *  - HLL (Einfeldt speeds) fluxes; mass flux canonical by cell id (exact conservation);
 *  - SSP-RK2 (Heun), Coriolis, semi-implicit Manning friction, wet/dry clamps.
 *
 * This float64 CPU version is the reference for the GPU kernels (same algorithm, line by line).
 */
export interface SWEParams {
  g: number
  omega: number
  /** Below this depth a cell is dry (no momentum). */
  hDry: number
  /** Velocity desingularisation depth (Kurganov & Petrova). */
  hEps: number
  uMax: number
  /** Manning coefficient (s/m^(1/3)); 0 disables friction. */
  manning: number
  coriolis: boolean
}

export const DEFAULT_PARAMS: SWEParams = { g: 9.81, omega: 7.2921e-5, hDry: 1e-3, hEps: 0.05, uMax: 30, manning: 0.025, coriolis: true }

export const minmod = (a: number, b: number) => (a * b <= 0 ? 0 : Math.abs(a) < Math.abs(b) ? a : b)

interface Side {
  h: number
  eta: number
  bf: number
  ux: number
  uy: number
  uz: number
}

/**
 * HLL flux across a face with unit normal n from side L to side R: [mass, mx, my, mz].
 * Pressures are taken relative to the reference state (er, br), written in differences
 * (HLL is affine in F, so this returns F − p(er, br)·n). With the cell-centre η and face bed
 * as reference this is the well-balanced bed source, and the rest state cancels exactly
 * even in float32 (the GPU kernel uses the same form).
 */
export function hll(L: Side, R: Side, nx: number, ny: number, nz: number, p: SWEParams, out: Float64Array, er = 0, br = 0) {
  const unL = L.ux * nx + L.uy * ny + L.uz * nz
  const unR = R.ux * nx + R.uy * ny + R.uz * nz
  const pRel = (e: number, b: number) => 0.5 * p.g * ((e - er) * (e + er) - 2 * ((e - er) * b + er * (b - br)))
  const pL = pRel(L.eta, L.bf)
  const pR = pRel(R.eta, R.bf)
  if (L.h < p.hDry && R.h < p.hDry) {
    out[0] = 0
    out[1] = pL * nx
    out[2] = pL * ny
    out[3] = pL * nz
    return
  }
  const cL = Math.sqrt(p.g * L.h)
  const cR = Math.sqrt(p.g * R.h)
  const sL = Math.min(unL - cL, unR - cR)
  const sR = Math.max(unL + cL, unR + cR)
  const fL = [L.h * unL, L.h * L.ux * unL + pL * nx, L.h * L.uy * unL + pL * ny, L.h * L.uz * unL + pL * nz]
  const fR = [R.h * unR, R.h * R.ux * unR + pR * nx, R.h * R.uy * unR + pR * ny, R.h * R.uz * unR + pR * nz]
  if (sL >= 0) for (let q = 0; q < 4; q++) out[q] = fL[q]
  else if (sR <= 0) for (let q = 0; q < 4; q++) out[q] = fR[q]
  else {
    const uL = [L.h, L.h * L.ux, L.h * L.uy, L.h * L.uz]
    const uR = [R.h, R.h * R.ux, R.h * R.uy, R.h * R.uz]
    const inv = 1 / (sR - sL)
    for (let q = 0; q < 4; q++) out[q] = (sR * fL[q] - sL * fR[q] + sL * sR * (uR[q] - uL[q])) * inv
  }
}

export class CpuSWE {
  readonly eta: Float64Array
  readonly m: Float64Array
  time = 0
  private readonly k1e: Float64Array
  private readonly k1m: Float64Array
  private readonly u1e: Float64Array
  private readonly u1m: Float64Array

  constructor(
    readonly grid: CubeGrid,
    /** Bed elevation per cell (m). */
    readonly bed: Float64Array,
    readonly p: SWEParams = DEFAULT_PARAMS,
  ) {
    const n = grid.cells
    this.eta = Float64Array.from(bed)
    this.m = new Float64Array(n * 3)
    this.k1e = new Float64Array(n)
    this.k1m = new Float64Array(n * 3)
    this.u1e = new Float64Array(n)
    this.u1m = new Float64Array(n * 3)
  }

  /** Heun step: U1 = U + dt L(U); U ← ½U + ½(U1 + dt L(U1)); then friction. */
  step(dt: number) {
    const { eta, m, k1e, k1m, u1e, u1m } = this
    const n = this.grid.cells
    rhs(this.grid, this.bed, eta, m, k1e, k1m, this.p)
    for (let c = 0; c < n; c++) {
      u1e[c] = eta[c] + dt * k1e[c]
      for (let q = 0; q < 3; q++) u1m[c * 3 + q] = m[c * 3 + q] + dt * k1m[c * 3 + q]
    }
    postProcess(this.grid, this.bed, u1e, u1m, this.p)
    rhs(this.grid, this.bed, u1e, u1m, k1e, k1m, this.p)
    for (let c = 0; c < n; c++) {
      eta[c] = 0.5 * eta[c] + 0.5 * (u1e[c] + dt * k1e[c])
      for (let q = 0; q < 3; q++) m[c * 3 + q] = 0.5 * m[c * 3 + q] + 0.5 * (u1m[c * 3 + q] + dt * k1m[c * 3 + q])
    }
    postProcess(this.grid, this.bed, eta, m, this.p)
    friction(this.bed, eta, m, dt, this.p)
    this.time += dt
  }

  /** Total water volume (m³) for radius R. */
  volume(R: number): number {
    let v = 0
    for (let c = 0; c < this.grid.cells; c++) v += Math.max(0, this.eta[c] - this.bed[c]) * this.grid.solidAngle[c] * R * R
    return v
  }
}

/** Time derivative of (η, m) for every cell. */
export function rhs(g: CubeGrid, B: Float64Array, eta: Float64Array, m: Float64Array, de: Float64Array, dm: Float64Array, p: SWEParams) {
  const flux = new Float64Array(4)
  const fluxMass = new Float64Array(4)
  const sides = { c: blankSide(), o: blankSide() }
  for (let c = 0; c < g.cells; c++) {
    let ae = 0
    let ax = 0
    let ay = 0
    let az = 0
    for (let k = 0; k < 4; k++) {
      const e = c * 4 + k
      const o = g.nb[e]
      const bk = g.back[e]
      const cm = g.nb[c * 4 + OPPOSITE[k]]
      const op = g.nb[o * 4 + OPPOSITE[bk]]
      faceStates(B, eta, m, cm, c, o, op, p, sides.c, sides.o)
      const nx = g.normal[e * 3]
      const ny = g.normal[e * 3 + 1]
      const nz = g.normal[e * 3 + 2]
      // Momentum: own perspective. Subtracting the cell-centre pressure (with the face bed)
      // is the well-balanced bed source: it cancels the flux exactly for a lake at rest,
      // while F − p_c ≈ g·h·(η_face − η_c) gives the pressure gradient.
      hll(sides.c, sides.o, nx, ny, nz, p, flux, eta[c], sides.c.bf)
      // Mass: canonical orientation (lower id = left) so both cells get identical fluxes.
      let mass: number
      if (c < o) mass = flux[0]
      else {
        hll(sides.o, sides.c, -nx, -ny, -nz, p, fluxMass)
        mass = -fluxMass[0]
      }
      const la = g.lenOverArea[e]
      ae -= la * mass
      ax -= la * flux[1]
      ay -= la * flux[2]
      az -= la * flux[3]
    }
    if (p.coriolis) {
      const f2 = 2 * p.omega
      ax += f2 * m[c * 3 + 1]
      ay -= f2 * m[c * 3]
    }
    // Keep the tendency tangent.
    const cx = g.center[c * 3], cy = g.center[c * 3 + 1], cz = g.center[c * 3 + 2]
    const r = ax * cx + ay * cy + az * cz
    de[c] = ae
    dm[c * 3] = ax - r * cx
    dm[c * 3 + 1] = ay - r * cy
    dm[c * 3 + 2] = az - r * cz
  }
}

function blankSide(): Side {
  return { h: 0, eta: 0, bf: 0, ux: 0, uy: 0, uz: 0 }
}

/** Reconstructed face states of cell c and neighbour o (lines cm–c–o and op–o–c), after HR. */
export function faceStates(B: Float64Array, eta: Float64Array, m: Float64Array, cm: number, c: number, o: number, op: number, p: SWEParams, sc: Side, so: Side) {
  const rec = (a: number, b: number, d: number, out: number[]) => {
    // Value of b reconstructed toward d (line a–b–d); first order next to dry cells.
    const wet = eta[a] - B[a] > p.hEps && eta[b] - B[b] > p.hEps && eta[d] - B[d] > p.hEps
    out[0] = eta[b] + (wet ? 0.5 * minmod(eta[b] - eta[a], eta[d] - eta[b]) : 0)
    for (let q = 0; q < 3; q++) {
      const mb = m[b * 3 + q]
      out[q + 1] = mb + (wet ? 0.5 * minmod(mb - m[a * 3 + q], m[d * 3 + q] - mb) : 0)
    }
  }
  const rc = [0, 0, 0, 0]
  const ro = [0, 0, 0, 0]
  rec(cm, c, o, rc)
  rec(op, o, c, ro)
  const bf = Math.max(B[c], B[o])
  setSide(sc, rc, B[c], bf, p)
  setSide(so, ro, B[o], bf, p)
}

function setSide(s: Side, r: number[], bCell: number, bf: number, p: SWEParams) {
  const hRec = Math.max(0, r[0] - bCell)
  const h = Math.max(0, r[0] - bf)
  // Liang & Marche: where the face bed is above the water, lower it to the water level.
  s.bf = Math.min(bf, r[0])
  s.h = h
  // η* = h* + B_f,side is exactly the reconstructed η (wet: η; dry face: B_f,side = η).
  // Using it directly keeps the rest state bit-exact in float32.
  s.eta = r[0]
  // Desingularised velocity from the reconstructed momentum and depth.
  const h4 = hRec ** 4
  const inv = hRec > 0 ? (Math.SQRT2 * hRec) / Math.sqrt(h4 + Math.max(h4, p.hEps ** 4)) : 0
  s.ux = r[1] * inv
  s.uy = r[2] * inv
  s.uz = r[3] * inv
}

/** Positivity, dry cells, tangent projection and speed limit. */
export function postProcess(g: CubeGrid, B: Float64Array, eta: Float64Array, m: Float64Array, p: SWEParams) {
  for (let c = 0; c < g.cells; c++) {
    if (eta[c] < B[c]) eta[c] = B[c]
    const h = eta[c] - B[c]
    if (h < p.hDry) {
      m[c * 3] = m[c * 3 + 1] = m[c * 3 + 2] = 0
      continue
    }
    const cx = g.center[c * 3], cy = g.center[c * 3 + 1], cz = g.center[c * 3 + 2]
    let mx = m[c * 3], my = m[c * 3 + 1], mz = m[c * 3 + 2]
    const r = mx * cx + my * cy + mz * cz
    mx -= r * cx
    my -= r * cy
    mz -= r * cz
    const sp = Math.hypot(mx, my, mz)
    const lim = p.uMax * h
    const s = sp > lim ? lim / sp : 1
    m[c * 3] = mx * s
    m[c * 3 + 1] = my * s
    m[c * 3 + 2] = mz * s
  }
}

/** Semi-implicit Manning friction: m ← m / (1 + dt·g·n²·|u| / h^{4/3}). */
export function friction(B: Float64Array, eta: Float64Array, m: Float64Array, dt: number, p: SWEParams) {
  if (p.manning <= 0) return
  const k = p.g * p.manning * p.manning
  for (let c = 0; c < B.length; c++) {
    const h = eta[c] - B[c]
    if (h < p.hDry) continue
    const sp = Math.hypot(m[c * 3], m[c * 3 + 1], m[c * 3 + 2]) / h
    const d = 1 + (dt * k * sp) / h ** (4 / 3)
    m[c * 3] /= d
    m[c * 3 + 1] /= d
    m[c * 3 + 2] /= d
  }
}

/** Largest stable time step for CFL number `cfl` given the deepest water (m). */
export function stableDt(g: CubeGrid, maxDepth: number, cfl = 0.45, p: SWEParams = DEFAULT_PARAMS): number {
  let minLen = Infinity
  for (let e = 0; e < g.cells * 4; e++) minLen = Math.min(minLen, 1 / g.lenOverArea[e])
  // 1/(ℓ/A) is a width measure; for quads width ≈ A/ℓ.
  return (cfl * minLen) / (Math.sqrt(p.g * maxDepth) + p.uMax / 3)
}
