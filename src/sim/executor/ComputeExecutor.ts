import * as THREE from 'three/webgpu'
import { Fn, globalId, ivec2, textureLoad, textureStore, uvec2 } from 'three/tsl'
import type Node from 'three/src/nodes/core/Node.js'
import { StaticField, type Executor, type Field, type Kernel, type Loader } from './types'

const WG = 8

class ComputeField implements Field {
  readonly texture: THREE.StorageTexture
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.texture = new THREE.StorageTexture(width, height)
    this.texture.type = THREE.FloatType
    this.texture.format = THREE.RGBAFormat
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter
    this.texture.generateMipmaps = false
  }
}

/** WebGPU compute-shader executor: one thread per cell, 8×8 workgroups. */
export class ComputeExecutor implements Executor {
  readonly kind = 'compute'
  constructor(private readonly renderer: THREE.WebGPURenderer) {}

  createField(width: number, height: number): Field {
    return new ComputeField(width, height)
  }

  createStatic(width: number, height: number, data: Float32Array): Field {
    return new StaticField(width, height, data)
  }

  pass<I extends string>(kernel: Kernel<I>, inputs: Record<I, Field>, output: Field): () => void {
    const out = output as ComputeField
    const fn = Fn(() => {
      const p = ivec2(globalId.xy)
      const loaders = {} as Record<I, Loader>
      for (const k in inputs) {
        const tex = (inputs[k] as ComputeField | StaticField).texture
        loaders[k] = (q: Node) => textureLoad(tex, q) as unknown as Node
      }
      // Out-of-bounds textureStore is a no-op in WGSL, so partial edge workgroups need no guard.
      textureStore(out.texture, uvec2(globalId.xy), kernel(loaders, p as unknown as Node) as never).toWriteOnly()
    })()
    // r186 accepts a [x, y, z] workgroup dispatch at runtime; the typings only declare `number`.
    const dispatch = [Math.ceil(out.width / WG), Math.ceil(out.height / WG), 1] as unknown as number
    const node = fn.compute(dispatch, [WG, WG, 1])
    return () => this.renderer.compute(node)
  }

  texture(field: Field): THREE.Texture {
    return (field as ComputeField).texture
  }

  async read(field: Field): Promise<Float32Array> {
    const f = field as ComputeField
    const backend = this.renderer.backend as unknown as {
      copyTextureToBuffer(t: THREE.Texture, x: number, y: number, w: number, h: number, face: number): Promise<Float32Array>
    }
    return backend.copyTextureToBuffer(f.texture, 0, 0, f.width, f.height, 0)
  }
}
