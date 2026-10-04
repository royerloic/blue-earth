import * as THREE from 'three/webgpu'
import type Node from 'three/src/nodes/core/Node.js'

/** Reads one texel of a named input field at integer texel coordinate `p` (ivec2). */
export type Loader = (p: Node) => Node

/**
 * A per-cell gather kernel: given loaders for its inputs and the cell coordinate,
 * returns the new vec4 value of that cell. No scatter, atomics or shared memory, so the
 * same kernel runs as a WebGPU compute shader or as a WebGL2 fragment pass.
 */
export type Kernel<I extends string> = (inputs: Record<I, Loader>, p: Node) => Node

/** An rgba32f 2D field, ping-ponged by the executor. */
export interface Field {
  readonly width: number
  readonly height: number
}

export interface Executor {
  readonly kind: 'compute' | 'rtt'
  createField(width: number, height: number): Field
  /** A read-only input field initialised from RGBA float data (row-major, 4 floats per texel). */
  createStatic(width: number, height: number, data: Float32Array): Field
  /** Compiles `kernel`, reading `inputs`, writing `output`. Returns a runnable pass. */
  pass<I extends string>(kernel: Kernel<I>, inputs: Record<I, Field>, output: Field): () => void
  /** The GPU texture holding a field, for sampling in display materials (use textureLoad). */
  texture(field: Field): THREE.Texture
  read(field: Field): Promise<Float32Array>
}

/** Read-only field backed by a float DataTexture; usable as an input by every executor. */
export class StaticField implements Field {
  readonly texture: THREE.DataTexture
  constructor(
    readonly width: number,
    readonly height: number,
    data: Float32Array,
  ) {
    this.texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType)
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter
    this.texture.generateMipmaps = false
    this.texture.needsUpdate = true
  }
}
