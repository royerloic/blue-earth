// Minimal typings for three's bundled libs (not covered by @types/three).
declare module 'three/addons/libs/ktx-parse.module.js' {
  export const VK_FORMAT_R16_SFLOAT: number
  export interface KTX2Level {
    levelData: Uint8Array
    uncompressedByteLength: number
  }
  export interface KTX2Container {
    vkFormat: number
    pixelWidth: number
    pixelHeight: number
    pixelDepth: number
    layerCount: number
    faceCount: number
    supercompressionScheme: number
    levels: KTX2Level[]
  }
  export function read(data: Uint8Array): KTX2Container
}
declare module 'three/addons/libs/zstddec.module.js' {
  export class ZSTDDecoder {
    init(): Promise<void>
    decode(data: Uint8Array, uncompressedSize?: number): Uint8Array
  }
}
