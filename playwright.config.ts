import { defineConfig, devices } from "@playwright/test"
import { checkoutPorts } from "./scripts/parallel/ports.mjs"

// The dev server runs the Worker too, against a local D1 that gets every migration first.
// UX motion checks: they sample real frames, so they run one at a time.
// Against the dev server by default; `npm run e2e:prod` runs the same checks on the production build.
// Ports per checkout: 5190 and 4174 in the main checkout, and a slot of its own in each parallel worktree, so
// reuseExistingServer only ever reuses this checkout's own server, never another worktree's.
const prod = !!process.env.E2E_PROD
const ports = checkoutPorts(import.meta.dirname)
const port = prod ? ports.prod : ports.e2e

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${port}`, ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
  webServer: {
    command: prod
      ? `node scripts/dev-vars.mjs && npm run db:migrate:local && npm run build && npx vite preview --port ${port} --strictPort`
      : `npm run db:migrate:local && npm run dev -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !prod,
    timeout: 120_000,
  },
})
