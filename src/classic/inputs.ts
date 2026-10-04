/**
 * Classic 2004 inputs, decoded by Java from the original JPEGs (public/classic/inputs.binz,
 * written by tools/java-golden). Using Java's decode keeps the port bit-exact; browser JPEG
 * decoders differ by a few levels.
 */
export const W = 800
export const H = 600
export const LIGHT = 512

export interface ClassicInputs {
  worldR: Uint8Array
  worldG: Uint8Array
  worldB: Uint8Array
  /** ((gray & 0xFF) − 126) · 4, from worldtopo.jpg's blue channel. */
  topo: Int32Array
  lightR: Uint8Array
  lightG: Uint8Array
  lightB: Uint8Array
}

/** Parses the raw (already gunzipped) inputs blob. */
export function parseInputs(raw: Uint8Array): ClassicInputs {
  const n = W * H
  const l = LIGHT * LIGHT
  let o = 0
  const take = (len: number) => raw.subarray(o, (o += len))
  const worldR = take(n)
  const worldG = take(n)
  const worldB = take(n)
  const topoBytes = take(2 * n)
  const topo = Int32Array.from(new Int16Array(topoBytes.slice().buffer))
  const lightR = take(l)
  const lightG = take(l)
  const lightB = take(l)
  if (o !== raw.length) throw new Error(`classic inputs: expected ${o} bytes, got ${raw.length}`)
  return { worldR, worldG, worldB, topo, lightR, lightG, lightB }
}

/** Browser: fetch + gunzip + parse. */
export async function loadInputs(url: string): Promise<ClassicInputs> {
  const res = await fetch(url)
  const stream = res.body!.pipeThrough(new DecompressionStream('gzip'))
  return parseInputs(new Uint8Array(await new Response(stream).arrayBuffer()))
}
