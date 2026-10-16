import { resolve } from "node:path"
import { cloudflare } from "@cloudflare/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { checkoutPorts } from "./scripts/parallel/ports.mjs"

// MapLibre v6 loads its worker via `new URL(..., import.meta.url)`; pre-bundling breaks that path.
export default defineConfig({
  plugins: [
    {
      name: "public-preview-indexing",
      transformIndexHtml() {
        return process.env.VITE_PUBLIC_PREVIEW === "true"
          ? [{ tag: "meta", attrs: { name: "robots", content: "noindex, nofollow" }, injectTo: "head" as const }]
          : []
      },
    },
    react(),
    tailwindcss(),
    // The e2e servers keep their local D1 and R2 apart (E2E_STATE, fresh each run), so demo submissions from earlier
    // runs never fill the review queue; everything else uses .wrangler/state.
    cloudflare({ persistState: process.env.E2E_STATE ? { path: process.env.E2E_STATE } : true }),
  ],
  resolve: {
    alias: [
      { find: "@", replacement: resolve(import.meta.dirname, "./src") },
      // every `import { cn } from "cn"` (shadcn components included) gets the project-configured merger
      { find: /^cn$/, replacement: resolve(import.meta.dirname, "./src/lib/cn.ts") },
    ],
  },
  // A port of its own: 5173 is shared with other local projects, and two servers on it answer at random.
  // The main checkout keeps 5174; each parallel worktree gets its own, so their dev servers never collide.
  // Two pages: the site, and the moderators' queue (protected by Access in production; its data by /api/admin).
  // Only the browser's build gets them: the Worker's build has its own entry, from wrangler.jsonc.
  environments: {
    client: {
      build: {
        rolldownOptions: {
          input: { main: resolve(import.meta.dirname, "index.html"), admin: resolve(import.meta.dirname, "admin/index.html") },
        },
      },
    },
  },
  // Other sessions' worktrees live under .claude/worktrees; without this, a change there (index.html, tsconfig)
  // full-reloads this checkout's page and kills a film render or an e2e run midway. Only this checkout's own
  // .claude/worktrees: a worktree's own path runs through the main checkout's, and "**/.claude/worktrees/**"
  // would ignore every file of a dev server running inside one (no HMR at all).
  server: {
    port: checkoutPorts(import.meta.dirname).dev,
    strictPort: true,
    watch: { ignored: [resolve(import.meta.dirname, ".claude/worktrees/**")] },
  },
  optimizeDeps: { exclude: ["maplibre-gl"] },
  worker: { format: "es" },
})
