import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { defineConfig } from "vitest/config"
import { experimental_readRawConfig } from "wrangler"

const migrations = await readD1Migrations(resolve(import.meta.dirname, "migrations"))
// The vars a deploy would ship, before .dev.vars turns development on locally; a test checks they are safe.
// The tests run with the committed template's synthetic development values, never with a developer's own .dev.vars.
const devVars = Object.fromEntries(
  readFileSync(resolve(import.meta.dirname, ".dev.vars.example"), "utf8")
    .split("\n")
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
)
const deployVars = experimental_readRawConfig({ config: resolve(import.meta.dirname, "wrangler.jsonc") }).rawConfig.vars ?? {}

// The Worker's tests run inside workerd, against a fresh local D1 with every migration applied.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: { ...devVars, TEST_MIGRATIONS: migrations, DEPLOY_VARS: deployVars } },
    }),
  ],
  resolve: { alias: [{ find: "@", replacement: resolve(import.meta.dirname, "./src") }] },
  test: { include: ["worker/test/**/*.test.ts"], setupFiles: ["./worker/test/apply-migrations.ts"] },
})
