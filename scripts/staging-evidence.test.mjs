import assert from "node:assert/strict"
import { test } from "node:test"
import { receiptRun, stagingEvidenceProblems } from "./staging-evidence.mjs"

// What the release accepts as staging having passed on its commit (a51, P6-STAGING-1): the receipt staging.yml
// uploads as its deploy job's last step, from a completed, successful run of staging.yml, naming exactly this commit
// and a complete edge check. A run's own head_sha is never read: for a workflow_run trigger it is the default
// branch's tip when the run started, not the commit deployed.

const SHA = "a".repeat(40)
const OTHER = "b".repeat(40)
const artifact = (over = {}) => ({
  name: `staging-receipt-${SHA}`,
  expired: false,
  created_at: "2026-10-07T10:00:00Z",
  workflow_run: { id: 7, head_sha: OTHER },
  ...over,
})
const run = (over = {}) => ({
  id: 7,
  path: ".github/workflows/staging.yml",
  status: "completed",
  conclusion: "success",
  head_sha: OTHER,
  ...over,
})
const CHECKS = [
  "responses",
  "headers",
  "private_no_store",
  "private_isolation",
  "place_page",
  "no_shared_hit",
  "purge_freshness",
  "workers_dev_closed",
  "deployed_version",
]
const receipt = (over = {}) => ({
  sha: SHA,
  tag: `staging-${SHA.slice(0, 12)}`,
  run_id: 7,
  edge: "pass",
  expect_tag: `staging-${SHA.slice(0, 12)}`,
  checks: Object.fromEntries(CHECKS.map((c) => [c, "pass"])),
  ...over,
})
const check = (o = {}) =>
  stagingEvidenceProblems({ sha: SHA, artifacts: { artifacts: [artifact()] }, run: run(), receipt: receipt(), ...o })

test("accepts a completed, successful staging run's receipt for exactly this commit, whatever the run's own head_sha", () => {
  assert.deepEqual(check(), [])
  assert.equal(receiptRun({ artifacts: [artifact()] }, SHA), 7)
})

test("refuses missing, expired or foreign evidence", () => {
  assert.throws(() => receiptRun({ artifacts: [] }, SHA), /no staging receipt for/)
  assert.throws(() => receiptRun({ artifacts: [artifact({ expired: true })] }, SHA), /no staging receipt for/)
  assert.throws(() => receiptRun({ artifacts: [artifact({ name: `staging-receipt-${OTHER}` })] }, SHA), /no staging receipt for/)
  assert.deepEqual(check({ run: run({ path: ".github/workflows/ci.yml" }) }), ["the receipt's run is not staging.yml's"])
})

test("refuses a run skipped, failed or still going", () => {
  for (const [status, conclusion] of [
    ["completed", "skipped"],
    ["completed", "failure"],
    ["completed", "cancelled"],
    ["in_progress", null],
  ])
    assert.deepEqual(check({ run: run({ status, conclusion }) }), [`the staging run is ${status}/${conclusion}, not completed/success`])
})

test("refuses a receipt for another commit or run, and one whose edge check was incomplete", () => {
  assert.deepEqual(check({ receipt: receipt({ sha: OTHER }) }), [`the receipt names ${OTHER}, not ${SHA}`])
  assert.deepEqual(check({ receipt: receipt({ run_id: 8 }) }), ["the receipt was written by run 8, not run 7"])
  assert.deepEqual(check({ receipt: receipt({ edge: "incomplete" }) }), ["staging's edge check was incomplete, not passed"])
})

// The receipt says which deployed version its checks were held to, and each check's own result (staging harness): a
// release accepts only one whose checks all passed against this very commit's version.
test("refuses a receipt whose checks weren't held to this commit's version", () => {
  assert.deepEqual(check({ receipt: receipt({ expect_tag: undefined }) }), [
    `the receipt's checks weren't held to staging-${SHA.slice(0, 12)} (undefined)`,
  ])
  assert.deepEqual(check({ receipt: receipt({ expect_tag: `staging-${OTHER.slice(0, 12)}` }) }), [
    `the receipt's checks weren't held to staging-${SHA.slice(0, 12)} (staging-${OTHER.slice(0, 12)})`,
  ])
})

test("refuses a receipt missing a check, or with one not passed, whatever its overall word", () => {
  const { purge_freshness: _, ...rest } = receipt().checks
  assert.deepEqual(check({ receipt: receipt({ checks: rest }) }), ["staging's purge_freshness was missing, not passed"])
  assert.deepEqual(check({ receipt: receipt({ checks: { ...receipt().checks, deployed_version: "fail" } }) }), [
    "staging's deployed_version was fail, not passed",
  ])
  assert.deepEqual(
    check({ receipt: receipt({ checks: undefined }) }),
    CHECKS.map((c) => `staging's ${c} was missing, not passed`),
  )
})
