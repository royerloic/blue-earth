import * as THREE from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { RendererInfo } from '../../core/renderer'

// M0 "hello globe": textured sphere, one sun light, orbit controls.
// Replaced in M3 by the cube-sphere globe with atmosphere.
export async function startGlobeMode({ renderer, backend }: RendererInfo) {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(innerWidth, innerHeight)
  document.body.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 100)
  camera.position.set(0, 0.6, 4)

  const albedo = await new THREE.TextureLoader().loadAsync(
    `${import.meta.env.BASE_URL}placeholder/bmng-topo-bathy-200407-5400.jpg`,
  )
  albedo.colorSpace = THREE.SRGBColorSpace
  albedo.anisotropy = 8

  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(1, 256, 128),
    new THREE.MeshStandardNodeMaterial({ map: albedo, roughness: 0.9 }),
  )
  scene.add(globe)

  const sun = new THREE.DirectionalLight(0xffffff, 3)
  sun.position.set(5, 2, 3)
  scene.add(sun, new THREE.AmbientLight(0x223355, 0.15))

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.minDistance = 1.2
  controls.maxDistance = 10

  document.getElementById('hud')!.textContent = `Blue Earth · ${backend} · press C for Classic 2004`
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(innerWidth, innerHeight)
  })

  renderer.setAnimationLoop(() => {
    globe.rotation.y += 0.0005
    controls.update()
    renderer.render(scene, camera)
  })
}

