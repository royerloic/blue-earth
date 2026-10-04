# M0 spike results (2026-10-04)

All spikes are reproducible: `npm run dev`, then `/spikes/?spike=<a|c|d>[&backend=webgl2]`,
or `npx playwright test` (CI runs them on SwiftShader).

| Spike | Result | Notes |
|---|---|---|
| a. TSL compute → rgba32f storage texture + readback | **GO** | Max err vs Float32 CPU ref 2.8e-6. |
| b. Same kernel via render-to-texture (WebGPU and WebGL2) | **GO** | Same error. three flips `screenCoordinate.y` on WebGL but not `texelFetch`; RTTExecutor undoes it. |
| c. takram Bruneton atmosphere, whole globe from orbit | **GO** | 60 fps (vsync-capped) on M-series. **Requires three 0.184** (takram 0.19.1 breaks on r186). Also renders on WebGL2, with one shader compile error to investigate. Grain from raymarching needs TAA (as in takram's examples). |
| d. KTX2 ETC1S/UASTC/R16F+zstd | **GO, with layout change** | r184 WebGPU cannot upload `CompressedCubeTexture`, and KTX2Loader drops layers of uncompressed arrays. Use **6-layer 2D arrays** and our own R16F loader (`src/core/assets/ktx2.ts`). |
| e. EAC sampling | **GO** | Manual face select (`eacFaceST`), 4-texel gutters baked by the pipeline, LOD from screen-space derivatives of the direction (continuous across seams). Reprojection error: UASTC 0.005, ETC1S 0.009 mean linear RGB; R16F heights ~50 m (resolution-limited). |
| f. Headless WebGPU tests | **GO** | Chrome headless + Metal locally; Chromium + SwiftShader on Linux (37 s for the suite). |

Rough wall-clock throughput (1024², trivial 5-point stencil): compute 0.04 ms/step, RTT 0.03 ms/step on
WebGPU; RTT 0.2 ms/step on WebGL2. That leaves a large budget for the real MUSCL/HLL solver.

## Plan changes
- Pin **three 0.184.0** until takram supports newer releases.
- Static globe textures: **EAC 6-layer arrays with gutters**, not cube maps.
- TSL gotchas: `vec4(float, 1)` is an invalid constructor and silently draws nothing. Fullscreen
  passes into targets without depth need `depthTest = false`. Image textures are flipY'd (v = 0 at the bottom).
- Keep both executors. RTT is competitive on WebGPU, so the choice per kernel can be benchmark-driven.
