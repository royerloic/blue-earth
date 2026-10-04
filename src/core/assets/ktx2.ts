import * as THREE from 'three/webgpu'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import {
  read,
  VK_FORMAT_R16_SFLOAT,
  VK_FORMAT_R16G16_SFLOAT,
  VK_FORMAT_R16G16B16A16_SFLOAT,
} from 'three/addons/libs/ktx-parse.module.js'
import { ZSTDDecoder } from 'three/addons/libs/zstddec.module.js'

/**
 * KTX2 loading for the globe's 6-layer EAC face arrays.
 * - Basis (ETC1S/UASTC) arrays go through three's KTX2Loader (CompressedArrayTexture).
 * - R16/RG16/RGBA16 SFLOAT arrays are decoded here: three's KTX2Loader ignores layerCount for
 *   uncompressed formats (r184) and would return a single oversized 2D texture.
 * Cube-map KTX2 is not used: r184's WebGPU backend cannot upload CompressedCubeTexture.
 */
const HALF_FORMATS = new Map([
  [VK_FORMAT_R16_SFLOAT, 1],
  [VK_FORMAT_R16G16_SFLOAT, 2],
  [VK_FORMAT_R16G16B16A16_SFLOAT, 4],
])

export class Ktx2Arrays {
  private readonly basis: KTX2Loader
  private zstd?: Promise<ZSTDDecoder>

  constructor(renderer: THREE.WebGPURenderer, transcoderPath: string) {
    this.basis = new KTX2Loader().setTranscoderPath(transcoderPath).detectSupport(renderer as never)
  }

  async load(url: string): Promise<THREE.Texture> {
    const buffer = new Uint8Array(await (await fetch(url)).arrayBuffer())
    const container = read(buffer)
    const channels = HALF_FORMATS.get(container.vkFormat)
    if (channels === undefined)
      return new Promise((resolve, reject) => this.basis.parse(buffer.buffer as ArrayBuffer, resolve, reject))

    const level = container.levels[0]
    let data = level.levelData
    if (container.supercompressionScheme === 2 /* zstd */) {
      this.zstd ??= (async () => {
        const d = new ZSTDDecoder()
        await d.init()
        return d
      })()
      data = (await this.zstd).decode(data, level.uncompressedByteLength)
    }
    const { pixelWidth: w, pixelHeight: h } = container
    const layers = Math.max(1, container.layerCount)
    const texels = new Uint16Array(data.buffer, data.byteOffset, w * h * layers * channels)
    const tex = new THREE.DataArrayTexture(texels, w, h, layers)
    tex.type = THREE.HalfFloatType
    tex.format = channels === 1 ? THREE.RedFormat : channels === 2 ? THREE.RGFormat : THREE.RGBAFormat
    tex.minFilter = tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = false
    tex.needsUpdate = true
    return tex
  }
}
