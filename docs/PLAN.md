# BlueEarth 2026 — modern 3D web remake: plan

## Context
`~/workspace/java/computergraphics/BlueEarth` holds Loic's 2004 Java demo/screensaver. It shows a flat world map with these features:
- a CPU 2-buffer ripple simulation (`h2 = (N+S+E+W)/2 − h2`);
- three shading cases: ocean, flooded land, dry land;
- `LightMapOcean.jpg` used as a lighting lookup table, with a "sun" that follows the mouse;
- an intro where the sea drains, click-to-make-waves, and a sea-level strip.

All mechanics live in `src/blueearth/BlueEarth.java` (lines 281–410).

I verified it runs:
- It compiles with Homebrew OpenJDK 27 if `OrionGraphicsOld.java` is excluded (that file uses `Thread.stop`).
- I built a headless harness in `/tmp/be`.

The goal is a modern, ultra-realistic, web-based 3D version.

**User decisions (fixed):**
- Stunning visuals AND real physics.
- Core 2004 mechanics on a 3D globe, plus a "Classic 2004" mode.
- New git repo, static site on GitHub Pages.
- Desktop WebGPU first, with quality tiers that scale down to phones.
- WebGL2 fallback = "Lite but real": the real simulation at Low/Medium.
- Orbital zoom in v1; regional zoom in a later milestone.
- Explorer controls by default, with a Classic toggle.
- Asset CDN: decide later. Build tiers behind `VITE_ASSET_BASE` and start Pages-only.

## Stack (confirmed by research, Oct 2026)
- **Core:** Vite + TypeScript + **three@0.184.0 pinned (takram 0.19.1 is built against 0.184; r186 breaks its TSL structs)**. Use `WebGPURenderer` with TSL (`three/webgpu`, `three/tsl`); it falls back to WebGL2 automatically.
- **No React/R3F:** vanilla TypeScript plus a tiny signals store. Hand-made HTML/CSS for the on-screen controls and readouts, with Tweakpane 4 for the expert panel.
- **Atmosphere:** `@takram/three-atmosphere@0.19.x` (MIT) through its `./webgpu` entry. Bruneton precomputed scattering, `skyBackground()`, stars, `AerialPerspectiveNode`. Backup: our own lite atmosphere written in TSL.
- **Data pipeline:** Python managed with `uv` (rasterio, xarray, numpy, numba, scipy, Pillow), plus KTX-Software `ktx` for KTX2 (Basis ETC1S/UASTC, R16F + zstd).
- **Browser support:** WebGPU ships in Chrome/Edge, Safari 26 (macOS/iOS) and Firefox on Windows/macOS. It is missing in Firefox on Linux/Android, which is why we need the WebGL2 path.
- **Kernel rule for WebGL2:** every simulation kernel is a per-cell **gather** written as a TSL `Fn`. One executor layer runs it as compute on WebGPU or as render-to-texture ping-pong on WebGL2. No scatter, atomics or shared memory in v1.

## Architecture (new repo `blue-earth/`; location to confirm, default `~/workspace/web/blue-earth`)
```
src/app/        App.ts, store.ts, urlState.ts, modes/{GlobeMode,ClassicMode,ScreensaverMode}.ts, intro/
src/core/       renderer.ts (backend probe), quality/{tiers,benchmark,autoTune}.ts,
                geo/{cubeEAC,picking}.ts, time/{simClock,solar}.ts, assets/{manifest,loader}.ts
src/sim/        SWESolver.ts, atlas.ts, executor/{Compute,RTT}Executor.ts,
                kernels/{halo,update,sources,seaLevel,derived,reduce}.ts, reference/cpuSolver.ts (f64), presets/
src/classic/    ClassicRipple.ts (i32 kernels), classicShade.ts, cpuReference.ts
src/render/     globe/, water/{waterShading,coxMunk,foam}.ts, atmosphere/, clouds/, night/, sky/, post/, overlays/
src/ui/         hud, title, seaLevelStrip, presets, timeControls, attributions, input/
public/classic/ original LightMapOcean.jpg, world.jpg, worldtopo.jpg
pipeline/       blueearth_pipeline/{download,dem,cube,floodlevel,imagery,nightlights,clouds,okada,classic,encode,manifest}.py
tests/          unit/ (vitest), gpu/ (playwright parity), visual/
tools/java-golden/  headless harness that runs the original Java → golden frames (based on /tmp/be/Headless.java)
docs/           ARCHITECTURE, NUMERICS, DATA (attribution), PERF
```
**Per frame:**
1. Input → store.
2. `SWESolver` runs k substeps; each is 2 RK stages plus halo exchange.
3. The `derived` pass writes an rgba16f display atlas: η, h, foam, max height, arrival time.
4. The globe material shades from that atlas plus the static data.
5. Aerial perspective → bloom → AgX tonemap.
6. HTML on-screen readouts and controls are drawn on top.

