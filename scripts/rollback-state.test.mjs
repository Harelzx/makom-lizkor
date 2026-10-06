import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { after, test } from "node:test"
import { fixtureRepo } from "./release-fixture.mjs"
import { collect, deployedStates, readHistory, rollbackStateProblems } from "./rollback-state.mjs"

// What may be on production when a rollback is asked for (adviser a51, a52, a53; P6-ROLLBACK-1): every published
// release and every release attempt whose release job started, in the whole history, every rerun included, never cut
// off by time. None is set aside because a later one descends from it: a descendant may have taken an applied
// migration out, or undone a safeguard change, so its diff no longer shows what the database or the jobs went through.
// When the history can't be read whole, an attempt that started has no record of its own commit, or one is still
// running, the rollback is refused.

const repos = []
after(() => repos.forEach((r) => r.remove()))
const BASE = {
  "migrations/0001_init.sql": "CREATE TABLE places (id TEXT PRIMARY KEY);\n",
  "worker/db/retention.ts": "export const days = 30\n",
  "worker/routes/feed.ts": "export const feed = 1\n",
  "src/config.ts": "export const RETENTION = { returnedDays: 30 }\n",
  "wrangler.jsonc": '{ "triggers": { "crons": ["*/15 * * * *"] } }\n',
}
/** A main line in a throwaway repository, from A, the first release. */
const start = () => {
  const repo = fixtureRepo()
  repos.push(repo)
  return { repo, A: repo.commit("A", BASE) }
}
const short = (sha) => sha.slice(0, 12)

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
const [P, Q, R] = ["a", "b", "c"].map((c) => c.repeat(40))
const states = (o) => deployedStates({ complete: true, published: [Q], runs: [], ...o })

test("every published release and every attempt whose release job started is a state, older ones included", () => {
  const runs = [
    { id: 1, attempts: [attempt(1, { job: "success", sha: Q })] },
    { id: 2, attempts: [attempt(1, { sha: R })] },
  ]
  assert.deepEqual(states({ published: [P, Q], runs }), [P, Q, R])
})

test("every rerun of a run counts; an attempt that never reached its release job doesn't", () => {
  assert.deepEqual(states({ runs: [{ id: 5, attempts: [attempt(1, { job: null }), attempt(2, { sha: R })] }] }), [Q, R])
  assert.deepEqual(states({ runs: [{ id: 6, attempts: [attempt(1, { job: null }), attempt(2, { job: "skipped" })] }] }), [Q])
})

