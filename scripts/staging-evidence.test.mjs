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
const receipt = (over = {}) => ({ sha: SHA, tag: `staging-${SHA.slice(0, 12)}`, run_id: 7, edge: "pass", ...over })
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
