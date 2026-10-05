import { defineConfig } from 'vitest/config'

// Numerics tests run real solver steps; CI runners are a few times slower than a laptop.
export default defineConfig({ test: { include: ['tests/unit/**/*.test.ts'], testTimeout: 60_000 } })
