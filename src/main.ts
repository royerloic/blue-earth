import { startClassicMode } from './app/modes/ClassicMode'
import { startGlobeMode } from './app/modes/GlobeMode'
import { createRenderer } from './core/renderer'

/** Switches mode by URL (?mode=classic), so every mode is linkable and starts clean. */
export function gotoMode(mode: 'globe' | 'classic') {
  const url = new URL(location.href)
  if (mode === 'globe') url.searchParams.delete('mode')
  else url.searchParams.set('mode', mode)
  location.href = url.toString()
}

async function main() {
  const info = await createRenderer()
  const mode = new URLSearchParams(location.search).get('mode')
  if (mode === 'classic') await startClassicMode(info, () => gotoMode('globe'))
  else {
    await startGlobeMode(info)
    addEventListener('keydown', (e) => e.key.toLowerCase() === 'c' && gotoMode('classic'))
  }
}

main()
