import * as THREE from 'three/webgpu'

const COLORS = ['#ffd166', '#ef476f', '#06d6a0', '#4cc9f0', '#f78c6b', '#c77dff', '#90be6d', '#f9c74f']

export interface Gauge {
  name: string
  position: THREE.Vector3
  samples: { t: number; eta: number }[]
}

/**
 * Virtual tide gauges: screen markers on the globe and a sea-surface chart (anomaly in m over
 * simulated hours), like DART buoy records.
 */
export class GaugePanel {
  readonly gauges: Gauge[] = []
  private readonly canvas: HTMLCanvasElement
  private readonly root: HTMLDivElement
  private readonly markers: HTMLDivElement[] = []

  constructor() {
    this.root = document.createElement('div')
    this.root.className = 'be-gauges'
    this.root.innerHTML = '<div class="be-gauges-title">Tide gauges <span>(sea surface, m)</span></div>'
    this.canvas = document.createElement('canvas')
    this.canvas.width = 640
    this.canvas.height = 300
    this.root.appendChild(this.canvas)
    document.body.appendChild(this.root)
    const st = document.createElement('style')
    st.textContent = `
    .be-gauges { position: fixed; right: 14px; bottom: 14px; width: 320px; padding: 8px 10px; display: none;
      background: rgba(6, 10, 20, 0.62); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      border: 1px solid rgba(140, 170, 255, 0.15); border-radius: 10px; color: #cfdcff; font: 11px system-ui, sans-serif; }
    .be-gauges-title { font-weight: 600; margin-bottom: 4px; } .be-gauges-title span { font-weight: 400; opacity: .6; }
    .be-gauges canvas { width: 320px; height: 150px; display: block; }
    .be-gauge-marker { position: fixed; transform: translate(-50%, -50%); pointer-events: none; font: 10px system-ui, sans-serif;
      white-space: nowrap; text-shadow: 0 0 3px #000; }
    .be-gauge-marker::before { content: ''; display: inline-block; width: 7px; height: 7px; border-radius: 50%;
      background: currentColor; margin-right: 4px; vertical-align: -1px; box-shadow: 0 0 0 1.5px #0008; }`
    document.head.appendChild(st)
  }

  add(name: string, position: THREE.Vector3): number {
    if (this.gauges.length >= COLORS.length) return -1
    this.gauges.push({ name, position: position.clone().normalize(), samples: [] })
    const m = document.createElement('div')
    m.className = 'be-gauge-marker'
    m.style.color = COLORS[this.gauges.length - 1]
    m.textContent = name
    document.body.appendChild(m)
    this.markers.push(m)
    this.root.style.display = 'block'
    return this.gauges.length - 1
  }

  clear() {
    this.gauges.length = 0
    for (const m of this.markers) m.remove()
    this.markers.length = 0
    this.root.style.display = 'none'
  }

  /** Drops recorded samples (after a reset of the ocean). */
  resetSamples() {
    for (const g of this.gauges) g.samples.length = 0
  }

  record(t: number, values: Float32Array) {
    this.gauges.forEach((g, k) => {
      const last = g.samples[g.samples.length - 1]
      if (last && t <= last.t) return
      g.samples.push({ t, eta: values[k * 4] })
      if (g.samples.length > 4000) g.samples.splice(0, 1000)
    })
  }

  /** Positions the markers (hidden behind the globe) and redraws the chart. */
  update(camera: THREE.Camera, el: HTMLElement) {
    const r = el.getBoundingClientRect()
    const p = new THREE.Vector3()
    const eye = camera.position.clone().normalize()
    this.gauges.forEach((g, k) => {
      p.copy(g.position).multiplyScalar(6_371_000).project(camera)
      const visible = g.position.dot(eye) > 0.15 && p.z < 1
      const m = this.markers[k]
      m.style.display = visible ? '' : 'none'
      m.style.left = `${r.left + ((p.x + 1) / 2) * r.width}px`
      m.style.top = `${r.top + ((1 - p.y) / 2) * r.height}px`
    })
    this.draw()
  }

  private draw() {
    const c = this.canvas.getContext('2d')!
    const { width: W, height: H } = this.canvas
    c.clearRect(0, 0, W, H)
    let tMax = 1
    let aMax = 0.05
    for (const g of this.gauges)
      for (const s of g.samples) {
        tMax = Math.max(tMax, s.t)
        aMax = Math.max(aMax, Math.abs(s.eta))
      }
    const hours = tMax / 3600
    const x = (t: number) => 40 + ((W - 50) * t) / tMax
    const y = (a: number) => H / 2 - ((H / 2 - 16) * a) / aMax
    c.strokeStyle = 'rgba(200,215,255,0.25)'
    c.fillStyle = 'rgba(200,215,255,0.6)'
    c.font = '18px system-ui'
    c.lineWidth = 1
    c.beginPath()
    c.moveTo(40, y(0))
    c.lineTo(W - 10, y(0))
    c.stroke()
    c.fillText(`+${aMax.toFixed(2)}`, 0, y(aMax) + 6)
    c.fillText(`−${aMax.toFixed(2)}`, 0, y(-aMax) + 6)
    const step = hours > 12 ? 6 : hours > 4 ? 2 : 1
    for (let h = 0; h <= hours; h += step) c.fillText(`${h} h`, x(h * 3600) - 10, H - 2)
    this.gauges.forEach((g, k) => {
      c.strokeStyle = COLORS[k]
      c.lineWidth = 2.5
      c.beginPath()
      g.samples.forEach((s, i) => (i ? c.lineTo(x(s.t), y(s.eta)) : c.moveTo(x(s.t), y(s.eta))))
      c.stroke()
    })
  }
}

/** Small transient message at the top centre. */
export function toast(text: string) {
  const t = document.createElement('div')
  t.textContent = text
  t.style.cssText =
    'position:fixed;top:18px;left:50%;transform:translateX(-50%);padding:6px 14px;border-radius:8px;background:#0b1430d0;color:#dbe6ff;font:13px system-ui;z-index:10;transition:opacity .6s'
  document.body.appendChild(t)
  setTimeout(() => (t.style.opacity = '0'), 1800)
  setTimeout(() => t.remove(), 2500)
}
