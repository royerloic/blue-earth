# Shallow-water numerics

Implementation: `src/sim/swe.ts` (float64 reference). The GPU kernels mirror it line by line.

## Grid
Equiangular cube, 6·N² cells (`src/sim/grid.ts`). Per cell: centre direction, solid angle, and for
each of the 4 edges (+s, −s, +t, −t): neighbour id, the neighbour's direction index pointing back
(it differs across face seams), the outward unit normal (tangent at the edge midpoint) and the
edge length. Shared edges are made exactly antisymmetric, with the lower cell id canonical.

## Equations and state
Nonlinear SWE on the sphere. State per cell: η (free surface, m) and m = h·u as a 3D Cartesian
vector in the tangent plane. That means no metric terms and no vector rotation across face seams;
the tendency is projected onto the tangent plane every stage.

## Spatial scheme, per cell c and edge k toward neighbour o
1. **MUSCL/minmod** on η and m along the lines cm–c–o and op–o–c (cm, op = far neighbours
   along the same line, using `back` across seams). First order next to dry cells (h < 5 cm).
2. **Hydrostatic reconstruction:** B_f = max(B_c, B_o), h* = max(0, η_rec − B_f). Liang &
   Marche bed lowering: where B_f exceeds the reconstructed water level, B_f,side = η_rec.
3. **η-form pressure** p = ½g(η² − 2ηB) in an **HLL** flux (Einfeldt wave speeds).
   Both-dry faces: zero mass flux, own pressure only.
4. **Mass flux canonical:** computed with the lower id as the left state, so the two cells
   get bit-identical, opposite fluxes (exact volume conservation).
5. **Momentum:** dm = −Σ (ℓ/A)(F_m − p_c n) with p_c = ½g(η_c² − 2η_c B_f,c), using the
   *cell-centre* η_c. This is the well-balanced bed source. At rest F_m = p_c n exactly, on any
   geometry and next to dry islands. (Using the reconstructed face η here cancels most of the
   pressure gradient and made waves 1/√3 too slow; caught by the wave-speed test.)
6. **Coriolis:** −2Ω×m.

## Float32 (GPU) details
- The face level is η* = η_rec exactly (algebraically h* + B_f,side). Computing the sum instead
  rounds and breaks the rest state.
- Pressures enter HLL relative to the cell-centre reference, written in differences:
  ½g[(e−e_r)(e+e_r) − 2((e−e_r)·b + e_r·(b−b_r))]. This is exactly 0 at rest regardless of FMA
  contraction. Subtracting two separately rounded pressures left |m| ≈ 1e-3 m²/s.
- Mass flux: both cells compute the same HLL call with the lower texel index as left, then negate.

## Time stepping and source terms
SSP-RK2 (Heun). After each stage: η ≥ B, m = 0 in dry cells (h < 1 mm), tangent projection,
|u| ≤ 30 m/s. After the step: semi-implicit Manning friction (n = 0.025).

## Verified (tests/unit/swe.test.ts)
| Test | Result |
|---|---|
| Lake at rest at +50 m, random bathymetry and dry islands, 100 steps | \|Δη\| < 1e-9, \|m\| < 1e-8 |
| Volume conservation, 200 steps | < 1e-12 relative |
| Wave speed, 4000 m flat bed, N = 48 (≈200 km cells), gauges 2000/4500 km | 203.2 m/s vs √(gh) = 198.1 (+2.5%) |
| Isotropy: diagonal and cube-corner source | 201.9 / 203.2 m/s |
| 30 m wave over random islands and beaches, 300 steps | finite, h ≥ 0, volume within 1e-6 |

To do: dam-break (Ritter, Stoker), Thacker bowl, Synolakis run-up, Williamson TC2, GPU parity.
