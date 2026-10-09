import * as THREE from 'three/webgpu'

/** public/data/tiles/index.json, written by pipeline/blueearth_pipeline/tiles.py. */
export interface TileIndex {
  month: string
  tile: number
  levels: number[]
  format: string
  credit: string
  tiles: Record<string, string>
  count: Record<string, number>
}

/** Alpha encodes the land mask as 200 (water) … 255 (land) so canvas premultiplication keeps RGB. */
export const MASK_ALPHA_MIN = 200

/**
 * Streams 500 m imagery tiles into a fixed-size texture array (one tile per layer, LRU).
 * Tiles are addressed like LOD patches: (level, face, row j, col i) on the EAC face quadtree.
 */
export class TileCache {
  readonly texture: THREE.DataArrayTexture
  readonly size: number
  readonly maxLevel: number
  readonly minLevel: number
  private readonly bits: Map<number, Uint8Array> = new Map()
  private readonly layerOf = new Map<string, number>()
  private readonly keyOf: (string | null)[]
  private readonly lastUsed: Float64Array
  private readonly pending = new Set<string>()
  private readonly queue: string[] = []
  private readonly ready: { key: string; pixels: Uint8ClampedArray }[] = []
  private frame = 0
  private active = 0
  loaded = 0

  constructor(
    readonly base: string,
    readonly index: TileIndex,
    readonly layers = 128,
    private readonly concurrency = 6,
  ) {
    const n = (this.size = index.tile)
    this.texture = new THREE.DataArrayTexture(new Uint8Array(n * n * 4 * layers), n, n, layers)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter
    this.texture.generateMipmaps = false
    this.texture.needsUpdate = true
    this.keyOf = new Array(layers).fill(null)
    this.lastUsed = new Float64Array(layers)
    for (const [lv, b64] of Object.entries(index.tiles)) this.bits.set(Number(lv), Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
    this.minLevel = Math.min(...index.levels)
    this.maxLevel = Math.max(...index.levels)
  }

  static async load(base: string, layers?: number): Promise<TileCache | null> {
    const r = await fetch(`${base}tiles/index.json`).catch(() => null)
    if (!r?.ok) return null
    return new TileCache(base, await r.json(), layers)
  }

  exists(level: number, face: number, j: number, i: number): boolean {
    const b = this.bits.get(level)
    if (!b) return false
    const id = face * 4 ** level + j * 2 ** level + i
    return (b[id >> 3] & (1 << (id & 7))) !== 0
  }

  /** Layer of a tile if resident (marks it used); otherwise requests it and returns −1. */
  layer(level: number, face: number, j: number, i: number): number {
    const key = `${level}/${face}/${j}_${i}`
    const l = this.layerOf.get(key)
    if (l !== undefined) {
      this.lastUsed[l] = this.frame
      return l
    }
    if (!this.pending.has(key)) {
      this.pending.add(key)
      this.queue.push(key)
    }
    return -1
  }

  /** Call once per frame: starts fetches, uploads finished tiles (bounded per frame). */
  update(maxUploads = 3) {
    this.frame++
    // Most recently requested first: the camera moved there last.
    while (this.active < this.concurrency && this.queue.length) void this.fetchTile(this.queue.pop()!)
    for (let k = 0; k < maxUploads && this.ready.length; k++) this.upload(this.ready.shift()!)
  }

  private async fetchTile(key: string) {
    this.active++
    try {
      const res = await fetch(`${this.base}tiles/${this.index.month}/${key}.${this.index.format}`)
      if (!res.ok) throw new Error(`${res.status}`)
      const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
      const canvas = new OffscreenCanvas(this.size, this.size)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(bmp, 0, 0)
      bmp.close()
      this.ready.push({ key, pixels: ctx.getImageData(0, 0, this.size, this.size).data })
    } catch {
      this.pending.delete(key) // retried on the next request
    } finally {
      this.active--
    }
  }

  private upload({ key, pixels }: { key: string; pixels: Uint8ClampedArray }) {
    // Free layer, or the least recently used one not used this frame.
    let best = -1
    let bestT = Infinity
    for (let l = 0; l < this.layers; l++) {
      if (this.keyOf[l] === null) {
        best = l
        break
      }
      if (this.lastUsed[l] < bestT && this.lastUsed[l] < this.frame - 1) {
        bestT = this.lastUsed[l]
        best = l
      }
    }
    if (best < 0) {
      this.ready.unshift({ key, pixels }) // cache full of visible tiles; try later
      return
    }
    const old = this.keyOf[best]
    if (old) {
      this.layerOf.delete(old)
      this.pending.delete(old)
    }
    const n = this.size
    ;(this.texture.image.data as Uint8Array).set(pixels, best * n * n * 4)
    this.texture.addLayerUpdate(best)
    this.texture.needsUpdate = true
    this.keyOf[best] = key
    this.layerOf.set(key, best)
    this.lastUsed[best] = this.frame
    this.pending.delete(key)
    this.loaded++
  }
}
