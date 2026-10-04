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

test('hello globe renders a non-blank frame', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await expect(page.locator('#hud')).toContainText('Blue Earth')
  await page.waitForTimeout(1500)
  const shot = await page.locator('canvas').screenshot()
  // A blank black canvas compresses to a tiny PNG; a rendered globe does not.
  expect(shot.byteLength).toBeGreaterThan(50_000)
  expect(errors).toEqual([])
})
