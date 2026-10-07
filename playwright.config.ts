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
// A fresh local D1 and R2 for every run, with every migration applied first: what earlier runs left (hundreds of demo
// submissions) would otherwise fill the review queue.
const state = `.wrangler/e2e-state-${prod ? "prod" : "dev"}`
const fresh = `rm -rf ${state} && npx wrangler d1 migrations apply makom-dev --local --persist-to ${state}`

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 900 },
    // On CI a failed test keeps its trace (DOM, network, console and timing, step by step) in test-results/, which the
    // workflow uploads: a timing failure there is read from its timeline, not guessed from the last snapshot (a72).
    // Not locally, where it would only slow the UX motion checks.
    trace: process.env.CI ? "retain-on-failure" : "off",
  },
  // The site's own places come from the database (phase 7): the "seed" project imports them into the fresh state
  // first, and every spec depends on it (a test filter still runs it: dependencies always run).
  projects: [
    { name: "seed", testMatch: /seed\.setup\.ts/ },
    { name: "e2e", dependencies: ["seed"], testIgnore: /seed\.setup\.ts/ },
  ],
  webServer: {
    command: prod
      ? `node scripts/dev-vars.mjs && ${fresh} && npm run build && npx vite preview --port ${port} --strictPort`
      : `${fresh} && npm run dev -- --port ${port} --strictPort`,
    env: { E2E_STATE: state },
    url: `http://localhost:${port}`,
    // Never another process's server: only one started here has the fresh state above.
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
