import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

// The browser code's own logic (the store, the outboxes), run in Node with storage stood in for: what can't be timed
// reliably through a real page, such as two writes finishing out of order.
export default defineConfig({
  resolve: { alias: [{ find: "@", replacement: resolve(import.meta.dirname, "./src") }] },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
})
