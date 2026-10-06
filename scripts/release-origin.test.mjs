// node --test scripts/release-origin.test.mjs
import assert from "node:assert/strict"
import { test } from "node:test"
import { originBlockers } from "./release-origin.mjs"

const vars = (PUBLIC_ORIGIN) => ({ vars: { PUBLIC_ORIGIN } })

test("the site's own https origin passes", () => {
  assert.deepEqual(originBlockers(vars("https://makom-lizkor.org.il")), [])
})
test("an empty or missing origin blocks: share pages would carry no address", () => {
  assert.equal(originBlockers(vars("")).length, 1)
  assert.equal(originBlockers({}).length, 1)
})
test("a reserved example domain or a workers.dev preview address blocks", () => {
  for (const bad of ["https://example.com", "https://www.example.org", "https://example.net", "https://makom.harel.workers.dev"])
    assert.equal(originBlockers(vars(bad)).length, 1, bad)
})
test("plain http, a path, a trailing slash or a placeholder domain blocks", () => {
  for (const bad of [
    "http://makom-lizkor.org.il",
    "https://makom-lizkor.org.il/",
    "https://makom-lizkor.org.il/he",
    "https://makom.example",
    "https://localhost:5174",
  ])
    assert.equal(originBlockers(vars(bad)).length, 1, bad)
})
