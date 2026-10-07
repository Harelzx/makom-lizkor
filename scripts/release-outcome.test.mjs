// node --test scripts/release-outcome.test.mjs
import assert from "node:assert/strict"
import { test } from "node:test"
import { releaseOutcome } from "./release-outcome.mjs"

const at = (migrated, deployed, checked, published = "skipped") =>
  releaseOutcome({ release: "release-2026-11-02", migrated, deployed, checked, published })

test("stopped before the migrations: this attempt changed nothing, and what is live is read, not assumed", () => {
  const text = at("skipped", "skipped", "skipped")
  assert.match(text, /This attempt changed nothing in production/)
  assert.match(text, /deployments list/)
  assert.doesNotMatch(text, /previous release/)
})

test("the migrations failed: the schema may be partly migrated, and this attempt deployed no code", () => {
  const text = at("failure", "skipped", "skipped")
  assert.match(text, /migrations may be partly applied/)
  assert.match(text, /This attempt deployed no code/)
  assert.match(text, /deployments list/)
  assert.doesNotMatch(text, /previous release/)
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

test("migrated, then stopped before the deploy: this attempt deployed no code, on a schema it migrated", () => {
  const text = at("success", "skipped", "skipped")
  assert.match(text, /The deploy never ran/)
  assert.match(text, /This attempt deployed no code/)
  assert.match(text, /deployments list/)
  assert.doesNotMatch(text, /previous release|may or may not/)
})

// L-RELEASE-STATE-1 (a79): attempt A deploys release-2026-11-02 and its checks fail, so it stays live, unverified and a
// draft; attempt B of the same release then stops before deploying. B's summary can't know what A left, so it never
// names a previous or verified release as live: it says what B itself did, that an earlier attempt may have left the
// release live, and where to look.
test("a retry that stops before deploying never claims the previous release is what's live", () => {
  const first = at("success", "success", "failure")
  assert.match(first, /release-2026-11-02 is live in production and not verified/)
  for (const retry of [at("failure", "skipped", "skipped"), at("success", "skipped", "skipped"), at("skipped", "skipped", "skipped")]) {
    assert.doesNotMatch(retry, /previous release|is still|Nothing in production changed|verified release is live/)
    assert.match(retry, /An earlier attempt of release-2026-11-02 may have left it live and unverified/)
    assert.match(retry, /release-attempt-release-2026-11-02-/)
  }
})
