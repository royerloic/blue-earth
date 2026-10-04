import * as THREE from 'three/webgpu'
import { context, pass, texture, toneMapping, uniform, vec3 } from 'three/tsl'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { getECIToECEFRotationMatrix, getMoonDirectionECI, getSunDirectionECI } from '@takram/three-atmosphere'
import {
  aerialPerspective,
  AtmosphereContext,
  AtmosphereLight,
  AtmosphereLightNode,
} from '@takram/three-atmosphere/webgpu'
import { Ellipsoid } from '@takram/three-geospatial'

/**
 * Spike c: whole-globe view from orbit with takram's Bruneton atmosphere (WebGPU node path).
 * World space = ECEF metres (z = north), as the library expects.
 */
export async function runAtmosphereSpike(renderer: THREE.WebGPURenderer, date = new Date('2026-07-09T15:00:00Z')) {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(innerWidth, innerHeight)
  document.body.appendChild(renderer.domElement)
  renderer.library.addLight(AtmosphereLightNode as never, AtmosphereLight)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 1e4, 1e9)
  camera.position.set(3.58e7, 0, 0)
  camera.up.set(0, 0, 1)

  const atmosphere = new AtmosphereContext()
  atmosphere.camera = camera
  renderer.contextNode = context({ ...(renderer.contextNode.value as object), getAtmosphere: () => atmosphere })

  const { matrixECIToECEF, sunDirectionECEF, moonDirectionECEF } = atmosphere
  getECIToECEFRotationMatrix(date, matrixECIToECEF.value)
  getSunDirectionECI(date, sunDirectionECEF.value).applyMatrix4(matrixECIToECEF.value)
  getMoonDirectionECI(date, moonDirectionECEF.value).applyMatrix4(matrixECIToECEF.value)

  const albedo = await new THREE.TextureLoader().loadAsync(
    `${import.meta.env.BASE_URL}placeholder/bmng-topo-bathy-200407-5400.jpg`,
  )
  albedo.colorSpace = THREE.SRGBColorSpace
  albedo.anisotropy = 16

  // SphereGeometry already puts u = 0.5 (longitude 0) on +x; rotate its +y poles onto ECEF +z.
  const geometry = new THREE.SphereGeometry(1, 360, 180)
  geometry.rotateX(Math.PI / 2)
  const material = new THREE.MeshPhysicalNodeMaterial({ roughness: Number(new URLSearchParams(location.search).get('rough') ?? 0.75), ior: 1.33 })
  material.colorNode = texture(albedo).rgb
  material.emissiveNode = vec3(0)
  const globe = new THREE.Mesh(geometry, material)
  globe.scale.copy(Ellipsoid.WGS84.radii)
  scene.add(globe)

  scene.add(new AtmosphereLight())

  const passNode = pass(scene, camera, { samples: 0 })
  const aerial = aerialPerspective(passNode.getTextureNode('output'), passNode.getTextureNode('depth'))
  const pipeline = new THREE.RenderPipeline(renderer, toneMapping(THREE.AgXToneMapping, uniform(2), aerial as never) as never)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.minDistance = 7.5e6
  controls.enablePan = false
  controls.enableDamping = true

  const frameTimes: number[] = []
  let last = performance.now()
  renderer.setAnimationLoop(() => {
    const now = performance.now()
    frameTimes.push(now - last)
    last = now
    controls.update()
    pipeline.render()
  })
  // Report the median frame time after the first 2 s.
  await new Promise((r) => setTimeout(r, 4000))
  const t = frameTimes.slice(-60).sort((a, b) => a - b)
  return { medianFrameMs: t[Math.floor(t.length / 2)], frames: frameTimes.length }
}
