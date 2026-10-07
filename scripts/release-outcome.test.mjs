// node --test scripts/release-outcome.test.mjs
import assert from "node:assert/strict"
import { test } from "node:test"
import { releaseOutcome } from "./release-outcome.mjs"

const at = (migrated, deployed, checked, published = "skipped") =>
  releaseOutcome({ release: "release-2026-11-02", migrated, deployed, checked, published })

test("stopped before the migrations: nothing in production changed", () => {
  const text = at("skipped", "skipped", "skipped")
  assert.match(text, /Nothing in production changed/)
  assert.doesNotMatch(text, /live/i)
})

test("the migrations failed: the schema may be partly migrated, the code is the previous release's", () => {
  const text = at("failure", "skipped", "skipped")
  assert.match(text, /migrations may be partly applied/)
  assert.match(text, /previous release/)
})

test("migrated, then the deploy failed: the code may or may not have changed, and that is said, not assumed", () => {
  const text = at("success", "failure", "skipped")
  assert.match(text, /migrations were applied/)
  assert.match(text, /deployments list/)
})

test("deployed, then the checks failed: the new version is live and not verified, and the next step is named", () => {
  const text = at("success", "success", "failure")
  assert.match(text, /release-2026-11-02 is live in production and not verified/)
  assert.match(text, /draft/)
  assert.match(text, /rollback\.yml/)
  assert.match(text, /fix forward/)
})

test("checked, then publishing failed: live and verified, only the release's publication is left", () => {
  const text = at("success", "success", "success", "failure")
  assert.match(text, /live and verified/)
  assert.doesNotMatch(text, /not verified/)
})

test("an outcome it doesn't know is never read as a good one", () => {
  const text = at("success", "cancelled", "skipped")
  assert.match(text, /deployments list/)
  assert.doesNotMatch(text, /Nothing in production changed/)
})