## Simulation
- **Grid:** an **equiangular cubed sphere**. Cell size varies only about 1.3× across a face, and there is no pole singularity. Momentum is stored as a **3D Cartesian tangent vector**, so halo exchange is a plain copy and Coriolis is `−2Ω×m`.
  - **Storage:** one 2D atlas of 3×2 faces with a 2-cell halo, `rgba32f`, state = (η, mx, my, mz). At N=1024 the atlas is 3084×2056, within the limits of both backends.
  - **Considered and rejected: Fibonacci-spiral / Voronoi grid.** It is more uniform: about 1.0–1.1× cell-size variation, versus 1.3× for the cube. But the result is unstructured:
    - polygonal cells with 5–7 neighbours, so neighbour lookups go through index lists;
    - TRiSK-style numerics (as in the MPAS climate model);
    - no texture atlas or bilinear sampling for rendering;
    - an awkward WebGL2 path.
    The only gain would be a time step about 25% larger. Not worth it.
  - **Geometry tables:** the per-face table (cell area, edge lengths, edge normals) is identical for all faces after rotation. Compute angles with `atan2(|a×b|, a·b)`.
- **Scheme:**
  - nonlinear shallow water in **pre-balanced η-form** (Liang & Marche), solved with finite volumes;
  - each step: MUSCL reconstruction (minmod) → hydrostatic reconstruction (Audusse) → HLL flux;
  - SSP-RK2 in place on 2 textures, CFL 0.45.
  - This is well-balanced, keeps depth non-negative and handles wet/dry fronts.
- **Wet/dry and damping:**
  - dry threshold 1e-3 m, desingularised velocity, |u| ≤ 30 m/s;
  - Manning friction, semi-implicit (n = 0.025 at sea, 0.035 on flooded land);
  - weak global damping with an e-folding time of about 2 simulated days.
- **Tiers** (dt from c_max ≈ 327 m/s):

  | Tier | N per face | Cell size | dt | Steps per frame | Max time warp |
  |---|---|---|---|---|---|
  | Low | 256 | 39 km | 39 s | 1 @ 30 fps | ~1200× |
  | Med | 512 | 19.5 km | 19.6 s | 2 @ 60 | ~2350× |
  | High | 1024 | 9.8 km | 9.8 s | 4 @ 60 | ~2350× |
  | Ultra | 1536 | 6.5 km | 6.5 s | ≤4 @ 60 | ~1500× |

  - dt is fixed per tier, so runs are deterministic. When the step count is capped, the HUD shows the actual warp.
  - A Pacific crossing plays in about 30–60 s.
- **Static data per cell (from the pipeline):**
  - bed elevation B;
  - **flood level F**: the lowest sea level at which the cell joins the world ocean, computed offline by priority-flood. This keeps basins like the Caspian and Dead Sea correct.
  - ice thickness I;
  - lake mask L (static lake surfaces in v1).
- **Sea level S:**
  - *instant mode*, used by the intro and fast drags: `η = max(B, S)` wherever F ≤ S.
  - *physical mode*: a uniform source term `dS/dt` on ocean-connected wet cells, so the water front spreads realistically across low plains.
  - Range −130…+80 m with labelled presets: LGM −120, today 0, Greenland +7.4, all ice +70 (bedrock under former ice sheets, labelled "simplified").
  - A hidden "Fantasy" range of ±600 m, like the original.
