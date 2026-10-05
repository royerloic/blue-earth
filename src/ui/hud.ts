/** Small, dependency-free control panel. Each control returns its element for later updates. */
export class Hud {
  readonly root: HTMLDivElement
  private readonly body: HTMLDivElement

  constructor(title: string) {
    injectStyle()
    this.root = document.createElement('div')
    this.root.className = 'be-hud'
    this.root.innerHTML = `<div class="be-hud-title">${title}</div>`
    this.body = document.createElement('div')
    this.root.appendChild(this.body)
    document.body.appendChild(this.root)
  }

  slider(label: string, min: number, max: number, step: number, value: number, fmt: (v: number) => string, onInput: (v: number) => void) {
    const row = this.row(label)
    const input = document.createElement('input')
    Object.assign(input, { type: 'range', min, max, step, value })
    const out = document.createElement('span')
    out.className = 'be-hud-val'
    const upd = () => {
      out.textContent = fmt(Number(input.value))
      onInput(Number(input.value))
    }
    input.addEventListener('input', upd)
    row.append(input, out)
    upd()
    return {
      input,
      set: (v: number) => {
        input.value = String(v)
        out.textContent = fmt(v)
      },
    }
  }

  toggle(label: string, value: boolean, onChange: (v: boolean) => void) {
    const row = this.row(label)
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = value
    input.addEventListener('change', () => onChange(input.checked))
    row.append(input)
    return input
  }

  buttons(label: string, items: { text: string; title?: string; onClick: () => void }[]) {
    const row = this.row(label)
    const wrap = document.createElement('span')
    wrap.className = 'be-hud-buttons'
    for (const it of items) {
      const b = document.createElement('button')
      b.textContent = it.text
      if (it.title) b.title = it.title
      b.addEventListener('click', (e) => {
        e.preventDefault()
        it.onClick()
      })
      wrap.appendChild(b)
    }
    row.append(wrap)
    return wrap
  }

  select(label: string, options: { value: string; text: string }[], onChange: (v: string) => void) {
    const row = this.row(label)
    const sel = document.createElement('select')
    sel.className = 'be-hud-select'
    for (const o of options) sel.add(new Option(o.text, o.value))
    sel.addEventListener('change', () => onChange(sel.value))
    row.append(sel)
    return sel
  }

  text(label: string) {
    const row = this.row(label)
    const span = document.createElement('span')
    span.className = 'be-hud-text'
    row.append(span)
    return span
  }

  note(html: string) {
    const div = document.createElement('div')
    div.className = 'be-hud-note'
    div.innerHTML = html
    this.body.appendChild(div)
    return div
  }

  private row(label: string) {
    const row = document.createElement('label')
    row.className = 'be-hud-row'
    row.innerHTML = `<span class="be-hud-label">${label}</span>`
    this.body.appendChild(row)
    return row
  }
}

function injectStyle() {
  if (document.getElementById('be-hud-style')) return
  const s = document.createElement('style')
  s.id = 'be-hud-style'
  s.textContent = `
  .be-hud { position: fixed; left: 14px; bottom: 14px; padding: 10px 14px 10px; min-width: 300px;
    background: rgba(6, 10, 20, 0.62); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    border: 1px solid rgba(140, 170, 255, 0.15); border-radius: 10px; color: #cfdcff;
    font: 12px/1.5 system-ui, -apple-system, sans-serif; user-select: none; }
  .be-hud-title { font-weight: 600; font-style: italic; color: #6f8dff; letter-spacing: .02em; margin-bottom: 4px; }
  .be-hud-row { display: flex; align-items: center; gap: 8px; margin: 3px 0; }
  .be-hud-label { width: 86px; opacity: .75; }
  .be-hud-row input[type=range] { flex: 1; accent-color: #6f8dff; }
  .be-hud-val { width: 96px; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .be-hud-text { font-variant-numeric: tabular-nums; }
  .be-hud-note { opacity: .55; margin-top: 6px; font-size: 11px; }
  .be-hud-select { flex: 1; font: inherit; color: #cfdcff; background: rgba(20, 28, 50, 0.9);
    border: 1px solid rgba(140, 170, 255, 0.25); border-radius: 5px; padding: 2px 4px; }
  .be-hud-buttons { display: flex; flex-wrap: wrap; gap: 4px; }
  .be-hud-buttons button { font: inherit; font-size: 11px; color: #cfdcff; background: rgba(111, 141, 255, 0.14);
    border: 1px solid rgba(140, 170, 255, 0.25); border-radius: 5px; padding: 1px 7px; cursor: pointer; }
  .be-hud-buttons button:hover { background: rgba(111, 141, 255, 0.3); }`
  document.head.appendChild(s)
}
