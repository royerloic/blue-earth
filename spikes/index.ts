import { createRenderer } from '../src/core/renderer'
import { runExecutorSpike } from './a-executors/run'
import { runAtmosphereSpike } from './c-atmosphere/run'

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
    if (which === 'c') report('atmosphere', await runAtmosphereSpike(renderer))
  } catch (e) {
    report('error', String((e as Error).stack ?? e))
  }
  console.log('SPIKE-DONE')
}
main()
