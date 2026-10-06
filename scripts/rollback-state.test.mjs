import assert from "node:assert/strict"
import { test } from "node:test"
import { collect, deployedStates, rollbackStateProblems } from "./rollback-state.mjs"

// What may be on production when a rollback is asked for (adviser a51, a52; P6-ROLLBACK-1): every published release
// and every release attempt whose release job started, in the whole history, every rerun included, never cut off by
// time. One covers another only when it descends from it (its code carries the other's migrations and changes); the
// rollback is checked against what nothing covers. When the history can't be read whole, or an attempt that started
// has no record of its commit, or one is still running, the rollback is refused.

// A linear history on main: A, then B, C, D.
const [A, B, C, D] = ["a", "b", "c", "d"].map((c) => c.repeat(40))
const ORDER = [A, B, C, D]
const isAncestor = (x, y) => ORDER.indexOf(x) <= ORDER.indexOf(y)
const attempt = (n, { status = "completed", job = "failure", sha = null } = {}) => ({
  n,
  status,
  jobs:
    job === null
      ? [{ name: "verify", conclusion: "failure" }]
      : [
          { name: "verify", conclusion: "success" },
          { name: "release", status: "completed", conclusion: job, started_at: "2026-11-03T09:00:00Z" },
        ],
  record: sha ? { sha } : null,
})
const states = (o) => deployedStates({ complete: true, isAncestor, published: [B], runs: [], ...o })

test("with nothing attempted beyond it, the newest published release is what production may run", () => {
  assert.deepEqual(states({ published: [A, B], runs: [{ id: 1, attempts: [attempt(1, { job: "success", sha: B })] }] }), [B])
})

test("a release attempt that started its release job counts however its run was queued, unless a publication covers it", () => {
  // Queued before B was published, run after it, failed after migrating: C isn't B's ancestor, so it counts.
  assert.deepEqual(states({ runs: [{ id: 2, attempts: [attempt(1, { sha: C })] }] }), [C])
  // An attempt of older code, since covered by B's publication: B carries its migrations and changes.
  assert.deepEqual(states({ runs: [{ id: 2, attempts: [attempt(1, { sha: A })] }] }), [B])
})

test("a failed C, then a publication of older code, leaves C's effects to stay compatible with", () => {
  assert.deepEqual(
    states({
      published: [A, B],
      runs: [
        { id: 3, attempts: [attempt(1, { sha: C })] },
        { id: 4, attempts: [attempt(1, { job: "success", sha: B })] },
      ],
    }),
    [C],
  )
})

test("every rerun of a run counts, an older run retried afterwards included", () => {
  const runs = [{ id: 5, attempts: [attempt(1, { job: null }), attempt(2, { sha: D })] }]
  assert.deepEqual(states({ runs }), [D])
})

test("an attempt that never reached its release job doesn't count", () => {
  assert.deepEqual(states({ runs: [{ id: 6, attempts: [attempt(1, { job: null }), attempt(2, { job: "skipped" })] }] }), [B])
})

test("refuses when the history can't be known: not read whole, still running, or started with no record of its commit", () => {
  assert.throws(() => states({ complete: false }), /couldn't be read whole/)
  assert.throws(() => states({ runs: [{ id: 7, attempts: [attempt(1, { status: "in_progress", job: null })] }] }), /still running/)
  assert.throws(
    () => states({ runs: [{ id: 8, attempts: [attempt(1), attempt(2, { sha: C })] }] }),
    /run 8, attempt 1, started its release job with no record/,
  )
  assert.throws(() => states({ published: [], runs: [] }), /nothing has been released/)
})

test("the rollback is checked against every state but the target itself", () => {
  const seen = []
  const check = (t, d) => (seen.push([t, d]), d === C ? ["migrations/0018.sql drops something"] : [])
  // Back to B after C failed mid-release: checked against C, and C's migration refuses it.
  assert.deepEqual(rollbackStateProblems(B, [C], check), [`against ${C.slice(0, 12)}: migrations/0018.sql drops something`])
  // A compatible rollback: back to A from B.
  assert.deepEqual(rollbackStateProblems(A, [B], check), [])
  assert.deepEqual(seen, [
    [B, C],
    [A, B],
  ])
  assert.deepEqual(rollbackStateProblems(B, [B], check), ["the target is what production already runs"])
})

test("a listing counts as whole only when its pages add up to the total the API reports, past the first page too", () => {
  const page = (n, total) => ({ total_count: total, workflow_runs: Array.from({ length: n }, (_, i) => ({ id: i })) })
  assert.deepEqual(collect([page(100, 230), page(100, 230), page(30, 230)], "workflow_runs").complete, true)
  assert.equal(collect([page(100, 230), page(100, 230), page(30, 230)], "workflow_runs").items.length, 230)
  // A page missing, or a run added while the pages were read: not whole.
  assert.equal(collect([page(100, 230), page(30, 230)], "workflow_runs").complete, false)
  assert.equal(collect([page(100, 231), page(100, 231), page(30, 231)], "workflow_runs").complete, false)
  assert.equal(collect([], "workflow_runs").complete, false)
})
