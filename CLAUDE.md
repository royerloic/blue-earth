# Blue Earth (2026): working notes for Claude

A physically based 3D web remake of Loic Royer's 2004 Java demo *Blue Earth*. The original is a flat-map
ripple/tsunami toy at `~/workspace/java/computergraphics/BlueEarth` (core: `src/blueearth/BlueEarth.java`).
- **Live:** https://royerloic.github.io/blue-earth/
- **Repo:** public `github.com/royerloic/blue-earth`, branch `main`.
- **Deploy:** GitHub Actions on every push to `main` (CI plus a Pages deploy).

Read the README first (features, run, controls, URL options, tests). For depth, see docs/:
- PLAN: the original approved plan and milestones M0–M8.
- ARCHITECTURE.
- NUMERICS: the SWE scheme.
- DATA: sources, layers, rules.
- PRESETS: Okada sources.
- PERF: measurements and limits.
- M0-SPIKES.

## Goals and decisions (made by the user; don't re-litigate)
- **Two goals:** stunning visuals and real physics. The physics is GPU nonlinear shallow water on real
  bathymetry, waves at √(g·h).
- **Faithful to 2004.** Draining intro (sea level falls to today), click to make waves, hold for an
  oscillating source, sun control, sea-level control. There is also a **Classic 2004** mode (C), which
  is bit-exact with the Java original.
- **Hardware:** desktop WebGPU first. Tiers scale down to phones. The **WebGL2 fallback is "Lite but
  real"**: the same simulation at Low/Medium.
- **Controls:** Explorer by default. **K** = Classic controls (pointer = sun, right-drag = orbit).
- **Keys:** Space = fullscreen, C = Classic 2004 and back, H = collapse the panel.
- **Panel:** **collapsed by default**; the choice is saved in localStorage
  `blue-earth.panel-collapsed.v2`. The `.v2` suffix makes earlier saved "open" choices ignored. **If a
  default changes again, bump the storage key.**
- **Close zoom** to 80 km with streamed 500 m tiles.
- **Hosting:** GitHub Pages serves Low, Medium, High and the tiles.

## Working with this user
- Plan carefully before large changes.
- **Double-check everything** (tests, QA scripts, the live site) before calling something done. Report
  failures honestly.
- They often ask to see the result: `open -a "Google Chrome" https://royerloic.github.io/blue-earth/`.
  Mention Cmd+Shift+R, since Pages caches for 10 min.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Never force-push.**
- Avoid glob deletes (`rm -f *`); delete explicit paths or use `mktemp -d`.
- Python: only the project venv (`cd pipeline && uv add --dev …`), never conda base.

## Stack (pinned on purpose)
- **Vite 7 + TypeScript 5.9.**
- **three 0.184.0** with `WebGPURenderer` and TSL. One code path compiles to WGSL (WebGPU) or GLSL
  (WebGL2, via `?backend=webgl2` or automatically). **Keep three at 0.184.** `@takram/three-atmosphere`
  0.19.1 breaks on r186.
- postprocessing 6.39.5, tweakpane 4.0.5.
- **Tests:** vitest 4 (unit), Playwright 1.63 (GPU tests in real Chrome).
- **Data pipeline:** Python with uv in `pipeline/`. KTX-Software 4.4.2 is extracted (not installed)
  into `.tools/`, which is gitignored; re-download the macOS arm64 pkg from KhronosGroup releases if it
  is missing.

## Code map
- **`src/app/modes/GlobeMode.ts`:** the app. Input, intro, HUD wiring, presets, kiosk (90 s idle),
  gauges, render loop.
- **`src/app/modes/ClassicMode.ts`:** the 2004 mode.
- **`src/sim/`:**
  - `swe.ts`: CPU float64 reference.
  - `SWESolver.ts`: GPU solver.
  - `OceanSim.ts`: drops, presets, max/arrival maps.
  - `okada.ts`: fault sources.
  - `grid.ts`.
  - `executor/`: `ComputeExecutor` (WebGPU compute) and `RTTExecutor` (WebGL2 render-to-texture),
    with the same kernels.
- **`src/render/globe/`:**
  - `globeMaterial.ts`: water and land shading.
  - `lodSphere.ts`: chunked LOD, instanced 32² patches, skirts, frustum and horizon culling.
  - `tileCache.ts`: a 128-layer LRU texture array for the 500 m tiles.
  - `cubeSphere.ts`.
- `src/render/atmosphere/`: takram wiring.
- **`src/core/`:**
  - `renderer.ts`: backend pick.
  - `quality/tiers.ts`: `?tier`, then the saved `blue-earth.tier`, then phone/WebGL2 → Low, else Medium.
  - `quality/autoTune.ts`: render scale, then sim steps.
  - `assets/ktx2.ts`: a single shared KTX2 loader.
  - `geo/`: EAC cube math, picking.
  - `time/solar.ts`.
- **`src/ui/`:**
  - `hud.ts`: the panel; button rows are `<div>`, not `<label>`.
  - `keys.ts`: `ignoreShortcut`, which skips modifiers and form fields.
  - `gauges.ts`.
- `src/classic/`: bit-exact port (Java `Random`, mouse script, CPU reference, GPU).
- `pipeline/blueearth_pipeline/`: `build.py` (tiers), `tiles.py` (500 m tiles), `dem.py`,
  `floodlevel.py`, `resample.py`, `encode.py`.

## Physics and rendering insights (hard-won)
- **Grid and scheme.** Equiangular cubed sphere; finite volumes with an MC limiter and hydrostatic
  reconstruction; η-form HLL with canonical mass flux; Heun time stepping; Manning friction. The lake
  at rest is float32-exact. Details: NUMERICS.md.
