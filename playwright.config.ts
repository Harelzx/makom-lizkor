import { defineConfig, devices } from "@playwright/test"

// UX motion checks: they sample real frames, so they run one at a time.
// Against the dev server by default; `npm run e2e:prod` runs the same checks on the production build.
const prod = !!process.env.E2E_PROD
const port = prod ? 4174 : 5190

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${port}`, ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
  webServer: {
    command: prod ? `npm run build && npx vite preview --port ${port} --strictPort` : `npm run dev -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !prod,
    timeout: 120_000,
  },
})
