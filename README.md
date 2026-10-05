# Blue Earth

A modern, physically based web remake of *Blue Earth*, a 2004 Java ripple and tsunami demo:
real shallow-water waves on real bathymetry, on a 3D globe, with a "Classic 2004" mode.

See [docs/PLAN.md](docs/PLAN.md).

```sh
npm install
npm run dev                          # http://localhost:5173  (add ?backend=webgl2 to force WebGL2)
                                     # ?mode=classic (or press C): the 2004 original, bit-exact on the GPU
npm test && npx playwright test      # unit tests, then GPU tests (WebGPU + WebGL2)
tools/java-golden/run.sh             # regenerate Classic golden frames from the original Java
node tools/shot.mjs <url> out.png    # headless WebGPU screenshot
```

Placeholder imagery: NASA Blue Marble Next Generation (Reto Stöckli, NASA Earth Observatory).

## Controls (globe)
| Input | Action |
|---|---|
| drag / wheel | orbit / zoom |
| click | drop a wave · **hold** = oscillating source |
| Shift+move | steer the sun (glint under the cursor); **R** = real sun |
| K | Classic controls (pointer = sun, right-drag = orbit) |
| G | tide gauge at the cursor |
| L | copy a shareable link · **I** about & credits |
| H | hide the panel · **Space** fullscreen · **C** Classic 2004 |

URL options: `preset=sumatra2004|tohoku2011|valdivia1960|alaska1964|maule2010|cascadia|asteroid`,
`S=<sea level m>`, `date=<ISO>`, `lat/lon/alt`, `warp`, `overlay=1|2`, `intro=0`, `kiosk=1`, `hud=0`,
`tier=low|medium`, `backend=webgl2`.
