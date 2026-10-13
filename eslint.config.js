import js from "@eslint/js"
import globals from "globals"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import tseslint from "typescript-eslint"
import { defineConfig, globalIgnores } from "eslint/config"

export default defineConfig([
  // Generated reports and trace resources can change while browser tests run; lint the source/specs, not captured bundles.
  globalIgnores(["dist", "worker-configuration.d.ts", ".wrangler", "test-results", "playwright-report", "coverage"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended, reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  // The Worker logs only through worker/lib/log.ts, whose lines are kept to a schema (spec 11).
  {
    files: ["worker/**/*.ts"],
    ignores: ["worker/lib/log.ts", "worker/test/**"],
    rules: { "no-console": "error" },
  },
])
