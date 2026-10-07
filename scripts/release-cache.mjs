// Workers Caching is staging's alone until a production decision (L-CACHE-STG, a95). The release builds with no
// CLOUDFLARE_ENV, so production deploys the top-level configuration as the build wrote it (dist/makom_lizkor/
// wrangler.json): neither it, nor the raw file's top level, nor any environment but staging, nor any entrypoint
// override may turn the cache on. And each configuration's EDGE_CACHE must say what its Worker's cache is (C-CACHE):
// the Worker skips purges only when it is "off" (worker/lib/purge.ts), so "off" with a cache on would leave copies no
// purge clears, and anything else with no cache would report every purge as given up.
//   node scripts/release-cache.mjs <built wrangler.json>   (release.yml, right after the build)
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

const caches = (c) => c?.cache?.enabled === true || Object.values(c?.exports ?? {}).some((e) => e?.cache?.enabled === true)

/** A configuration whose EDGE_CACHE isn't what its `cache` block makes it. Vars aren't inherited by an environment. */
function mode(c, where) {
  const want = caches(c) ? "on" : "off"
  const has = c?.vars?.EDGE_CACHE
  return has === want
    ? []
    : [`${where} sets EDGE_CACHE to ${has === undefined ? "nothing" : JSON.stringify(has)}, but its Worker cache is ${want}`]
}

/** What stops a release; `raw` is wrangler.jsonc as read (null: the built configuration alone). */
export function cacheBlockers(raw, built = null) {
  const out = []
  if (raw) {
    if (caches(raw)) out.push("wrangler.jsonc turns Workers Caching on at the top level: production's cache stays off (L-CACHE-STG)")
    out.push(...mode(raw, "wrangler.jsonc's top level"))
    for (const [name, env] of Object.entries(raw.env ?? {})) {
      if (name !== "staging" && caches(env)) out.push(`wrangler.jsonc turns Workers Caching on for env.${name}: only staging may`)
      out.push(...mode(env, `wrangler.jsonc's env.${name}`))
    }
  }
  if (built) {
    if (caches(built)) out.push("the built Worker configuration the release deploys turns Workers Caching on: production's stays off")
    out.push(...mode(built, "the built Worker configuration the release deploys"))
  }
  return out
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2]
  if (!path) {
    console.error("usage: node scripts/release-cache.mjs <built wrangler.json>")
    process.exit(2)
  }
  const blockers = cacheBlockers(null, JSON.parse(readFileSync(path, "utf8")))
  for (const b of blockers) console.error(b)
  process.exit(blockers.length ? 1 : 0)
}
