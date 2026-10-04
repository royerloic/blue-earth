import { createRenderer } from '../src/core/renderer'
import { runExecutorSpike } from './a-executors/run'
import { runAtmosphereSpike } from './c-atmosphere/run'
import { runKtxSpike } from './d-ktx/run'
import { runClassicSpike } from './classic/run'
import { runDataPreview } from './data/run'
import { probeUniforms } from './classic/uniformProbe'

// M0 spike harness. Results are logged as `SPIKE <json>` for tools/shot.mjs to collect.
async function main() {
  const { renderer, backend } = await createRenderer()
  const list = document.getElementById('list')!
  const report = (name: string, data: unknown) => {
    console.log('SPIKE', JSON.stringify({ name, backend, data }))
    const li = document.createElement('li')
    li.textContent = `${name} [${backend}]: ${JSON.stringify(data)}`
    list.appendChild(li)
  }
  const which = new URLSearchParams(location.search).get('spike') ?? 'a'
  try {
    if (which === 'a') report('executors', await runExecutorSpike(renderer, backend))
    if (which === 'data') report('data', await runDataPreview(renderer))
    if (which === 'uniforms') report('uniforms', await probeUniforms(renderer))
    if (which === 'classic') report('classic', await runClassicSpike(renderer, backend))
    if (which === 'd') report('ktx', await runKtxSpike(renderer))
    if (which === 'c') report('atmosphere', await runAtmosphereSpike(renderer))
  } catch (e) {
    report('error', String((e as Error).stack ?? e))
  }
  console.log('SPIKE-DONE')
}
main()
