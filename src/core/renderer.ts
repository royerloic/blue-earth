import { WebGPURenderer } from 'three/webgpu'

export type Backend = 'webgpu' | 'webgl2'

export interface RendererInfo {
  renderer: WebGPURenderer
  backend: Backend
}

/**
 * Creates the renderer. WebGPU is preferred; `?backend=webgl2` forces the
 * WebGL2 path (also taken automatically when WebGPU is unavailable).
 */
export async function createRenderer(canvas?: HTMLCanvasElement): Promise<RendererInfo> {
  const forceWebGL = new URLSearchParams(location.search).get('backend') === 'webgl2'
  const renderer = new WebGPURenderer({ canvas, antialias: true, forceWebGL })
  await renderer.init()
  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true
  return { renderer, backend: isWebGPU ? 'webgpu' : 'webgl2' }
}
