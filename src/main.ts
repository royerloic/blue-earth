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
    addEventListener('keydown', (e) => e.key.toLowerCase() === 'c' && gotoMode('classic'))
    try {
      await startGlobeMode(info)
    } catch (e) {
      console.error(e)
      const hud = document.getElementById('hud')!
      hud.innerHTML = `Globe data could not be loaded (${(e as Error).message}).<br>
        Build it with <code>cd pipeline &amp;&amp; uv run python -m blueearth_pipeline.build</code>,
        or press <b>C</b> for Classic 2004.`
      hud.style.cssText += ';font-size:14px;bottom:auto;top:40%;left:50%;transform:translateX(-50%);text-align:center'
    }
  }
}

main()
