// public/_headers, written from worker/lib/security-headers.ts: the static files carry the same headers the Worker sets
// on its own responses (spec 11). Run after changing that module: node scripts/security-headers.mjs
// scripts/security-headers.test.mjs fails when the file and the module differ.
import { writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { CSP, SECURITY_HEADERS } from "../worker/lib/security-headers.ts"

export const FILE = new URL("../public/_headers", import.meta.url)

export function headersFile() {
  const lines = Object.entries({ ...SECURITY_HEADERS, "Content-Security-Policy": CSP }).map(([k, v]) => `  ${k}: ${v}`)
  // /assets is reserved for Vite content-hashed build outputs and the map's versioned terrain tiles. bundle-check verifies
  // every filename before deploy.
  // HTML must revalidate to discover the next build. No API/private/media response inherits these static rules.
  // No Cache-Control on /*: Cloudflare combines matching custom rules, which would retain no-cache on assets.
  // no-transform: the domain's zone injects Cloudflare's analytics script into HTML it may transform (18 October 2026);
  // the site promises no outside measurement, and the CSP would refuse the script anyway.
  return `# Written by scripts/security-headers.mjs from worker/lib/security-headers.ts; don't edit by hand.\n/*\n${lines.join("\n")}\n/\n  Cache-Control: no-cache, no-transform\n/admin/*\n  Cache-Control: no-cache, no-transform\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(FILE, headersFile())
  console.log("public/_headers written")
}
