import * as THREE from 'three/webgpu'
import { int, ivec2, screenCoordinate, textureLoad } from 'three/tsl'
import type Node from 'three/src/nodes/core/Node.js'
import type { Executor, Field, Kernel, Loader } from './types'

class RTTField implements Field {
  readonly target: THREE.RenderTarget
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.target = new THREE.RenderTarget(width, height, {
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      generateMipmaps: false,
    })
  }
}

/**
 * Render-to-texture executor: each pass draws a full-screen quad into the output
 * target, one fragment per cell. Works on both the WebGPU and WebGL2 backends.
 */
export class RTTExecutor implements Executor {
  readonly kind = 'rtt'
  constructor(private readonly renderer: THREE.WebGPURenderer) {}

  createField(width: number, height: number): Field {
    return new RTTField(width, height)
  }

  pass<I extends string>(kernel: Kernel<I>, inputs: Record<I, Field>, output: Field): () => void {
    const out = output as RTTField
    const loaders = {} as Record<I, Loader>
    for (const k in inputs) {
      const tex = (inputs[k] as RTTField).target.texture
      loaders[k] = (q: Node) => textureLoad(tex, q) as unknown as Node
    }
    const material = new THREE.NodeMaterial()
    // On WebGL, three flips screenCoordinate.y to WebGPU's top-left convention, but
    // texelFetch is not flipped. Undo the flip so the cell coordinate equals the texel row.
    const isWebGL = (this.renderer.backend as { isWebGLBackend?: boolean }).isWebGLBackend === true
    const p = isWebGL
      ? ivec2(int(screenCoordinate.x), int(out.height - 1).sub(int(screenCoordinate.y)))
      : ivec2(screenCoordinate.xy)
    material.fragmentNode = kernel(loaders, p as unknown as Node) as never
    material.depthTest = material.depthWrite = false
    const quad = new THREE.QuadMesh(material)
    return () => {
      const prev = this.renderer.getRenderTarget()
      this.renderer.setRenderTarget(out.target)
      quad.render(this.renderer)
      this.renderer.setRenderTarget(prev)
    }
  }

  async read(field: Field): Promise<Float32Array> {
    const f = field as RTTField
    const data = await this.renderer.readRenderTargetPixelsAsync(f.target, 0, 0, f.width, f.height)
    return data as Float32Array
  }
}
