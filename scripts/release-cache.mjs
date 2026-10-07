// Workers Caching is staging's alone until a production decision (L-CACHE-STG, a95). The release builds with no
// CLOUDFLARE_ENV, so production deploys the top-level configuration as the build wrote it (dist/makom_lizkor/
// wrangler.json): neither it, nor the raw file's top level, nor any environment but staging, nor any entrypoint
// override may turn the cache on.
//   node scripts/release-cache.mjs <built wrangler.json>   (release.yml, right after the build)
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

const caches = (c) => c?.cache?.enabled === true || Object.values(c?.exports ?? {}).some((e) => e?.cache?.enabled === true)

export function cacheBlockers(raw, built = null) {
  const out = []
  if (caches(raw)) out.push("wrangler.jsonc turns Workers Caching on at the top level: production's cache stays off (L-CACHE-STG)")
  for (const [name, env] of Object.entries(raw?.env ?? {}))
    if (name !== "staging" && caches(env)) out.push(`wrangler.jsonc turns Workers Caching on for env.${name}: only staging may`)
  if (built && caches(built))
    out.push("the built Worker configuration the release deploys turns Workers Caching on: production's stays off")
  return out
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2]
  if (!path) {
    console.error("usage: node scripts/release-cache.mjs <built wrangler.json>")
    process.exit(2)
  }
  const blockers = cacheBlockers({}, JSON.parse(readFileSync(path, "utf8")))
  for (const b of blockers) console.error(b)
  process.exit(blockers.length ? 1 : 0)
}
