import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

/** Opens a spike page and returns the payload it logs as `SPIKE {json}`. */
async function runSpike(page: Page, query: string): Promise<{ name: string; backend: string; data: any }> {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const result = new Promise<any>((resolve) => {
    page.on('console', (m) => {
      const t = m.text()
      if (t.startsWith('SPIKE ')) resolve(JSON.parse(t.slice(6)))
    })
  })
  await page.goto(`/spikes/?${query}`)
  const r = await result
  expect(errors).toEqual([])
  expect(r.name, JSON.stringify(r.data)).not.toBe('error')
  return r
}

for (const backend of ['webgpu', 'webgl2']) {
  test(`executors match the CPU reference [${backend}]`, async ({ page }) => {
    const r = await runSpike(page, `spike=a&backend=${backend}`)
    expect(r.backend).toBe(backend)
    for (const e of r.data) expect(e.maxAbsErr, e.executor).toBeLessThan(1e-4)
    expect(r.data.length).toBe(backend === 'webgpu' ? 2 : 1)
  })

  test(`EAC face arrays reproject within tolerance [${backend}]`, async ({ page }) => {
    const { data } = await runSpike(page, `spike=d&backend=${backend}`)
    expect(data['array-uastc'].mean).toBeLessThan(0.008)
    expect(data['array-etc1s'].mean).toBeLessThan(0.015)
    expect(data['array-uastc-WRONG-gutter'].mean).toBeGreaterThan(data['array-uastc'].mean * 1.5)
    expect(data['height-r16f (m)'].mean).toBeLessThan(100)
  })
}

for (const backend of ['webgpu', 'webgl2']) {
  test(`Classic 2004 GPU port is bit-exact with the Java golden frames [${backend}]`, async ({ page }) => {
    // 600 frames + 12 readbacks: minutes on CI's software renderer (2-core runner).
    test.setTimeout(process.env.CI ? 900_000 : 240_000)
    const { data } = await runSpike(page, `spike=classic&backend=${backend}`)
    for (const r of data) expect(r.mismatches, r.executor).toEqual({})
  })
}

for (const backend of ['webgpu', 'webgl2']) {
  test(`globe renders with atmosphere [${backend}]`, async ({ page }) => {
    test.skip(!existsSync('public/data/manifest.json'), 'needs globe data (pipeline build)')
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`/?backend=${backend}&date=2026-07-09T11:00:00Z&intro=0`)
    await expect(page.locator('.be-hud')).toContainText(backend, { timeout: 30_000 })
    await page.waitForTimeout(2500)
    const shot = await page.locator('body > canvas').screenshot()
    expect(shot.byteLength).toBeGreaterThan(200_000)
    expect(errors).toEqual([])
  })
}

test('clicking the ocean drops a wave that changes the picture', async ({ page }) => {
  test.skip(!existsSync('public/data/manifest.json'), 'needs globe data (pipeline build)')
  test.setTimeout(90_000)
  await page.goto('/?date=2026-07-09T23:00:00Z&lat=5&lon=-160&alt=9000&clouds=0&warp=1200&hud=0&intro=0')
  await expect(page.locator('.be-hud')).toBeAttached()
  await page.waitForTimeout(2500)
  const box = await page.locator('body > canvas').boundingBox()
  const crop = { x: box!.width / 2 - 200, y: box!.height / 2 - 200, width: 400, height: 400 }
  const before = await page.screenshot({ clip: crop })
  const drop = page.waitForEvent('console', (m) => m.text().startsWith('drop'))
  await page.mouse.click(box!.width / 2, box!.height / 2)
  await drop
  await page.waitForTimeout(3000)
  const after = await page.screenshot({ clip: crop })
  expect(Buffer.compare(before, after)).not.toBe(0)
})

test('Sumatra 2004 preset: modelled arrival times match observations (±35%)', async ({ page }) => {
  test.skip(!existsSync('public/data/manifest.json'), 'needs globe data (pipeline build)')
  test.setTimeout(240_000)
  const { data } = await runSpike(page, 'spike=preset&preset=sumatra2004&hours=9')
  const observed: Record<string, number> = { 'Sri Lanka (Batticaloa)': 2, Phuket: 2, Chennai: 2.5, 'Maldives (Malé)': 3.3, 'Somalia (Hafun)': 7 }
  for (const [k, obs] of Object.entries(observed)) {
    const t = data.gauges[k].arrivalH
    expect(t, k).not.toBeNull()
    expect(Math.abs(t / obs - 1), `${k}: ${t} h vs ${obs} h`).toBeLessThan(0.35)
  }
})

