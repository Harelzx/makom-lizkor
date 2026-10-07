// node --test scripts/release-cache.test.mjs
import assert from "node:assert/strict"
import { test } from "node:test"
import { cacheBlockers } from "./release-cache.mjs"

// Workers Caching is staging's alone until a production decision (L-CACHE-STG, a95): production's effective
// configuration, raw and as the release builds it, never turns it on. Each configuration's EDGE_CACHE says what its
// Worker's cache is (C-CACHE): "on" exactly where `cache` turns it on, "off" everywhere else.
const off = { EDGE_CACHE: "off" }
const on = { EDGE_CACHE: "on" }
const staging = { cache: { enabled: false }, vars: off, env: { staging: { cache: { enabled: true }, vars: on } } }

test("the staging-only configuration passes, and so does one with no cache anywhere", () => {
  assert.deepEqual(cacheBlockers(staging), [])
  assert.deepEqual(cacheBlockers({ vars: off }), [])
  assert.deepEqual(cacheBlockers({ vars: off, env: { staging: { vars: off } } }), [])
  assert.deepEqual(cacheBlockers(staging, { cache: { enabled: false }, vars: off }), [])
  assert.deepEqual(cacheBlockers(staging, { vars: off }), [])
  assert.deepEqual(cacheBlockers(null, { vars: off }), [])
})

test("caching at the top level, in any other environment or in an entrypoint override is refused", () => {
  assert.match(cacheBlockers({ cache: { enabled: true }, vars: on })[0], /top level/)
  assert.match(
    cacheBlockers({ ...staging, env: { ...staging.env, production: { cache: { enabled: true }, vars: on } } })[0],
    /env\.production/,
  )
  assert.match(cacheBlockers({ vars: on, exports: { default: { type: "worker", cache: { enabled: true } } } })[0], /top level/)
  assert.match(
    cacheBlockers({ vars: off, env: { preview: { vars: on, exports: { Api: { type: "worker", cache: { enabled: true } } } } } })[0],
    /env\.preview/,
  )
})

test("the built configuration the release deploys is refused if it caches, whatever the raw file says", () => {
  assert.match(cacheBlockers(staging, { cache: { enabled: true }, vars: on })[0], /built/)
  assert.match(cacheBlockers(staging, { vars: on, exports: { default: { type: "worker", cache: { enabled: true } } } })[0], /built/)
})

test("a configuration whose EDGE_CACHE doesn't say what its cache is, or says nothing, is refused (C-CACHE)", () => {
  // Off in the Worker with a cache on: removals would leave copies no purge clears.
  assert.match(
    cacheBlockers({ ...staging, env: { staging: { cache: { enabled: true }, vars: off } } }).join("\n"),
    /env\.staging.*EDGE_CACHE/,
  )
  // On in the Worker with no cache: every purge fails and is reported as given up.
  assert.match(cacheBlockers({ vars: on }).join("\n"), /top level.*EDGE_CACHE/)
  // Unset, or a value the Worker doesn't know.
  assert.match(cacheBlockers({}).join("\n"), /top level.*EDGE_CACHE/)
  assert.match(cacheBlockers({ vars: { EDGE_CACHE: "Off" } }).join("\n"), /EDGE_CACHE/)
  assert.match(cacheBlockers({ vars: off, env: { staging: {} } }).join("\n"), /env\.staging.*EDGE_CACHE/)
  // The built configuration the release deploys, as the build wrote it.
  assert.match(cacheBlockers(null, {}).join("\n"), /built.*EDGE_CACHE/)
  assert.match(cacheBlockers(null, { vars: on }).join("\n"), /built.*EDGE_CACHE/)
})

test("the repository's own wrangler.jsonc passes", async () => {
  const { experimental_readRawConfig } = await import("wrangler")
  const { fileURLToPath } = await import("node:url")
  const raw = experimental_readRawConfig({ config: fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)) }).rawConfig
  assert.deepEqual(cacheBlockers(raw), [])
})
