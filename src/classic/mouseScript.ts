export interface Mouse {
  x: number
  y: number
  left: boolean
}

/** Parses tests/fixtures/classic/mouse-script.txt (see the format notes in that file). */
export function parseMouseScript(text: string): (t: number) => Mouse {
  const segs = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split(/\s+/).map(Number))
  return (t) => {
    const m = { x: 400, y: 300, left: false }
    for (const [t0, t1, x0, y0, x1, y1, left] of segs) {
      if (t < t0 || t > t1) continue
      const a = t1 === t0 ? 0 : (t - t0) / (t1 - t0)
      m.x = Math.floor(x0 + a * (x1 - x0))
      m.y = Math.floor(y0 + a * (y1 - y0))
      m.left = left !== 0
    }
    return m
  }
}