- **Sources:**
  - click = Gaussian drop, applied only where wet;
  - hold = Classic oscillator, mirroring `180·cos(0.5t)`;
  - up to 8 per frame;
  - **historical presets:** Okada 1985 uplift computed offline from USGS finite-fault models, shipped as local f16 patches. Events: 2004 Sumatra, 2011 Tōhoku, 1960 Valdivia, 1964 Alaska, 2010 Maule, Cascadia scenario. Plus clearly-labelled toy modes: asteroid, "Krakatoa-ish".
- **Diagnostics (no CPU–GPU stalls):**
  - running max amplitude, arrival time and inundation depth, kept per cell;
  - isochrone overlay;
  - virtual DART gauges read back asynchronously in small batches;
  - mass/energy reductions every 30 frames for drift monitoring.
- **Precision:**
  - simulated time accumulates in f64 on the CPU;
  - η is stored relative to the datum, not as depth h;
  - rendering samples only the rgba16f display atlas, which avoids the optional `float32-filterable` feature.

## Data pipeline (`uv run be-pipeline all`; raw data git-ignored; URLs pinned with SHA-256 in `sources.lock.json`)
**Inputs:**
- elevation/depth: ETOPO 2022 60″ surface + bedrock GeoTIFFs for M2; GEBCO_2025 15″ area-averaged later (attribution required);
- day colour: NASA **Blue Marble NG base-map** (no baked hillshade), monthly at 21600×10800;
- night lights: Black Marble 2016 colour, 3 km;
- clouds: `cloud_combined_8192` (current URL unverified; fallback: Solar System Scope 8k, CC BY 4.0);
- lakes: Natural Earth 10m;
- faults: USGS finite-fault models;
- the original Classic assets, copied verbatim.

**Steps:**
1. Reproject to equiangular cube faces with 4×4 area-averaged supersampling.
2. Run priority-flood (numba, on the cube graph) to get F.
3. Encode to KTX2 as 6-layer arrays or cubes with 2-texel gutters, whichever the M0 spike shows works.
4. Ship monthly albedo: 4 months on Low/Medium, 12 on High.
5. Write a `manifest.json` with content-hashed file names, per-tier lists and attribution strings.

**Download payloads:** Low ≈ 12 MB, Medium ≈ 30 MB (both fit on Pages), High ≈ 90 MB, Ultra ≈ 300 MB (CDN later). JS ≈ 1–1.5 MB gzipped.

**Data delivery:**
- Pipeline outputs are published as `data-vN` GitHub Releases.
- The Pages deploy job downloads them with `gh release download`.
- Browsers never stream from Releases, and no Git LFS.

**Licences:** NASA (public domain, credit requested), GEBCO (citation required), ETOPO (NOAA DOI), Natural Earth / USGS (public domain). Shown on an in-app About page and in `docs/DATA.md`.

## Rendering
- **Globe mesh:** a cube-sphere with a fixed 6×256² grid for v1 (orbital). CDLOD comes in M7 for regional zoom. Use logarithmic or reversed-Z depth and camera-relative positions.
- **Single opaque surface.** Land height = `S + (B−S)·exagLand` (default ×15). Water height = `S + (η−S)·exagWave` (default ×300). The ocean / flooded / dry choice happens per fragment, which maps directly onto the original's three cases.
- **Water shading:**
  - depth absorption `exp(−k·h)` over seabed/land albedo, so flooded land reads correctly;
  - Schlick Fresnel with F0 = 0.02, reflecting the sky;
  - **Cox–Munk** sun glint, with wind as a parameter;
  - normals from simulation gradients plus FFT detail normals;
  - foam on steep crests and run-up fronts.
- **Atmosphere and lighting:**
  - takram atmosphere: sky, limb glow, aerial perspective, stars, sun disc;
  - a 2D cloud shell with drift, shadows and terminator forward-scatter;
  - Black Marble night lights faded across the terminator, dimmed under clouds, **dark where flooded**;
  - post: HDR → bloom → AgX → SMAA/FXAA.
