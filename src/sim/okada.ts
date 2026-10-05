/**
 * Okada (1985) surface displacement of a rectangular dislocation in an elastic half-space,
 * vertical component only (what lifts the sea surface). Formulas as in Okada (1985),
 * BSSA 75(4), arranged after F. Beauducel's okada85; validated against Okada's DC3D
 * (okada_wrapper) in tests/unit/okada.test.ts.
 */

const EPS = 1e-14

/** I4 and I5 terms of Okada (1985). */
function I4(db: number, eta: number, q: number, cd: number, sd: number, nu: number, R: number) {
  return Math.abs(cd) > EPS
    ? ((1 - 2 * nu) / cd) * (Math.log(R + db) - sd * Math.log(R + eta))
    : (-(1 - 2 * nu) * q) / (R + db)
}

function I5(xi: number, eta: number, q: number, cd: number, sd: number, nu: number, R: number, db: number) {
  const X = Math.sqrt(xi * xi + q * q)
  if (Math.abs(cd) > EPS) {
    if (Math.abs(xi) < EPS) return 0
    return ((1 - 2 * nu) * 2) / cd * Math.atan((eta * (X + q * cd) + X * (R + X) * sd) / (xi * (R + X) * cd))
  }
  return (-(1 - 2 * nu) * xi * sd) / (R + db)
}

const atanSafe = (a: number, b: number) => (Math.abs(b) < EPS ? 0 : Math.atan(a / b))

function uzSS(xi: number, eta: number, q: number, cd: number, sd: number, nu: number) {
  const R = Math.sqrt(xi * xi + eta * eta + q * q)
  const db = eta * sd - q * cd
  return (db * q) / (R * (R + eta)) + (q * sd) / (R + eta) + I4(db, eta, q, cd, sd, nu, R) * sd
}

function uzDS(xi: number, eta: number, q: number, cd: number, sd: number, nu: number) {
  const R = Math.sqrt(xi * xi + eta * eta + q * q)
  const db = eta * sd - q * cd
  return (db * q) / (R * (R + xi)) + sd * atanSafe(xi * eta, q * R) - I5(xi, eta, q, cd, sd, nu, R, db) * sd * cd
}

function uzTF(xi: number, eta: number, q: number, cd: number, sd: number, nu: number) {
  const R = Math.sqrt(xi * xi + eta * eta + q * q)
  const db = eta * sd - q * cd
  return (
    ((eta * cd + q * sd) * q) / (R * (R + xi)) +
    cd * ((xi * q) / (R * (R + eta)) - atanSafe(xi * eta, q * R)) -
    I5(xi, eta, q, cd, sd, nu, R, db) * sd * sd
  )
}

/**
 * Vertical surface displacement in Okada's fault frame: x along strike from the fault's
 * start, y perpendicular, fault bottom edge at depth d (> 0) on the x axis, rising toward
 * +y at dip δ; length L, down-dip width W; U1 strike-slip, U2 dip-slip, U3 opening.
 */
export function okadaUz(x: number, y: number, d: number, dipDeg: number, L: number, W: number, U1: number, U2: number, U3: number, nu = 0.25): number {
  const dip = (dipDeg * Math.PI) / 180
  const cd = Math.cos(dip)
  const sd = Math.sin(dip)
  const p = y * cd + d * sd
  const q = y * sd - d * cd
  const ch = (f: typeof uzSS) => f(x, p, q, cd, sd, nu) - f(x, p - W, q, cd, sd, nu) - f(x - L, p, q, cd, sd, nu) + f(x - L, p - W, q, cd, sd, nu)
  return (-U1 / (2 * Math.PI)) * ch(uzSS) - (U2 / (2 * Math.PI)) * ch(uzDS) + (U3 / (2 * Math.PI)) * ch(uzTF)
}

/** One planar fault segment in geographic terms (top-edge midpoint, Aki–Richards angles). */
export interface FaultSegment {
  /** Top-edge midpoint (degrees). */
  lat: number
  lon: number
  /** Depth of the top edge (m). */
  top: number
  strike: number
  dip: number
  rake: number
  /** Along-strike length and down-dip width (m). */
  length: number
  width: number
  /** Slip (m). */
  slip: number
}

const R_EARTH = 6_371_000

/**
 * Seafloor uplift (m) at (lat, lon) from a segment. Uses a local tangent plane at the segment
 * centroid (fine for segments ≲ 500 km), then Beauducel's centroid → Okada frame transform.
 */
export function segmentUplift(seg: FaultSegment, lat: number, lon: number, nu = 0.25): number {
  const rad = Math.PI / 180
  const st = seg.strike * rad
  const dp = seg.dip * rad
  // Centroid: half the width down-dip from the top-edge midpoint (dip direction = strike + 90°).
  const hx = Math.cos(st) // east component of the dip direction
  const hy = -Math.sin(st) // north component
  const off = (seg.width / 2) * Math.cos(dp)
  const cLat = seg.lat + ((hy * off) / R_EARTH) / rad
  const cLon = seg.lon + ((hx * off) / (R_EARTH * Math.cos(seg.lat * rad))) / rad
  const depth = seg.top + (seg.width / 2) * Math.sin(dp)
  // Point in local east/north metres from the centroid.
  let dLon = lon - cLon
  dLon -= 360 * Math.round(dLon / 360)
  const e = dLon * rad * R_EARTH * Math.cos(cLat * rad)
  const n = (lat - cLat) * rad * R_EARTH
  // Beauducel okada85: centroid frame → Okada's frame.
  const W = seg.width
  const L = seg.length
  const d = depth + (Math.sin(dp) * W) / 2
  const ec = e + (Math.cos(st) * Math.cos(dp) * W) / 2
  const nc = n - (Math.sin(st) * Math.cos(dp) * W) / 2
  const x = Math.cos(st) * nc + Math.sin(st) * ec + L / 2
  const y = Math.sin(st) * nc - Math.cos(st) * ec + Math.cos(dp) * W
  const rk = seg.rake * rad
  return okadaUz(x, y, d, seg.dip, L, W, Math.cos(rk) * seg.slip, Math.sin(rk) * seg.slip, 0, nu)
}
