import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin"
import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

const migrations = await readD1Migrations(resolve(import.meta.dirname, "migrations"))

// The Worker's tests run inside workerd, against a fresh local D1 with every migration applied.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" }, miniflare: { bindings: { TEST_MIGRATIONS: migrations } } })],
  resolve: { alias: [{ find: "@", replacement: resolve(import.meta.dirname, "./src") }] },
  test: { include: ["worker/test/**/*.test.ts"], setupFiles: ["./worker/test/apply-migrations.ts"] },
})
