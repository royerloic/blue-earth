import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

/**
 * Visual regression: frozen scenes (fixed date, camera, sea level; sim paused; no intro,
 * panel or auto-tuning) compared with per-platform baselines in visual.spec.ts-snapshots/.
 * Update with `npx playwright test visual --update-snapshots` after an intended change.
 */
const SCENES: Record<string, string> = {
  'day-africa': 'lat=20&lon=15&alt=20000&date=2026-07-09T11:00:00Z',
  'glint-atlantic': 'lat=20&lon=-35&alt=12000&date=2026-07-09T14:30:00Z&clouds=0',
  'night-europe': 'lat=45&lon=10&alt=8000&date=2026-07-09T21:00:00Z',
  'ice-age-sundaland': 'lat=3&lon=108&alt=4500&S=-120&clouds=0&date=2026-07-09T05:00:00Z',
  'ice-free-europe': 'lat=50&lon=10&alt=4500&S=70&clouds=0&date=2026-07-09T11:00:00Z',
  'arrival-sumatra': 'preset=sumatra2004&overlay=2&clouds=0&date=2004-12-26T06:00:00Z',
}

test.describe('visual regression', () => {
  test.skip(!existsSync('public/data/manifest.json'), 'needs globe data (pipeline build)')
  for (const [name, q] of Object.entries(SCENES)) {
    test(name, async ({ page }) => {
      const preset = q.includes('preset=')
      // Presets need a few simulated hours for the overlay; everything else is frozen.
      await page.goto(`/?${q}&tier=medium&progressive=0&intro=0&hud=0&dpr=1&warp=${preset ? 3000 : 0}`)
      await expect(page.locator('.be-hud')).toBeAttached({ timeout: 30_000 })
      if (preset) {
        await page.waitForFunction(() => /Sim time\s*[4-9] h/.test(document.querySelector('.be-hud')?.textContent ?? ''), null, { timeout: 60_000 })
        await page.evaluate(() => {
          // Pause the sim so the screenshot is stable: the Sim speed slider is the 2nd range input.
          const s = document.querySelectorAll<HTMLInputElement>('.be-hud input[type=range]')[1]
          s.value = '0'
          s.dispatchEvent(new Event('input'))
        })
      }
      await page.waitForTimeout(4000)
      await expect(page.locator('body > canvas')).toHaveScreenshot(`${name}.png`, { maxDiffPixelRatio: 0.02, threshold: 0.15, timeout: 15_000 })
    })
  }
})
