// node --test scripts/staging-receipt.test.mjs
import assert from "node:assert/strict"
import { test } from "node:test"
import { receiptFor } from "./staging-receipt.mjs"
import { REQUIRED_CHECKS, stagingEvidenceProblems } from "./staging-evidence.mjs"

// The receipt staging.yml uploads, built from the edge check's own report: the commit, the tag its deploy gave the
// version, the run, the overall word, the tag the checks were held to, and each check's result.
const SHA = "a".repeat(40)
const report = (over = {}) => ({
  mode: "deployment",
  outcome: "pass",
  expect_tag: `staging-${SHA.slice(0, 12)}`,
  results: REQUIRED_CHECKS.map((check) => ({ check, status: "pass", detail: "" })),
  ...over,
})

test("carries each check's result and the tag the checks were held to, which the release's check accepts", () => {
  const receipt = receiptFor(report(), { SHA, GITHUB_RUN_ID: "7" })
  assert.deepEqual(receipt, {
    sha: SHA,
    tag: `staging-${SHA.slice(0, 12)}`,
    run_id: 7,
    edge: "pass",
    expect_tag: `staging-${SHA.slice(0, 12)}`,
    checks: Object.fromEntries(REQUIRED_CHECKS.map((c) => [c, "pass"])),
  })
  const artifacts = { artifacts: [{ name: `staging-receipt-${SHA}`, expired: false, created_at: "x", workflow_run: { id: 7 } }] }
  const run = { id: 7, path: ".github/workflows/staging.yml", status: "completed", conclusion: "success" }
  assert.deepEqual(stagingEvidenceProblems({ sha: SHA, artifacts, run, receipt }), [])
})

test("an incomplete run's receipt says which checks were incomplete, and the release refuses it", () => {
  const results = report().results.map((r) => (r.check === "purge_freshness" ? { ...r, status: "incomplete" } : r))
  const receipt = receiptFor(report({ outcome: "incomplete", results }), { SHA, GITHUB_RUN_ID: "7" })
  assert.equal(receipt.edge, "incomplete")
  assert.equal(receipt.checks.purge_freshness, "incomplete")
})

test("a report from a local run, or one without a tag, is not a deployment's receipt", () => {
  assert.throws(() => receiptFor(report({ mode: "local" }), { SHA, GITHUB_RUN_ID: "7" }), /deployment/)
  assert.throws(() => receiptFor(report({ expect_tag: null }), { SHA, GITHUB_RUN_ID: "7" }), /expect-tag/)
})
