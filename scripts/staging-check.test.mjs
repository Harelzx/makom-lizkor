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

test("same-account staging cannot consume production's rate-limit counters", () => {
  const r = real()
  r.env.staging.ratelimits[0].namespace_id = r.ratelimits[0].namespace_id
  assert.ok(stagingBlockers(r).some((x) => x.includes("share production's counters")))
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

test("staging's export keys are public keys of its own, and optional (L-RET A2, a104)", async () => {
  const { generateKeyPairSync } = await import("node:crypto")
  const jwk = (part = "publicKey") => generateKeyPairSync("rsa", { modulusLength: 2048 })[part].export({ format: "jwk" })
  const r = real()
  r.env.staging.d1_databases[0].database_id = "6b8f0a1e-1111-4222-8333-944455556666"
  const vars = Object.fromEntries(DEPLOY_VARS.map((k) => [`STAGING_${k}`, "set"]))
  const deploy = (keys, raw = r) =>
    stagingBlockers(raw, { deploy: true, env: { ...vars, ...(keys === undefined ? {} : { STAGING_EXPORT_PUBLIC_KEYS: keys }) } })
  const owner = jwk()
  const drill = jwk()
  // Unset: no export is written and the nightly check says so; that is the truthful state, not a blocker.
  assert.deepEqual(deploy(undefined), [])
  assert.deepEqual(deploy(JSON.stringify([owner, drill])), [])
  assert.ok(deploy("not json").some((x) => x.includes("STAGING_EXPORT_PUBLIC_KEYS is not a JSON list of RSA public keys")))
  assert.ok(deploy(JSON.stringify(owner)).some((x) => x.includes("not a JSON list")))
  assert.ok(deploy(JSON.stringify([owner, jwk("privateKey")])).some((x) => x.includes("holds a private key")))
  assert.ok(
    deploy(JSON.stringify([{ kty: "EC", crv: "P-256", x: "a", y: "b" }])).some((x) => x.includes("not a JSON list of RSA public keys")),
  )
  assert.ok(deploy("[]").some((x) => x.includes("not a JSON list of RSA public keys")))
  // Never production's: a key production's exports are sealed to doesn't open staging's, and the reverse.
  const shared = real()
  shared.env.staging.d1_databases[0].database_id = "6b8f0a1e-1111-4222-8333-944455556666"
  shared.vars.EXPORT_PUBLIC_KEYS = JSON.stringify([owner])
  assert.ok(deploy(JSON.stringify([owner, drill]), shared).some((x) => x.includes("production's")))
})

test("staging drill is isolated; optional commissioning doesn't create production resources", () => {
  const r = real()
  // Recovery used to be commissioned in staging first. Retain that case independently of today's production plan.
  const stagingFirst = structuredClone(r)
  stagingFirst.d1_databases = stagingFirst.d1_databases.filter((d) => d.binding !== "DRILL_DB")
  assert.deepEqual(stagingBlockers(stagingFirst), [])
  const drill = r.env.staging.d1_databases.find((d) => d.binding === "DRILL_DB")
  assert.ok(drill)
  for (const change of [
    (d) => {
      d.database_id = r.env.staging.d1_databases[0].database_id
    },
    (d) => {
      d.database_id = r.d1_databases[0].database_id
    },
    (d) => {
      d.database_id = r.d1_databases.find((database) => database.binding === "DRILL_DB").database_id
    },
    (d) => {
      d.database_name = "production-recovery"
    },
    (d) => {
      d.database_id = ""
    },
  ]) {
    const altered = structuredClone(r)
    change(altered.env.staging.d1_databases.find((d) => d.binding === "DRILL_DB"))
    assert.ok(stagingBlockers(altered).some((x) => x.includes("distinct, real staging recovery")))
  }
  r.env.staging.d1_databases.push(structuredClone(drill))
  assert.ok(stagingBlockers(r).some((x) => x.includes("distinct, real staging recovery")))
})
