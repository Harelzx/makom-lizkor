import assert from "node:assert/strict"
import { test } from "node:test"
import { deployedStates, rollbackStateProblems } from "./rollback-state.mjs"

// What may be on production when a rollback is asked for (a51, P6-ROLLBACK-1): the newest published release, and every
// release attempt since whose release job started, since it may have migrated or deployed before failing. Each is
// what the rollback must stay compatible with; when that can't be known, the rollback is refused.

const B = "b".repeat(40)
const C = "c".repeat(40)
const D = "d".repeat(40)
const published = { tag: "release-2026-11-02", sha: B, at: "2026-11-02T10:00:00Z" }
const run = (id, at, { status = "completed", conclusion = "failure", job = "failure", attempt = null } = {}) => ({
  id,
  created_at: at,
  status,
  conclusion,
  jobs:
    job === null
      ? [{ name: "verify", conclusion: "failure" }]
      : [
          { name: "verify", conclusion: "success" },
          { name: "release", status: "completed", conclusion: job, started_at: at },
        ],
  attempt,
})

test("with nothing attempted since, the newest published release is what production runs", () => {
  assert.deepEqual(
    deployedStates({ published, runs: [run(1, "2026-11-01T09:00:00Z", { conclusion: "success", job: "success", attempt: { sha: B } })] }),
    [B],
  )
})

test("a release that failed after its release job started (migrations or deploy) counts, as well as the published one", () => {
  const runs = [run(2, "2026-11-03T09:00:00Z", { attempt: { sha: C } })]
  assert.deepEqual(deployedStates({ published, runs }), [B, C])
})

test("a release that failed in verify, before touching production, doesn't count", () => {
  assert.deepEqual(deployedStates({ published, runs: [run(2, "2026-11-03T09:00:00Z", { job: null })] }), [B])
  assert.deepEqual(deployedStates({ published, runs: [run(2, "2026-11-03T09:00:00Z", { job: "skipped" })] }), [B])
})

test("several attempts since all count", () => {
  const runs = [run(3, "2026-11-04T09:00:00Z", { attempt: { sha: D } }), run(2, "2026-11-03T09:00:00Z", { attempt: { sha: C } })]
  assert.deepEqual(deployedStates({ published, runs }), [B, D, C])
})

test("refuses when the state can't be known: a release still running, or one that started with no record of its commit", () => {
  assert.throws(
    () => deployedStates({ published, runs: [run(2, "2026-11-03T09:00:00Z", { status: "in_progress", conclusion: null })] }),
    /still running/,
  )
  assert.throws(() => deployedStates({ published, runs: [run(2, "2026-11-03T09:00:00Z")] }), /no record of the commit it was releasing/)
  assert.throws(() => deployedStates({ published: null, runs: [] }), /nothing has been released/)
})

test("the rollback is checked against every state but the target itself (P6-ROLLBACK-1)", () => {
  const seen = []
  const check = (t, d) => (seen.push([t, d]), d === C ? ["migrations/0018.sql drops something"] : [])
  // Back to B after C failed mid-release: checked against C, and C's migration refuses it.
  assert.deepEqual(rollbackStateProblems(B, [B, C], check), [`against ${C.slice(0, 12)}: migrations/0018.sql drops something`])
  assert.deepEqual(seen, [[B, C]])
  // Back to an older A: checked against B and C alike.
  seen.length = 0
  rollbackStateProblems("a".repeat(40), [B, C], check)
  assert.deepEqual(
    seen.map(([, d]) => d),
    [B, C],
  )
  assert.deepEqual(rollbackStateProblems(B, [B], check), ["the target is what production already runs"])
})
