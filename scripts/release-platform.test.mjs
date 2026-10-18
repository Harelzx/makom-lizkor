// node --test scripts/release-platform.test.mjs
import assert from "node:assert/strict"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { platformBlockers } from "./release-platform.mjs"

const ready = (over = {}) => ({
  workers_dev: false,
  preview_urls: false,
  observability: { logs: { enabled: true, invocation_logs: false } },
  r2_buckets: [
    { binding: "MEDIA", jurisdiction: "eu" },
    { binding: "EXPORTS", jurisdiction: "eu" },
  ],
  ...over,
})

test("closed side doors, our own log lines only, no tracing and EU buckets pass", () => {
  assert.deepEqual(platformBlockers(ready()), [])
})
test("version preview URLs left open, or workers.dev left to the default, block (spec 11: no bypass of Access)", () => {
  assert.equal(platformBlockers(ready({ workers_dev: undefined })).length, 1)
  assert.equal(platformBlockers(ready({ preview_urls: undefined })).length, 1)
})
test("the workers.dev address on passes: the Worker's own Access covers it, checked live at each release", () => {
  assert.deepEqual(platformBlockers(ready({ workers_dev: true })), [])
})
test("the platform's own request logs or tracing block: they would hold what our log lines leave out", () => {
  assert.equal(platformBlockers(ready({ observability: { logs: { enabled: true } } })).length, 1)
  assert.equal(
    platformBlockers(ready({ observability: { logs: { enabled: true, invocation_logs: false }, traces: { enabled: true } } })).length,
    1,
  )
})
test("a bucket outside the EU blocks, named by its binding", () => {
  const blockers = platformBlockers(ready({ r2_buckets: [{ binding: "MEDIA", jurisdiction: "eu" }, { binding: "LEDGER" }] }))
  assert.equal(blockers.length, 1)
  assert.match(blockers[0], /LEDGER/)
})
test("the repository's own wrangler.jsonc passes", async () => {
  const { experimental_readRawConfig } = await import("wrangler")
  const raw = experimental_readRawConfig({ config: fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)) }).rawConfig
  assert.deepEqual(platformBlockers(raw), [])
})
