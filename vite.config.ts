import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  // GitHub Pages serves the site under /<repo>/; override with BASE=/ for local preview.
  base: process.env.BASE ?? './',
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        spikes: resolve(root, 'spikes/index.html'),
      },
    },
  },
  server: { port: 5173 },
})
