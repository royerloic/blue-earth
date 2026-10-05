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
    test.setTimeout(240_000)
    const { data } = await runSpike(page, `spike=classic&backend=${backend}`)
    for (const r of data) expect(r.mismatches, r.executor).toEqual({})
  })
}

for (const backend of ['webgpu', 'webgl2']) {
  test(`globe renders with atmosphere [${backend}]`, async ({ page }) => {
    test.skip(!existsSync('public/data/manifest.json'), 'needs globe data (pipeline build)')
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`/?backend=${backend}&date=2026-07-09T11:00:00Z`)
    await expect(page.locator('.be-hud')).toContainText(backend)
    await page.waitForTimeout(2500)
    const shot = await page.locator('canvas').screenshot()
    expect(shot.byteLength).toBeGreaterThan(200_000)
    expect(errors).toEqual([])
  })
}

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
  const before = await page.locator('canvas').screenshot()
  await page.mouse.move(X(270), Y(290))
  await page.mouse.down()
  await page.waitForTimeout(400)
  await page.mouse.up()
  await page.waitForTimeout(800)
  const after = await page.locator('canvas').screenshot()
  expect(Buffer.compare(before, after)).not.toBe(0)
  await page.mouse.click(X(400), Y(300), { button: 'right' })
  await page.waitForURL((u) => !u.search.includes('mode=classic'))
  expect(errors).toEqual([])
})


test('globe data tiers load (skipped until the pipeline has been run)', async ({ page }) => {
  test.skip(!existsSync('public/data/manifest.json'), 'run: cd pipeline && uv run python -m blueearth_pipeline.build')
  for (const tier of ['low', 'medium']) {
    const { data } = await runSpike(page, `spike=data&tier=${tier}`)
    expect(data.tier).toBe(tier)
  }
})
