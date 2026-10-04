import * as THREE from 'three/webgpu'
import { context, pass, toneMapping, uniform } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import {
  aerialPerspective,
  AtmosphereContext,
  AtmosphereLight,
  AtmosphereLightNode,
} from '@takram/three-atmosphere/webgpu'
import { Ellipsoid } from '@takram/three-geospatial'
import { EARTH_RADIUS } from '../../core/geo/units'

/**
 * Bruneton/Hillaire precomputed atmosphere (takram) on a spherical Earth, plus the post
 * chain: aerial perspective (which also draws sky, sun and stars) → bloom → AgX.
 */
export class Atmosphere {
  readonly context = new AtmosphereContext()
  readonly exposure = uniform(1.5)
  readonly bloomStrength = uniform(0.25)
  private readonly pipeline: THREE.RenderPipeline

  constructor(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    const ctx = this.context
    ctx.camera = camera
    ctx.ellipsoid = new Ellipsoid(EARTH_RADIUS, EARTH_RADIUS, EARTH_RADIUS)
    // Raymarched in-scattering adds per-pixel noise that needs TAA; the LUT path is clean
    // and indistinguishable from orbit.
    ctx.raymarchScattering = false
    renderer.contextNode = context({ ...(renderer.contextNode.value as object), getAtmosphere: () => ctx })
    renderer.library.addLight(AtmosphereLightNode as never, AtmosphereLight)
    scene.add(new AtmosphereLight())

    const scenePass = pass(scene, camera, { samples: 0 })
    const aerial = aerialPerspective(scenePass.getTextureNode('output'), scenePass.getTextureNode('depth')) as any
    const glow = bloom(aerial, 1, 0.4, 4) as any
    const hdr = aerial.add(glow.mul(this.bloomStrength))
    this.pipeline = new THREE.RenderPipeline(renderer, toneMapping(THREE.AgXToneMapping, this.exposure, hdr) as never)
  }

  /** Sets sun/moon directions (ECEF) and the ECI→ECEF rotation used for the stars. */
  setCelestial(sun: THREE.Vector3, moon: THREE.Vector3, eciToEcef: THREE.Matrix4) {
    this.context.sunDirectionECEF.value.copy(sun)
    this.context.moonDirectionECEF.value.copy(moon)
    this.context.matrixECIToECEF.value.copy(eciToEcef)
  }

  render() {
    this.pipeline.render()
  }
}