test('a preset places tide gauges that record the wave', async ({ page }) => {
  test.skip(!existsSync('public/data/manifest.json'), 'needs globe data (pipeline build)')
  test.setTimeout(90_000)
  await page.goto('/?preset=tohoku2011&intro=0&warp=3000')
  await expect(page.locator('.be-gauges')).toBeVisible()
  await expect(page.locator('.be-gauge-marker')).toHaveCount(4)
  await page.waitForTimeout(6000)
  // The chart has drawn non-trivial content (Kushiro sees the wave within the first hour).
  const ink = await page.locator('.be-gauges canvas').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++
    return n
  })
  expect(ink).toBeGreaterThan(2000)
})

test('progressive start: Low imagery first, then upgraded to Medium', async ({ page }) => {
  test.skip(!existsSync('public/data/manifest.json'), 'needs globe data (pipeline build)')
  const first = page.waitForEvent('console', (m) => m.text().startsWith('first data (low + medium sim)'))
  const upgraded = page.waitForEvent('console', { predicate: (m) => m.text().startsWith('upgraded to medium'), timeout: 60_000 })
  await page.goto('/?intro=0&tier=medium')
  await first
  await upgraded
  await expect(page.locator('.be-hud .tier')).toHaveText('tier medium')
})

test('close zoom streams 500 m tiles', async ({ page }) => {
  test.skip(!existsSync('public/data/tiles/index.json'), 'needs tiles (uv run python -m blueearth_pipeline.tiles)')
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/?tier=high&progressive=0&intro=0&clouds=0&lat=46.2&lon=8.5&alt=150')
  // The Perf line reports how many tiles have been uploaded.
  await expect
    .poll(async () => Number((await page.locator('.be-hud').textContent())?.match(/500 m tiles (\d+)/)?.[1] ?? 0), { timeout: 30_000 })
    .toBeGreaterThan(10)
  expect(errors).toEqual([])
})

test('globe page explains missing data instead of failing silently', async ({ page }) => {
  await page.route('**/data/manifest.json', (r) => r.fulfill({ status: 404, body: 'nope' }))
  await page.goto('/')
  await expect(page.locator('#hud')).toContainText('Classic 2004')
})

for (const backend of ['webgpu', 'webgl2']) {
  test(`shallow-water GPU solver matches the float64 reference; lake at rest exact [${backend}]`, async ({ page }) => {
    test.setTimeout(240_000)
    const { data } = await runSpike(page, `spike=swe&backend=${backend}`)
    for (const r of data) {
      expect(r.parityMaxDeta, r.executor).toBeLessThan(1e-3)
      expect(r.parityMaxDmRel, r.executor).toBeLessThan(1e-3)
      expect(r.lakeMaxM, r.executor).toBe(0)
      expect(r.lakeMaxDeta, r.executor).toBe(0)
    }
  })
}

test('Classic mode: waves, sea-level strip and right-click exit', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/?mode=classic')
  await page.waitForTimeout(5000) // the intro drains the sea over 256 frames
  // 800×600 fitted into 1280×800 → scale 4/3, x offset 106.7.
  const X = (x: number) => 106.7 + (x * 4) / 3
  const Y = (y: number) => (y * 4) / 3
  const before = await page.locator('body > canvas').screenshot()
  await page.mouse.move(X(270), Y(290))
  await page.mouse.down()
  await page.waitForTimeout(400)
  await page.mouse.up()
  // Poll: on a software renderer a new frame can take a while. GitHub's runners (SwiftShader)
  // read back GPU results fine but present a blank canvas; there only the exit is checked.
  if (before.byteLength > 20_000)
    await expect
      .poll(async () => Buffer.compare(before, await page.locator('body > canvas').screenshot()), { timeout: 30_000 })
      .not.toBe(0)
  else test.info().annotations.push({ type: 'note', description: `blank canvas (${before.byteLength} B): pixel check skipped` })
  await page.mouse.click(X(400), Y(300), { button: 'right' })
  await page.waitForURL((u) => !u.search.includes('mode=classic'))
  // Navigating away mid-frame can abort pending WebGPU error scopes (benign teardown noise).
  expect(errors.filter((e) => !e.includes('Instance dropped in popErrorScope'))).toEqual([])
})


test('globe data tiers load (skipped until the pipeline has been run)', async ({ page }) => {
  test.skip(!existsSync('public/data/manifest.json'), 'run: cd pipeline && uv run python -m blueearth_pipeline.build')
  for (const tier of ['low', 'medium']) {
    const { data } = await runSpike(page, `spike=data&tier=${tier}`)
    expect(data.tier).toBe(tier)
  }
})
