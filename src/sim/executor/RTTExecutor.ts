import * as THREE from 'three/webgpu'
import { ivec2, screenCoordinate, textureLoad } from 'three/tsl'
import type Node from 'three/src/nodes/core/Node.js'
import { StaticField, type Executor, type Field, type Kernel, type Loader } from './types'

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

  createStatic(width: number, height: number, data: Float32Array): Field {
    return new StaticField(width, height, data)
  }

  pass<I extends string>(kernel: Kernel<I>, inputs: Record<I, Field>, output: Field): () => void {
    const out = output as RTTField
    // Coordinate convention (WebGL): three flips both screenCoordinate.y and textureLoad on
    // render targets, so logical row L lives at physical row H-1-L. Data textures are uploaded
    // unflipped and read unflipped, so data row L is logical row L as well. Readback flips rows.
    const loaders = {} as Record<I, Loader>
    for (const k in inputs) {
      const f = inputs[k]
      const tex = f instanceof StaticField ? f.texture : (f as RTTField).target.texture
      loaders[k] = (q: Node) => textureLoad(tex, q) as unknown as Node
    }
    const material = new THREE.NodeMaterial()
    const p = ivec2(screenCoordinate.xy)
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

  texture(field: Field): THREE.Texture {
    return (field as RTTField).target.texture
  }

  async read(field: Field): Promise<Float32Array> {
    const f = field as RTTField
    const data = (await this.renderer.readRenderTargetPixelsAsync(f.target, 0, 0, f.width, f.height)) as Float32Array
    if ((this.renderer.backend as { isWebGLBackend?: boolean }).isWebGLBackend !== true) return data
    // WebGL reads back bottom-up; return rows in cell (top-left) order.
    const row = f.width * 4
    const out = new Float32Array(data.length)
    for (let y = 0; y < f.height; y++) out.set(data.subarray(y * row, (y + 1) * row), (f.height - 1 - y) * row)
    return out
  }
}
