import { createRenderer } from './core/renderer'

/** Switches mode by URL (?mode=classic), so every mode is linkable and starts clean. */
export function gotoMode(mode: 'globe' | 'classic') {
  const url = new URL(location.href)
  if (mode === 'globe') url.searchParams.delete('mode')
  else url.searchParams.set('mode', mode)
  location.href = url.toString()
}

/** Space toggles fullscreen in every mode. */
function installFullscreenToggle() {
  addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat || (e.target as HTMLElement).tagName === 'TEXTAREA') return
    e.preventDefault()
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen().catch(() => {})
  })
}

async function main() {
  installFullscreenToggle()
  const info = await createRenderer()
  const mode = new URLSearchParams(location.search).get('mode')
  if (mode === 'classic') {
    addEventListener('keydown', (e) => e.key.toLowerCase() === 'c' && gotoMode('globe'))
    // Modes are separate chunks: Classic doesn't need the atmosphere or the ocean solver.
    const { startClassicMode } = await import('./app/modes/ClassicMode')
    await startClassicMode(info, () => gotoMode('globe'))
  }
  else {
    addEventListener('keydown', (e) => e.key.toLowerCase() === 'c' && gotoMode('classic'))
    try {
      const { startGlobeMode } = await import('./app/modes/GlobeMode')
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
