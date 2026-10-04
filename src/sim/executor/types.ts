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
  /** Compiles `kernel`, reading `inputs`, writing `output`. Returns a runnable pass. */
  pass<I extends string>(kernel: Kernel<I>, inputs: Record<I, Field>, output: Field): () => void
  read(field: Field): Promise<Float32Array>
}
