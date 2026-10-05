import * as THREE from 'three/webgpu'
import { float, floor, ivec2, screenSize, screenUV, select, textureLoad, uniform, vec2, vec4 } from 'three/tsl'
import { ClassicGPU } from '../../classic/ClassicGPU'
import { H, loadInputs, W } from '../../classic/inputs'
import type { Mouse } from '../../classic/mouseScript'
import type { RendererInfo } from '../../core/renderer'
import { ComputeExecutor } from '../../sim/executor/ComputeExecutor'
import { RTTExecutor } from '../../sim/executor/RTTExecutor'

/**
 * Classic 2004 mode: the original BlueEarth, bit-exact on the GPU, at its native 800×600,
 * letterboxed and pixel-upscaled. Mouse = sun, left button = waves, bottom 10 px = sea level,
 * right button = exit (it quit the original program).
 */
export async function startClassicMode({ renderer, backend }: RendererInfo, exit: () => void) {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(innerWidth, innerHeight)
  document.body.appendChild(renderer.domElement)

  const inputs = await loadInputs(`${import.meta.env.BASE_URL}classic/inputs.binz`)
  const exec = backend === 'webgpu' ? new ComputeExecutor(renderer) : new RTTExecutor(renderer)
  const sim = new ClassicGPU(exec, inputs)

  // Display: fit 800×600 into the window (4:3), nearest-neighbour, black bars.
  const rect = uniform(new THREE.Vector4(0, 0, 1, 1)) // x, y, w, h in physical pixels, top-left origin
  const frag = (screenUV as any).mul(screenSize)
  const local = frag.sub((rect as any).xy).div((rect as any).zw)
  const inside = local.x.greaterThanEqual(0).and(local.x.lessThan(1)).and(local.y.greaterThanEqual(0)).and(local.y.lessThan(1))
  const texel = ivec2(floor(local.mul(vec2(W, H))) as any)
  const px = (textureLoad(exec.texture(sim.pixels), texel) as any).rgb.div(255)
  const material = new THREE.NodeMaterial()
  // The original's pixel values are sRGB-encoded; decode so the output transform restores them.
  material.fragmentNode = select(inside, vec4((px as any).pow(float(2.2)), 1), vec4(0, 0, 0, 1)) as never
  material.depthTest = material.depthWrite = false
  const quad = new THREE.QuadMesh(material)

  const overlay = createOverlay()
  const mouse: Mouse = { x: W / 2, y: H / 2, left: false }
  const layout = () => {
    renderer.setSize(innerWidth, innerHeight)
    const s = Math.min(innerWidth / W, innerHeight / H)
    const w = W * s
    const h = H * s
    const x = (innerWidth - w) / 2
    const y = (innerHeight - h) / 2
    const dpr = renderer.getPixelRatio()
    rect.value.set(x * dpr, y * dpr, w * dpr, h * dpr)
    overlay.style.transform = `translate(${x}px, ${y}px) scale(${s})`
  }
  layout()
  addEventListener('resize', layout)

  const toLocal = (e: PointerEvent) => {
    const s = Math.min(innerWidth / W, innerHeight / H)
    mouse.x = Math.floor((e.clientX - (innerWidth - W * s) / 2) / s)
    mouse.y = Math.floor((e.clientY - (innerHeight - H * s) / 2) / s)
  }
  const el = renderer.domElement
  el.addEventListener('pointermove', toLocal)
  el.addEventListener('pointerdown', (e) => {
    toLocal(e)
    if (e.button === 0) mouse.left = true
    if (e.button === 2) exit()
  })
  addEventListener('pointerup', (e) => e.button === 0 && (mouse.left = false))
  el.addEventListener('contextmenu', (e) => e.preventDefault())

  renderer.setAnimationLoop(() => {
    sim.step(mouse)
    quad.render(renderer)
  })
}

/** The 2004 title and subtitle, positioned in original 800×600 coordinates. */
function createOverlay(): HTMLDivElement {
  const div = document.createElement('div')
  div.className = 'classic-overlay'
  div.innerHTML = `
    <div class="classic-title" data-text="Blue Earth">Blue Earth</div>
    <div class="classic-subtitle">Designed and coded by Loic Royer in 100% pure Java, 2004.<br/>Reimagined for the web, 2026.</div>
    <div class="classic-hint">click: waves · bottom edge: sea level · space: fullscreen · C or right-click: back to the globe</div>`
  document.body.appendChild(div)
  const style = document.createElement('style')
  style.textContent = `
    .classic-overlay { position: fixed; left: 0; top: 0; width: ${W}px; height: ${H}px; transform-origin: 0 0;
      pointer-events: none; font-family: Dialog, "Lucida Grande", "Helvetica Neue", Arial, sans-serif; font-style: italic; }
    .classic-title { position: absolute; left: 0; right: 0; top: 25px; text-align: center; font-size: 90px; line-height: 150px;
      height: 150px; color: rgb(26, 26, 255); text-shadow: 4.8px 1.5px 0 rgb(13, 13, 128); transform: translateY(-36px); }
    .classic-subtitle { position: absolute; left: 0; right: 0; top: ${0.95 * H - 18}px; text-align: center; font-size: 16px;
      line-height: 18px; color: #fff; transform: translateY(8px); }
    .classic-hint { position: absolute; left: 8px; bottom: 6px; font: 11px system-ui, sans-serif; color: #8af;
      opacity: 0.8; transition: opacity 2s 4s; }
    .classic-hint.fade { opacity: 0; }`
  document.head.appendChild(style)
  requestAnimationFrame(() => div.querySelector('.classic-hint')!.classList.add('fade'))
  return div
}
