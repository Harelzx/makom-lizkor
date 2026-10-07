// Staging (spec 14.1) as wrangler reads env.staging: synthetic data only, apart from production in everything that
// holds data, and never development. Run by .github/workflows/staging.yml before it builds; with --deploy also by the
// deploy itself, which needs the real database id and the account's values in its environment. Production's own gate
// (release-platform.mjs) is unchanged by any of this.
//   node scripts/staging-check.mjs [--deploy]
import { fileURLToPath, pathToFileURL } from "node:url"

/** The vars staging.yml fills from the repository's variables at deploy time (none of them secret). */
export const DEPLOY_VARS = ["ACCESS_TEAM_DOMAIN", "ACCESS_AUD", "PUBLIC_ORIGIN", "TURNSTILE_HOSTNAMES", "MODERATORS"]
const PLACEHOLDER_ID = /^0{8}-0{4}-0{4}-0{4}-0{12}$/
const PRIVATE_MEMBERS = ["d", "p", "q", "dp", "dq", "qi", "oth"]

/**
 * Staging's export keys (L-RET A2, a104), from the repository variable STAGING_EXPORT_PUBLIC_KEYS. Optional: unset, no
 * export is written and the nightly check says so, which is the truthful state. Set, it is a JSON list of RSA public
 * keys (the offline recipient's and the drill's), none holding a private member, and none of production's, so a key
 * that opens one environment's exports never opens the other's.
 */
export function exportKeyBlockers(value, production = "") {
  if (value === undefined || value === "") return []
  let keys = null
  try {
    keys = JSON.parse(value)
  } catch {}
  const object = (k) => !!k && typeof k === "object"
  if (Array.isArray(keys) && keys.some((k) => object(k) && PRIVATE_MEMBERS.some((m) => m in k)))
    return ["STAGING_EXPORT_PUBLIC_KEYS holds a private key: only public keys belong in a repository variable"]
  if (
    !Array.isArray(keys) ||
    !keys.length ||
    !keys.every((k) => object(k) && k.kty === "RSA" && typeof k.n === "string" && typeof k.e === "string")
  )
    return ["STAGING_EXPORT_PUBLIC_KEYS is not a JSON list of RSA public keys"]
  let prod = []
  try {
    prod = JSON.parse(production || "[]")
  } catch {}
  const prodKeys = new Set((Array.isArray(prod) ? prod : []).filter(object).map((k) => k.n))
  if (keys.some((k) => prodKeys.has(k.n)))
    return ["STAGING_EXPORT_PUBLIC_KEYS shares a key with production's: staging's export keys are its own"]
  return []
}

export function stagingBlockers(raw, { deploy = false, env = {} } = {}) {
  const s = raw.env?.staging
  if (!s) return ["env.staging is missing"]
  const blockers = []
  const names = (list, key) => (list ?? []).map((x) => x[key])
  if (!s.name || s.name === raw.name || !s.name.endsWith("-staging"))
    blockers.push("staging needs a Worker name of its own, ending in -staging")
  // Development is what turns on /__dev and X-Test-Now; it is set only by the untracked .dev.vars.
  if (s.vars?.ENVIRONMENT !== "staging") blockers.push('staging vars must set ENVIRONMENT to "staging", never "development"')
  for (const key of Object.keys(s.vars ?? {}))
    if (/SECRET|TOKEN_VALUE|PRIVATE/i.test(key))
      blockers.push(`var ${key} looks like a secret: secrets go in with --secrets-file, never in vars`)
  if (s.preview_urls !== false) blockers.push("staging preview_urls must be false: Access protects the workers.dev address only")
  if (s.observability?.logs?.invocation_logs === true) blockers.push("staging keeps the platform's request logs off too")
  // Nothing that holds data is shared with production.
  const prodDb = names(raw.d1_databases, "database_name")
  for (const d of s.d1_databases ?? [])
    if (prodDb.includes(d.database_name)) blockers.push(`D1 ${d.binding} must not be production's database (${d.database_name})`)
  const prodBuckets = names(raw.r2_buckets, "bucket_name")
  for (const b of s.r2_buckets ?? []) {
    if (prodBuckets.includes(b.bucket_name)) blockers.push(`bucket ${b.binding} must not be production's (${b.bucket_name})`)
    if (b.jurisdiction !== "eu") blockers.push(`staging bucket ${b.binding} must be in the EU (jurisdiction "eu")`)
  }
  // The same bindings as production, so staging runs the same code paths.
  const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
  if (!same(names(s.d1_databases, "binding"), names(raw.d1_databases, "binding"))) blockers.push("staging needs production's D1 bindings")
  if (!same(names(s.r2_buckets, "binding"), names(raw.r2_buckets, "binding"))) blockers.push("staging needs production's R2 bindings")
  if (!same(names(s.ratelimits, "name"), names(raw.ratelimits, "name"))) blockers.push("staging needs production's rate limits")
  if (!same(Object.keys(s.vars ?? {}), Object.keys(raw.vars ?? {}))) blockers.push("staging needs production's vars, by name")
  if (deploy) {
    for (const d of s.d1_databases ?? [])
      if (PLACEHOLDER_ID.test(d.database_id ?? "")) blockers.push(`D1 ${d.binding}: set the staging database's id in wrangler.jsonc`)
    for (const key of DEPLOY_VARS) if (!env[`STAGING_${key}`]) blockers.push(`STAGING_${key} is not set (a repository variable)`)
    blockers.push(...exportKeyBlockers(env.STAGING_EXPORT_PUBLIC_KEYS, raw.vars?.EXPORT_PUBLIC_KEYS))
  }
  return blockers
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { experimental_readRawConfig } = await import("wrangler")
  const raw = experimental_readRawConfig({ config: fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)) }).rawConfig
  const blockers = stagingBlockers(raw, { deploy: process.argv.includes("--deploy"), env: process.env })
  if (blockers.length) {
    console.error("Staging config:\n" + blockers.map((b) => `  - ${b}`).join("\n"))
    process.exit(1)
  }
  console.log("Staging config holds.")
}
