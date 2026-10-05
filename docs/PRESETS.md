# Historical tsunami presets

Sources: `src/sim/presets/historical.ts`. Seafloor uplift: Okada (1985) rectangular dislocations
(`src/sim/okada.ts`), validated against Okada's DC3D (okada_wrapper) on 200 random faults to <1e-6
relative (`tests/unit/okada.test.ts`). The uplift is added to the sea surface at t = 0
(instantaneous rupture, long-wave approximation).

**These are simplified source models:** a few trench-following planar segments with uniform slip,
of the right order for each event's length, width, slip and geometry. They are not the published
finite-fault inversions; replacing them with USGS finite-fault models is a planned upgrade.

| Preset | Segments | Peak uplift | Check vs observations |
|---|---|---|---|
| 2004 Sumatra–Andaman, Mw 9.1 | 5 × ~250 km, dip 12°, slip 15→5 m | +6.4 / −3.1 m | Arrival (first 5 cm at the nearest wet sim cell, MC limiter): see the GPU test; observed ≈ Sri Lanka 2 h, Phuket 2 h, Chennai 2.5 h, Malé 3.3 h, Somalia 7 h |
| 2011 Tōhoku, Mw 9.0 | near-trench 200×80 km, 35 m + deeper 400×120 km, 8 m | +14.2 / −4.2 m | (1 cm threshold) Honolulu 7.4 h (obs. ~7.5–8 h), Crescent City 9.6 h (~9.5–10 h), Talcahuano 22.4 h (~21–22 h) |
| 1960 Valdivia, Mw 9.5 | 2 segments, 950 km, 20–25 m | | |
| 1964 Alaska, Mw 9.2 | 2 segments | | |
| 2010 Maule, Mw 8.8 | 1 segment, 500×150 km, 10 m | | |
| Cascadia M9 (scenario) | 2 × 500 km, 18 m | | |
| Asteroid impact | toy Gaussian cavity −300 m | | |

**Known limitation:** far-field amplitudes are several times too small (Tōhoku at Honolulu offshore:
7 cm modelled vs ~0.3 m observed in deep water). This is numerical dissipation of the 2nd-order
scheme on ~20 km cells over thousands of kilometres. Arrival times and directivity are good.
Switching the limiter from minmod to MC halved the dissipation and made arrivals detectable.
A higher-order scheme, a finer High tier, or nested grids would improve amplitudes.

The on-screen arrival map uses a 1 cm threshold relative to the state right after the source was applied, so the static far-field deformation is not counted as the wave.
