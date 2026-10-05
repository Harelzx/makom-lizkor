import { resolve } from "node:path"
import { cloudflare } from "@cloudflare/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { checkoutPorts } from "./scripts/parallel/ports.mjs"

// MapLibre v6 loads its worker via `new URL(..., import.meta.url)`; pre-bundling breaks that path.
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
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
  server: { port: checkoutPorts(import.meta.dirname).dev, strictPort: true },
  optimizeDeps: { exclude: ["maplibre-gl"] },
  worker: { format: "es" },
})
