import * as THREE from 'three/webgpu'
import { EARTH_RADIUS } from './units'

const ray = new THREE.Raycaster()
const ndc = new THREE.Vector2()
const sphere = new THREE.Sphere(new THREE.Vector3(), EARTH_RADIUS)

/** ECEF point on the (undisplaced) globe under client pixel (x, y), or null. */
export function pickGlobe(camera: THREE.Camera, el: HTMLElement, x: number, y: number, out = new THREE.Vector3()) {
  const r = el.getBoundingClientRect()
  ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1)
  ray.setFromCamera(ndc, camera)
  return ray.ray.intersectSphere(sphere, out)
}

export function toLatLon(p: THREE.Vector3): { lat: number; lon: number } {
  const n = p.clone().normalize()
  return { lat: (Math.asin(n.z) * 180) / Math.PI, lon: (Math.atan2(n.y, n.x) * 180) / Math.PI }
}

export function fromLatLon(lat: number, lon: number, radius = 1, out = new THREE.Vector3()) {
  const la = (lat * Math.PI) / 180
  const lo = (lon * Math.PI) / 180
  return out.set(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)).multiplyScalar(radius)
}

/** Sun direction that puts the specular glint at surface point p for a viewer at `eye`. */
export function sunForGlintAt(p: THREE.Vector3, eye: THREE.Vector3, out = new THREE.Vector3()) {
  const n = p.clone().normalize()
  const v = eye.clone().sub(p).normalize()
  return out.copy(n).multiplyScalar(2 * n.dot(v)).sub(v).normalize()
}
