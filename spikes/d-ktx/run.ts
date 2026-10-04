import * as THREE from 'three/webgpu'
import { abs, cos, float, sin, texture, uv, vec2, vec3, vec4 } from 'three/tsl'
import type Node from 'three/src/nodes/core/Node.js'
import { Ktx2Arrays } from '../../src/core/assets/ktx2'
import { sampleEACArray } from '../../src/core/geo/cubeEAC'

/**
 * Spike d+e: load EAC face arrays (ETC1S, UASTC+zstd, R16F+zstd), reproject each back to an
 * equirect grid on the GPU and measure the error against the source equirect image.
 * A deliberately wrong face size is included to show the metric discriminates.
 */
const W = 1024
const H = 512
const N = 512
const GUTTER = 4

export async function runKtxSpike(renderer: THREE.WebGPURenderer) {
  const rt = new THREE.RenderTarget(W, H, {
    type: THREE.FloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    generateMipmaps: false,
  })
  const quad = new THREE.QuadMesh()
  const results: Record<string, unknown> = {}
  const measure = async (node: any) => {
    const m = new THREE.NodeMaterial()
    m.fragmentNode = vec4(vec3(node), 1) as never // node is a scalar error
    m.depthTest = m.depthWrite = false // the target has no depth buffer
    const q = new THREE.QuadMesh(m)
    renderer.setRenderTarget(rt)
    await renderer.compileAsync(q, (q as any).camera)
    q.render(renderer)
    renderer.setRenderTarget(null)
    const px = (await renderer.readRenderTargetPixelsAsync(rt, 0, 0, W, H)) as Float32Array
    let sum = 0
    let maxv = 0
    for (let i = 0; i < W * H; i++) {
      sum += px[i * 4]
      maxv = Math.max(maxv, px[i * 4])
    }
    return { mean: +(sum / (W * H)).toFixed(4), max: +maxv.toFixed(3) }
  }
  const base = import.meta.env.BASE_URL
  const loader = new Ktx2Arrays(renderer, `${base}basis/`)
  const t0 = performance.now()
  const [etc1s, uastc, height] = await Promise.all([
    loader.load(`${base}spike/albedo-array-etc1s.ktx2`),
    loader.load(`${base}spike/albedo-array-uastc.ktx2`),
    loader.load(`${base}spike/height-array-r16f.ktx2`),
  ])
  const loadMs = performance.now() - t0
  results.loadMs = Math.round(loadMs)
  const equi = await new THREE.TextureLoader().loadAsync(`${base}placeholder/bmng-topo-bathy-200407-5400.jpg`)
  equi.colorSpace = THREE.SRGBColorSpace
  const equiRaw = equi.clone()
  equiRaw.colorSpace = THREE.NoColorSpace
  equiRaw.needsUpdate = true

  // Direction for each equirect texel (u, v); v = 0 is the north edge.
  const u = uv() as any
  const lon = u.x.mul(2 * Math.PI).sub(Math.PI)
  const lat = float(Math.PI / 2).sub(u.y.mul(Math.PI))
  const d = vec3(cos(lat).mul(cos(lon)), cos(lat).mul(sin(lon)), sin(lat)) as unknown as Node
  // Image textures are flipY'd (v = 0 at the bottom row), so the reference lookup flips v.
  const refUV = vec2(u.x, u.y.oneMinus())
  const ref = (texture(equi, refUV) as any).rgb

  const cases: Record<string, any> = {
    'array-etc1s': (sampleEACArray(etc1s, d, N, GUTTER) as any).rgb,
    'array-uastc': (sampleEACArray(uastc, d, N, GUTTER) as any).rgb,
    'array-uastc-WRONG-gutter': (sampleEACArray(uastc, d, N, 0) as any).rgb,
  }
  // Mean abs linear-RGB error (averaged over channels).
  for (const [name, n] of Object.entries(cases)) results[name] = await measure((abs(n.sub(ref)) as any).dot(vec3(1 / 3)))
  // Heights: expected = mean(sRGB 0..1)·9000 − 6000 m from the raw (non-linearised) JPEG.
  const expectedH = ((texture(equiRaw, refUV) as any).rgb as any).dot(vec3(1 / 3)).mul(9000).sub(6000)
  const gotH = (sampleEACArray(height, d, N, GUTTER, false) as any).r
  results['height-r16f (m)'] = await measure(abs(gotH.sub(expectedH)))

  // Visual: the ETC1S-reprojected map on screen, for a seam check.
  renderer.setSize(W, H)
  document.body.appendChild(renderer.domElement)
  const m = new THREE.NodeMaterial()
  m.fragmentNode = vec4(cases['array-etc1s'], 1) as never
  quad.material = m
  quad.render(renderer)
  return results
}
