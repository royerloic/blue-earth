# Architecture

```
src/main.ts                 mode switch (?mode=classic), Space = fullscreen, lazy mode chunks
src/app/modes/GlobeMode.ts  the globe: data, ocean, rendering, controls, HUD, intro, presets, kiosk
src/app/modes/ClassicMode.ts the bit-exact 2004 mode
src/core/
  renderer.ts               WebGPURenderer (WebGL2 fallback, ?backend=webgl2)
  assets/                   KTX2 face arrays (Basis + R16F/RGBA16F loader), manifest/tier loading
  geo/                      equiangular cube mapping (CPU + TSL), picking, units
  quality/                  tier pick, AutoTune
  time/solar.ts             sun/moon/ECI→ECEF (takram), monthly albedo weights
src/sim/
  executor/                 one gather-kernel API → WebGPU compute or render-to-texture (WebGL2 too)
  grid.ts                   cube FV grid: neighbours, back directions, edge normals/lengths, areas
  swe.ts                    float64 reference shallow-water solver (tests)
  SWESolver.ts              GPU solver: Heun stages, sea level, impulses, Okada add, diagnostics, gauges
  OceanSim.ts               real-world ocean: bathymetry, display atlases with gutters, time warp
  okada.ts, presets/        earthquake sources
src/render/
  globe/                    globe material (terrain, water optics, overlays), LOD mesh, cube-sphere
  atmosphere/               takram context + post (aerial perspective, bloom, AgX)
src/classic/                Java-faithful CPU port, GPU kernels, inputs, java.util.Random
src/ui/                     HUD, tide-gauge panel, toast
pipeline/                   Python data pipeline (downloads, cube faces, flood level, lakes, KTX2)
tools/                      golden-frame harness, screenshot/benchmark scripts, data release
tests/unit, tests/gpu       vitest and Playwright suites (+ visual baselines)
```

## Data flow per frame
Input → `OceanSim.advance` (k Heun steps; sources applied first) → display pass (wave anomaly,
depth, η, speed into a gutter atlas) → diagnostics view every 4 frames → globe material (LOD patches;
vertex: relief and wave displacement; fragment: water rule at sea level S, optics, overlays, clouds,
lights) → takram aerial perspective (sky, sun, stars) → bloom → AgX.

## Key invariants
- **Cell id** = face·N² + j·N + i. The atlas texel is ((f % 3)·N + i, ⌊f/3⌋·N + j). The same EAC
  mapping is used by pipeline (Python), CPU and TSL; it is fixture-tested.
- **Mass flux** is computed canonically (lower id on the left), so it is exactly conservative.
  Pressure terms are written in difference form, so the rest state is exact in float32.
- **WebGL coordinate convention:** three flips `screenCoordinate.y` and render-target `textureLoad`,
  but not data textures (see M0-SPIKES.md).