- **`dampingTime` = 86400 s.**
- **Drops.** Drops are **volume-neutral "Mexican hats"** normalized to the peak, radius 5 cells,
  amplitude scale 0.75. Positive-only drops left a permanent bulge that looked milky.
- **Water colour.**
  - Wave normals come from the **anomaly** (η − rest), never the full surface.
  - Absorption must stay gentle, or flooded seas go dark.
  - Waves get a teal tint taken from the water's own colour, not white.
- **Zagros "pits"** came from steep sub-grid slopes. They're fixed with a 3-texel stencil plus a soft
  slope cap.
- **Coast artifacts (Greece) had three causes:**
  - Off-screen LOD patches starved the tile cache; fixed with frustum culling.
  - Normals came from the full surface instead of the anomaly.
  - The seasonal tile blend must be additive (tile + month albedo − July albedo), and only where
    tile and global map agree on land/water.
- **Tile alpha.** The land mask in tile alpha is 200..255, never 0, because browsers premultiply and
  would destroy the RGB.
- **Marine basins behind sub-grid straits** (Sea of Marmara, fjords) get a −30 m sill in
  `open_marine_basins` (`dem.py`). The Jordan rift / Dead Sea are correctly dry.
- **"Sim time" means time since the last event** (drop or preset), not wall time.

## Data and releases
- **Location.** `public/data/` is built by the pipeline and is **not in git**. Rebuild:
  `cd pipeline && uv run python -m blueearth_pipeline.build [high]`. Close-zoom tiles:
  `… -m blueearth_pipeline.tiles`.
- **Tier sizes:** Low 5 MB, Medium 19 MB, High ~61 MB, tiles 52 MB (3771 WebP).
- **Published as GitHub Release `data-v2`** (manifest `version: 2`). `deploy.yml` downloads
  `DATA_TAG` and `PAGES_TIERS`.
- **To change data:**
  1. Bump the manifest version.
  2. Run `tools/release-data.sh --publish`, which creates `data-v<N>`.
  3. Set `DATA_TAG` in `.github/workflows/deploy.yml`.
  4. Push.
  Never mutate an existing release; check that the release matches a fresh build byte for byte.

## Testing (run before calling anything done)
- `npm run typecheck && npm test`: unit tests (numerics, Okada vs DC3D, cube geometry, bit-exact
  Classic, AutoTune…).
- **`npx playwright test`:** 29 GPU tests in real Chrome (Metal), plus visual baselines (**darwin
  only**; other platforms skip them). CI runs the suite on SwiftShader (~6 min). `npm run test:prod`
  tests the built site.
- **Real NVIDIA GPU:**
  1. `ssh obsidian`; a portable node is at `/tmp/be-ci/node` and a repo copy at `/tmp/be-ci/repo`
     (rsync it). `/tmp` may have been wiped; if so, re-create both.
  2. Run `GPU=linux npx playwright test` (RTX 3070, Vulkan WebGPU).
  The link is flaky (ssh/rsync exit 255); just retry.
- **QA scripts** (`node tools/<x>.mjs [url]`, default the live site):
  - `interact`: 37 checks of every control.
  - `sweep`: 20 configs.
  - `browsers`: Playwright Firefox + WebKit, both of which run WebGL2.
  - `mobile`, `memory`, `offline`, `shot`, `drop-at`, `drop-check`, `fps`, `throttle`.
  - **`safari`:** real Safari via safaridriver (setup steps in the file header).
- **After a push:**
  1. `gh run list --limit 2` until CI and Deploy are `success`.
  2. Run `node tools/interact.mjs` against the live site.
  3. Verify with a fresh profile **and** with stale localStorage.
- **Lesson:** fresh test profiles hide saved-preference bugs. The "panel not collapsed" report came
  from an old saved choice.

## Safari status (open as of 2026-10-17)
- **Report:** a colleague said "doesn't work in Safari, only Chrome". Details (macOS version, symptom)
  have not arrived yet.
- **Safari 26.6 on macOS 15 (this Mac): works.** It has **no WebGPU** (`navigator.gpu` is undefined),
  so it runs the WebGL2 path. Rendering runs at 60 fps, drops work, and frames look the same as
  Chrome's `?backend=webgl2`.
- **Likely culprit: Safari 26 on macOS 26 (Tahoe)**, which enables WebGPU by default and so runs the
  **WebGPU path, never tested in Safari**. Suspects:
  - storage-texture formats or read-write access;
  - float32 filtering;
  - BC/ETC KTX2 formats;
  - WGSL strictness.
- **To reproduce here:** Safari → Settings → Feature Flags → enable WebGPU, then run
  `safaridriver -p 4444 &` and `node tools/safari.mjs`.
- **Fallback if a WebGPU fix is hard:** route Safari to WebGL2 in `src/core/renderer.ts`.
- **Safari WebDriver limits:**
  - Pointer actions never reach the page, even on example.com; use synthetic `PointerEvent`s.
  - Console output can only be captured after navigation.

## Known open / minor items
- Black or partial frames for a few seconds at start-up.
- City lights are soft close up (3 km source).
- At the Low tier, a 20 m drop reads as a pale donut early on.
- Far-field tsunami amplitudes are too small (numerical dissipation plus damping).
- Harmless takram WebGL2 shader error: `'AtmosphereParameters' : syntax error` in one vertex shader
  (Mac, NVIDIA and Safari all render fine). Worth reporting upstream.
- A few cut-off fjord cells remain.
- Not yet tested: a real phone, Safari with WebGPU, Windows.
- Ideas from PERF.md: split High-tier terrain (45 MB RGBA16F), sim memory compaction for a 1024² grid,
  workgroup-tiled kernels.
