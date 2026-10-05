/** Data/simulation quality tiers (see pipeline TIERS) and the startup choice. */
export type Tier = 'low' | 'medium' | 'high'
export const TIERS: Tier[] = ['low', 'medium', 'high']
const KEY = 'blue-earth.tier'

/**
 * Tier at startup: ?tier=, else a remembered user choice, else a device heuristic: phones and
 * the WebGL2 fallback (typically older/weaker GPUs) get Low, everything else Medium.
 */
export function pickTier(backend: string, query = new URLSearchParams(location.search)): Tier {
  const q = query.get('tier') as Tier | null
  if (q && TIERS.includes(q)) return q
  const saved = localStorage.getItem(KEY) as Tier | null
  if (saved && TIERS.includes(saved)) return saved
  if (matchMedia('(pointer: coarse)').matches) return 'low'
  return backend === 'webgpu' ? 'medium' : 'low'
}

export function rememberTier(t: Tier | 'auto') {
  if (t === 'auto') localStorage.removeItem(KEY)
  else localStorage.setItem(KEY, t)
}
