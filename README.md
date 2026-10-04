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
