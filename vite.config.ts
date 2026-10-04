import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// MapLibre v6 loads its worker via `new URL(..., import.meta.url)`; pre-bundling breaks that path.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: "@", replacement: resolve(import.meta.dirname, "./src") },
      // every `import { cn } from "cn"` (shadcn components included) gets the project-configured merger
      { find: /^cn$/, replacement: resolve(import.meta.dirname, "./src/lib/cn.ts") },
    ],
  },
  // A port of its own: 5173 is shared with other local projects, and two servers on it answer at random.
  server: { port: 5174, strictPort: true },
  optimizeDeps: { exclude: ["maplibre-gl"] },
  worker: { format: "es" },
})
