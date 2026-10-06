// node --test scripts/staging-check.test.mjs
import assert from "node:assert/strict"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { experimental_readRawConfig } from "wrangler"
import { platformBlockers } from "./release-platform.mjs"
import { DEPLOY_VARS, stagingBlockers } from "./staging-check.mjs"

const real = () =>
  structuredClone(experimental_readRawConfig({ config: fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)) }).rawConfig)

test("the committed staging config holds, and production's gate is unchanged by it", () => {
  assert.deepEqual(stagingBlockers(real()), [])
  assert.deepEqual(platformBlockers(real()), [])
})

test("staging is never development, and keeps no secret in its vars", () => {
  const r = real()
  r.env.staging.vars.ENVIRONMENT = "development"
  r.env.staging.vars.DEV_ACCESS_SECRET = "x"
  const b = stagingBlockers(r)
  assert.ok(b.some((x) => x.includes('ENVIRONMENT to "staging"')))
  assert.ok(b.some((x) => x.includes("DEV_ACCESS_SECRET looks like a secret")))
})

test("nothing that holds data is production's, and every bucket is in the EU", () => {
  const r = real()
  r.env.staging.d1_databases[0].database_name = r.d1_databases[0].database_name
  r.env.staging.r2_buckets[1].bucket_name = r.r2_buckets[1].bucket_name
  r.env.staging.r2_buckets[2].jurisdiction = undefined
  const b = stagingBlockers(r)
  assert.ok(b.some((x) => x.startsWith("D1 DB must not be production's")))
  assert.ok(b.some((x) => x.startsWith("bucket LEDGER must not be production's")))
  assert.ok(b.some((x) => x.startsWith("staging bucket EXPORTS must be in the EU")))
})

test("staging runs production's bindings, its own name, and no preview URLs", () => {
  const r = real()
  r.env.staging.name = r.name
  r.env.staging.preview_urls = true
  r.env.staging.ratelimits.pop()
  delete r.env.staging.vars.QUEUE_LIMIT
  const b = stagingBlockers(r)
  for (const part of ["name of its own", "preview_urls must be false", "production's rate limits", "production's vars"])
    assert.ok(
      b.some((x) => x.includes(part)),
      part,
    )
  assert.deepEqual(stagingBlockers({ name: "x" }), ["env.staging is missing"])
})

test("a deploy needs the real database id and every account value", () => {
  // The committed config has the staging database's id since it was created (2026-10-07); the placeholder is refused.
  const placeholder = real()
  placeholder.env.staging.d1_databases[0].database_id = "00000000-0000-0000-0000-000000000000"
  const missing = stagingBlockers(placeholder, { deploy: true, env: {} })
  assert.ok(missing.some((x) => x.includes("set the staging database's id")))
  assert.ok(!stagingBlockers(real(), { deploy: true, env: {} }).some((x) => x.includes("set the staging database's id")))
  assert.equal(missing.filter((x) => x.includes("is not set")).length, DEPLOY_VARS.length)
  const r = real()
  r.env.staging.d1_databases[0].database_id = "6b8f0a1e-1111-4222-8333-944455556666"
  const env = Object.fromEntries(DEPLOY_VARS.map((k) => [`STAGING_${k}`, "set"]))
  assert.deepEqual(stagingBlockers(r, { deploy: true, env }), [])
})