test("refuses when the history can't be known: not read whole, still running, or started with no record of its commit", () => {
  assert.throws(() => states({ complete: false }), /couldn't be read whole/)
  assert.throws(() => states({ runs: [{ id: 7, attempts: [attempt(1, { status: "in_progress", job: null })] }] }), /still running/)
  assert.throws(
    () => states({ runs: [{ id: 8, attempts: [attempt(1), attempt(2, { sha: R })] }] }),
    /run 8, attempt 1, started its release job with no record of its own commit/,
  )
  assert.throws(() => states({ published: [], runs: [] }), /nothing has been released/)
})

test("a failed C that dropped something stays a state after D took its migration out: going back to B is refused", () => {
  for (const after of [null, "CREATE TABLE notes (id TEXT PRIMARY KEY);\n"]) {
    const { repo, A } = start()
    const B = repo.commit("B", { "worker/routes/feed.ts": "export const feed = 2\n" })
    const C = repo.commit("C", { "migrations/0002_drop.sql": "DROP TABLE places;\n" })
    // D removes the migration C applied, or rewrites it as something harmless: D's own diff from B shows nothing.
    const D = repo.commit("D", { "migrations/0002_drop.sql": after })
    const s = deployedStates({
      complete: true,
      published: [A, B],
      runs: [
        { id: 3, attempts: [attempt(1, { sha: C })] },
        { id: 4, attempts: [attempt(1, { sha: D })] },
      ],
    })
    const problems = rollbackStateProblems({ cwd: repo.dir, target: B, states: s })
    assert.ok(
      problems.includes(`against ${short(C)}: migrations/0002_drop.sql drops something: the earlier code may fail on today's schema`),
      `${after ?? "removed"}: ${problems.join("; ")}`,
    )
  }
})

test("a safeguard change in C, undone in D, still refuses going back to B", () => {
  const { repo, A } = start()
  const B = repo.commit("B", { "worker/routes/feed.ts": "export const feed = 2\n" })
  const C = repo.commit("C", { "worker/db/retention.ts": "export const days = 14\n" })
  const D = repo.commit("D", { "worker/db/retention.ts": BASE["worker/db/retention.ts"] })
  const s = deployedStates({
    complete: true,
    published: [A, B],
    runs: [
      { id: 3, attempts: [attempt(1, { sha: C })] },
      { id: 4, attempts: [attempt(1, { sha: D })] },
    ],
  })
  assert.deepEqual(rollbackStateProblems({ cwd: repo.dir, target: B, states: s }), [
    `against ${short(C)}: worker/db/retention.ts changed since the target: rolling back could undo a deletion safeguard`,
  ])
})

test("an ordinary rollback is allowed: back to B from C, with A before them both", () => {
  const { repo, A } = start()
  const B = repo.commit("B", { "worker/routes/feed.ts": "export const feed = 2\n" })
  const C = repo.commit("C", { "migrations/0002_add.sql": "ALTER TABLE places ADD COLUMN note TEXT;\n" })
  assert.deepEqual(rollbackStateProblems({ cwd: repo.dir, target: B, states: [A, B, C] }), [])
  assert.deepEqual(rollbackStateProblems({ cwd: repo.dir, target: C, states: [A, B, C] }), [
    "nothing production may run is newer than the target",
  ])
})

test("a migration an earlier release applied, changed or removed in the target, refuses going back to it", () => {
  const { repo, A } = start()
  const B = repo.commit("B", { "migrations/0001_init.sql": "CREATE TABLE places (id TEXT PRIMARY KEY, x TEXT);\n" })
  const C = repo.commit("C", { "worker/routes/feed.ts": "export const feed = 3\n" })
  assert.deepEqual(rollbackStateProblems({ cwd: repo.dir, target: B, states: [A, B, C] }), [
    `against ${short(A)}: migrations/0001_init.sql: applied by that release, changed or removed in the target`,
  ])
})

test("a state off the target's line is refused, not passed", () => {
  const { repo, A } = start()
  const B = repo.commit("B", { "worker/routes/feed.ts": "export const feed = 2\n" })
  repo.branch("other", A)
  const X = repo.commit("X", { "worker/routes/feed.ts": "export const feed = 9\n" })
  assert.deepEqual(rollbackStateProblems({ cwd: repo.dir, target: B, states: [A, B, X] }), [
    `against ${short(X)}: the target is not an earlier commit of the deployed one`,
  ])
})

// The CLI's own reading of the history, against a stand-in for the GitHub CLI: what the API lists, and the records it
// downloads. The commits and tags are a real repository's.
function fakeGh({ releases = [], runs = [], runsTotal, artifacts = {}, jobs = {}, records = {} }) {
  const page = (key, items, total = items.length) => JSON.stringify([{ total_count: total, [key]: items }])
  return (args) => {
    if (args[0] === "release" && args[1] === "list") return JSON.stringify(releases.map((tagName) => ({ tagName })))
    if (args[0] === "api") {
      const path = args.at(-1)
      let m
      if (/actions\/workflows\/release\.yml\/runs/.test(path)) return page("workflow_runs", runs, runsTotal)
      if ((m = /actions\/runs\/(\d+)\/artifacts/.exec(path))) return page("artifacts", artifacts[m[1]] ?? [])
      if ((m = /actions\/runs\/(\d+)\/attempts\/(\d+)\/jobs/.exec(path))) return page("jobs", jobs[`${m[1]}/${m[2]}`] ?? [])
    }
    if (args[0] === "run" && args[1] === "download") {
      const name = args[args.indexOf("--name") + 1]
      writeFileSync(join(args[args.indexOf("--dir") + 1], "attempt.json"), JSON.stringify(records[name]))
      return ""
    }
    throw new Error(`unexpected gh ${args.join(" ")}`)
  }
}
const started = (conclusion) => [
  { name: "verify", conclusion: "success" },
  { name: "release", status: "completed", conclusion, started_at: "2026-11-03T09:00:00Z" },
]
const TAG = "release-2026-11-03"
const ART = (n, expired = false) => ({ name: `release-attempt-${TAG}-${n}`, expired })

test("an attempt whose record expired is never taken for the commit its release tag names later", () => {
  const { repo, A } = start()
  const B = repo.commit("B", { "worker/routes/feed.ts": "export const feed = 2\n" })
  const C = repo.commit("C", { "migrations/0002_drop.sql": "DROP TABLE places;\n" })
  // Attempt 1 released C and failed; the draft was then aimed at B, attempt 2 published it. C's record has expired.
  repo.tag(TAG, B)
  const run = { id: 10, display_title: `release ${TAG}`, run_attempt: 2, status: "completed" }
  const gh = (expired) =>
    fakeGh({
      releases: [TAG],
      runs: [run],
      artifacts: { 10: [ART(1, expired), ART(2)] },
      jobs: { "10/1": started("failure"), "10/2": started("success") },
      records: { [ART(1).name]: { release: TAG, sha: C }, [ART(2).name]: { release: TAG, sha: B } },
    })
  const expired = readHistory({ repo: "o/r", gh: gh(true), cwd: repo.dir })
  assert.equal(expired.runs[0].attempts[0].record, null)
  assert.throws(() => deployedStates(expired), /run 10, attempt 1, started its release job with no record of its own commit/)
  // With the record kept, C stays a state, and going back to B is refused over C's migration.
  const kept = deployedStates(readHistory({ repo: "o/r", gh: gh(false), cwd: repo.dir }))
  assert.deepEqual(kept, [B, C])
  assert.ok(rollbackStateProblems({ cwd: repo.dir, target: B, states: kept }).some((p) => p.startsWith(`against ${short(C)}:`)))
  void A
})

test("a draft's tag is no publication, and a record naming another release is no record", () => {
  const { repo } = start()
  const B = repo.commit("B", { "worker/routes/feed.ts": "export const feed = 2\n" })
  // The tag exists, but its release is a draft: the list of published releases doesn't have it.
  repo.tag(TAG, B)
  const run = { id: 11, display_title: `release ${TAG}`, run_attempt: 1, status: "completed" }
  const history = readHistory({
    repo: "o/r",
    gh: fakeGh({
      releases: [],
      runs: [run],
      artifacts: { 11: [ART(1)] },
      jobs: { "11/1": started("failure") },
      records: { [ART(1).name]: { release: "release-2026-11-04", sha: B } },
    }),
    cwd: repo.dir,
  })
  assert.deepEqual(history.published, [])
  assert.equal(history.runs[0].attempts[0].record, null)
  assert.throws(() => deployedStates(history), /run 11, attempt 1, started its release job with no record/)
})

test("the history read short of the API's own total is not whole", () => {
  const { repo, A } = start()
  repo.tag(TAG, A)
  const run = { id: 12, display_title: `release ${TAG}`, run_attempt: 1, status: "completed" }
  const history = readHistory({
    repo: "o/r",
    gh: fakeGh({
      releases: [TAG],
      runs: [run],
      runsTotal: 2,
      jobs: { "12/1": started("success") },
      artifacts: { 12: [ART(1)] },
      records: { [ART(1).name]: { release: TAG, sha: A } },
    }),
    cwd: repo.dir,
  })
  assert.equal(history.complete, false)
  assert.throws(() => deployedStates(history), /couldn't be read whole/)
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
