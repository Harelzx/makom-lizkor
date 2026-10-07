// node --test scripts/release-cache.test.mjs
import assert from "node:assert/strict"
import { test } from "node:test"
import { cacheBlockers } from "./release-cache.mjs"

// Workers Caching is staging's alone until a production decision (L-CACHE-STG, a95): production's effective
// configuration, raw and as the release builds it, never turns it on.
const staging = { cache: { enabled: false }, env: { staging: { cache: { enabled: true } } } }

test("the staging-only configuration passes, and so does none at all", () => {
  assert.deepEqual(cacheBlockers(staging), [])
  assert.deepEqual(cacheBlockers({}), [])
  assert.deepEqual(cacheBlockers(staging, { cache: { enabled: false } }), [])
  assert.deepEqual(cacheBlockers(staging, {}), [])
})

test("caching at the top level, in any other environment or in an entrypoint override is refused", () => {
  assert.match(cacheBlockers({ cache: { enabled: true } })[0], /top level/)
  assert.match(cacheBlockers({ ...staging, env: { ...staging.env, production: { cache: { enabled: true } } } })[0], /env\.production/)
  assert.match(cacheBlockers({ exports: { default: { type: "worker", cache: { enabled: true } } } })[0], /top level/)
  assert.match(cacheBlockers({ env: { preview: { exports: { Api: { type: "worker", cache: { enabled: true } } } } } })[0], /env\.preview/)
})

test("the built configuration the release deploys is refused if it caches, whatever the raw file says", () => {
  assert.match(cacheBlockers(staging, { cache: { enabled: true } })[0], /built/)
  assert.match(cacheBlockers(staging, { exports: { default: { type: "worker", cache: { enabled: true } } } })[0], /built/)
})
