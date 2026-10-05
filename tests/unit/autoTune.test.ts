import { describe, expect, it } from 'vitest'
import { AutoTune } from '../../src/core/quality/autoTune'

describe('AutoTune', () => {
  it('lowers resolution first, then sim steps, when frames are slow; recovers when fast', () => {
    const a = new AutoTune(2, 0.6)
    for (let i = 0; i < 400; i++) a.update(40) // 25 fps for 16 s
    expect(a.pixelRatio).toBeCloseTo(0.6, 5)
    expect(a.maxSteps).toBeLessThan(4)
    for (let i = 0; i < 8000; i++) a.update(8) // 125 fps for 64 s (recovery is deliberately slow)
    expect(a.maxSteps).toBe(4)
    expect(a.pixelRatio).toBeGreaterThan(1)
  })
  it('stays put at a steady 60 fps', () => {
    const a = new AutoTune(2, 0.6)
    for (let i = 0; i < 2000; i++) a.update(16.7)
    expect(a.pixelRatio).toBe(2)
    expect(a.maxSteps).toBe(4)
  })
})
