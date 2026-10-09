# Performance & reach (M7)

## Measured
| Item | Result |
|---|---|
| SWE solver, 1.57 M cells (Medium) | 2.5 ms/step WebGPU (M-series), 3.7 ms/step WebGL2 |
| Globe + sim, ×3000 warp | 60 fps (Mac, WebGPU and WebGL2) |
| High tier + LOD mesh | 60 fps at regional views |
| Real-GPU test suite | 16/16 on NVIDIA RTX 3070 (Linux Chrome, Vulkan WebGPU), via `GPU=linux npx playwright test` on obsidian |
| CI config (SwiftShader) | full suite passes, ~6 min |
| Start-up at 20 Mbit/s (dev server) | globe visible 7.4 s with progressive start (vs 11.7 s), Medium imagery at 13.5 s |

## Mechanisms
- **Tier pick** (`src/core/quality/tiers.ts`): `?tier`, else remembered choice, else phones / WebGL2 → Low,
  otherwise Medium. High (61 MB) only on request (Quality menu).
- **AutoTune** (`src/core/quality/autoTune.ts`): smoothed frame time; over budget (18.5 ms) for 1.5 s →
  render scale ×0.85 (down to 0.6), then fewer sim steps per frame; recovers every 6 s with headroom.
  The panel's Perf line shows fps, render scale and the effective sim speed.
- **Progressive start:** Low imagery + target-tier simulation first, full imagery swapped in.
- **Chunked LOD** (`src/render/globe/lodSphere.ts`): instanced 32² patches per face quadtree with skirts and
  horizon culling.

## Limits / next
- **Close zoom** (down to 80 km on Medium/High) streams 500 m imagery tiles (see DATA.md). It runs at 60 fps with
  ~150 tiles resident. Remaining limits: terrain relief comes from 2048² faces (≈5 km), and clouds
  come from a 2048-px source, so they thin out close up.
- **High-tier terrain is 45 MB** (RGBA16F at 2048²). Split B (R16F) from E/L/I at lower resolution.
- **takram WebGL2 shader error** (`AtmosphereParameters` struct missing in one GLSL vertex shader).
  Harmless on Mac and NVIDIA; to report upstream.
- **Not done:** sim memory compaction (face-symmetric geometry tables, needed for a 1024² sim grid),
  workgroup-tiled kernels, Safari/iOS and Android device testing.
