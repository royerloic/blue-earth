import { defineConfig } from '@playwright/test'

// GPU tests drive the spike pages in headless Chrome with WebGPU enabled.
// Locally (macOS) the installed Chrome uses Metal; in CI (Linux) Chromium uses SwiftShader.
// GPU=linux: real GPU on a Linux box (Vulkan), e.g. obsidian's NVIDIA card.
const ci = !!process.env.CI
const linuxGpu = process.env.GPU === 'linux'
const args = linuxGpu
  ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan,VulkanFromANGLE', '--use-angle=vulkan', '--ignore-gpu-blocklist', '--enable-gpu']
  : ci
    ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader']
    : ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist']

export default defineConfig({
  testDir: 'tests/gpu',
  timeout: ci ? 180_000 : 90_000,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5174',
    channel: ci || linuxGpu ? undefined : 'chrome',
    launchOptions: { args },
    viewport: { width: 1280, height: 800 },
  },
  webServer: { command: 'npx vite --port 5174 --strictPort', port: 5174, reuseExistingServer: !ci },
})