- **Classic 2004 mode:** an orthographic pass that runs the **original algorithm verbatim**.
  - i32 kernels on WebGPU: integer division truncates toward zero and `>>` is arithmetic, matching Java.
  - On WebGL2, emulate the division with float `trunc`.
  - `LightMapOcean` lookup `256 + grad + (pixel−sun)/4`, and the original bit-packing quirks of lines 375–380.
  - Original title and subtitle.
  - Options: "Authentic 800×600 pixelated" or window resolution.

## Interaction / UX
- **Explorer (default):** drag = orbit, click (< 5 px movement) = drop wave, hold = oscillator, Shift+move = sun, wheel = zoom.
- **Classic toggle:** pointer = sun, which places the glint under the cursor via `L = reflect(−V, N)`. Smoothing uses `1 − exp(−dt/58 ms)`, which equals the original `(3s+m)/4` at 60 fps.
- **Real-sun mode:** sun position from date/time, with a time-lapse slider.
- **Picking:** ray–sphere intersection, refined against the displaced height, then lat/lon → (face, i, j) via `cubeEAC.ts`.
- **Intro:** S starts at +500 m and eases to 0 over about 6 s, with a camera dolly and the title fading in. Then a few seeded drops.
- **Panels:**
  - sea-level ruler strip (the original's bottom strip), presets, historical events with time warp and gauges;
  - overlays: max amplitude, isochrones, graticule;
  - exaggeration sliders, "calm sea" reset.
- **Screensaver / kiosk** (idle 60 s or `?kiosk=1`): auto-orbit, accelerated real sun, random drops or a looping event, sea level "breathing", fullscreen and Wake Lock.
- **Mobile:** 1-finger orbit, tap = drop, pinch = zoom, 2-finger twist = sun, long-press = oscillator.
- **Sharing and accessibility:** camera, S, preset and time encoded in the URL; keyboard controls and reduced-motion support.

## Milestones
- **M0 — Scaffold + spikes (1–1.5 wk).**
  - Repo, pinned deps, CI (lint, typecheck, vitest, build), Pages "hello globe".
  - **Go/no-go spikes:**
    - (a) TSL compute writing an rgba32f storage-texture atlas, plus async readback;
    - (b) the same kernel through RTT under `forceWebGL`;
    - (c) takram atmosphere for a whole-globe view from orbit with radius 6371 km, plus its cost;
    - (d) KTX2Loader with ETC1S/UASTC and R16F + zstd, array/cube layouts, on Chrome, Safari macOS/iOS and Chrome Android;
    - (e) equiangular direction-warp sampling;
    - (f) Playwright WebGPU smoke test in CI (SwiftShader).
- **M1 — Classic 2004 homage (1 wk).**
  - Java golden harness in `tools/java-golden`, built from the `/tmp/be` headless harness.
  - TypeScript CPU port and GPU i32 kernel, both **bit-exact** against the golden frames.
  - Title overlays. First public deploy.
- **M2 — Data pipeline v1 (1.5 wk).**
  - ETOPO → B/F/I faces, Blue Marble × 4 months, Black Marble, clouds, lakes; KTX2 encoding; manifest; Low/Medium tiers.
  - Tests: cube round-trip < 1e-9 rad; face areas sum to 4πR²; priority-flood on synthetic DEMs; ocean area at S = 0 ≈ 71% ± 1%.
- **M3 — Globe rendering v1 (2 wk).** Mesh, albedo month blend, height-derived normals, camera, picking, sun modes, atmosphere, stars, night lights, clouds, bloom/AgX.
- **M4 — Shallow-water solver v1 (2.5–3 wk).**
  - f64 CPU reference solver and the numerics test suite.
  - GPU kernels: halo, update, sources, sea-level modes, friction, Coriolis, derived, reductions.
  - Tier logic; hooked into displacement, normals and flooding.
- **M5 — Water realism (1.5 wk).** Glint, Fresnel/sky, absorption, seabed and exposed-shelf albedo, foam/run-up, detail normals, lights going dark when flooded.
- **M6 — Interaction & modes (2 wk).** Intro, sea-level strip and presets, Okada presets, overlays and gauges, screensaver, mobile gestures, URL state, About.
- **M7 — Performance & reach (2 wk).**
  - Startup benchmark → tier choice; GPU-timestamp auto-tune; progressive asset upgrade.
  - CDLOD regional zoom; workgroup-tiled update kernel on WebGPU; WebGL2 Lite hardening.
  - Device matrix testing.
- **M8 — Verification & launch (1 wk).** Visual-regression baselines, performance report, GEBCO swap-in, PWA, docs. Decide on the CDN here.
- **Stretch goals:** nested ~1 km regional grid for real inundation, Boussinesq dispersion, LGM ice sheets, sea ice, volumetric clouds (once takram's WebGPU port lands), `.scr`/Tauri wrapper.

**Total ≈ 15–17 weeks** of focused work. M1 and M3 give early visible results.

## Verification
- **Unit tests (vitest):** cube mapping and cell geometry; solar position vs NOAA, ±0.1°; Okada vs the 1985 check table; F-connectivity.
- **Numerics, on the f64 CPU reference solver:**
  - lake at rest with dry islands: |u| < 1e-12 (CPU), < 1e-5 m/s in f32 on the GPU;
  - mass drift < 1e-12 (f64) and < 1e-6 per day (GPU);
  - wave front speed within 2% of √(gh) at 1, 4 and 6 km depth, and isotropic within 3% (cube corner vs face centre);
  - Stoker and Ritter dam breaks vs analytic, convergence order ≥ 1;
  - Thacker bowl moving shoreline;
  - Synolakis run-up and Green's-law shoaling, within 10%;
  - Williamson test case 2 with Coriolis.
- **GPU parity (Playwright + Chrome WebGPU):** N = 32, 100 steps, L∞ difference vs CPU < 1e-4. Runs on the local Mac or obsidian's GPU, with SwiftShader in CI.
- **Classic mode:** bit-exact against the Java golden frames.
- **Plausibility:** preset arrival times within ±10% of history (Sumatra → Sri Lanka ~2 h; Tōhoku → Hawaii ~7–8 h, → Chile ~21–22 h).
- **Visual regression:** `?test=1&scene=<id>` freezes camera, sun, time and seed. Playwright + pixelmatch, with baselines per backend and GPU vendor, run on a GPU machine.
- **CI:**
  - PR: lint, `tsc`, vitest, build, SwiftShader smoke test (canvas not blank, no validation errors).
  - main: fetch the data release → build → deploy to Pages.
- **Manual matrix:** Chrome/Edge on Windows and Mac, Safari on macOS and iOS, Firefox on Windows and macOS (WebGPU), Firefox on Linux (Lite), Chrome Android.

## Key risks
- **TSL API churn:** pin the version and gate upgrades behind visual tests.
- **takram atmosphere/WebGPU is beta:** the M0 spike decides, with the lite atmosphere as backup.
- **Real tsunami amplitudes are invisible from orbit:** exaggeration controls are essential and must be labelled honestly.
- **Real run-up needs a nested grid:** sea-level flooding works at these cell sizes, but realistic tsunami inundation is a stretch goal.
- **Cube-corner artifacts:** covered by the isotropy test.
- **Mobile thermal throttling:** handled by auto-tune.
- **NASA URL churn:** handled by the lockfile and a mirrored raw-data archive.
- **Pages bandwidth:** CDN decision deferred to M8.

## Defaults assumed (easy to change)
- MIT licence.
- Subtitle keeps "Designed and coded by Loic Royer in 100% pure Java, 2004." and adds "Reimagined for the web, 2026."
- Fantasy ±600 m range hidden behind a toggle.
- Toy asteroid/Krakatoa modes, labelled as toys.
- Lakes static in v1.
- ETOPO for the MVP, then GEBCO.
- Screensaver = web kiosk only.
- Before release: confirm that `world.jpg`/`worldtopo.jpg` (likely NASA-derived) can be redistributed.
- The GitHub repo is created and pushed only after explicit OK.
