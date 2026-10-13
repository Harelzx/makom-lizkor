import assert from "node:assert/strict"
import { test } from "node:test"
import { artifactFor, checkReceipt, checkTriggerReadiness, readiness, trustedCI } from "./ci-evidence.mjs"
import { selection, validateReport, verifyShards } from "./ci-browser.mjs"
const sha = "a".repeat(40),
  repository = "Harelzx/makom-lizkor"
const run = {
  id: 7,
  run_attempt: 1,
  path: ".github/workflows/ci.yml",
  event: "push",
  head_branch: "main",
  head_sha: sha,
  head_repository: { full_name: repository },
  status: "completed",
  conclusion: "success",
}
const full = { policy: 1, kind: "full", sha, run_id: 7, attempt: 1, mode: "full", full: true, deploy_allowed: true }
const check = (receipt = full, r = run, extra = {}) => checkReceipt({ kind: "full", sha, receipt, run: r, repository, ...extra })
test("release evidence is bound to run, attempt, repository, SHA and full mode", () => {
  assert.equal(check(), full)
  for (const delta of [
    { sha: "b".repeat(40) },
    { policy: 0 },
    { kind: "ready" },
    { full: false },
    { deploy_allowed: false },
    { mode: "docs" },
    { run_id: 8 },
    { attempt: 2 },
  ])
    assert.throws(() => check({ ...full, ...delta }))
  for (const delta of [
    { conclusion: "failure" },
    { status: "in_progress" },
    { event: "pull_request" },
    { head_branch: "feature" },
    { head_repository: { full_name: "stranger/repo" } },
    { path: ".github/workflows/other.yml" },
  ])
    assert.throws(() => check(full, { ...run, ...delta }))
  assert.equal(trustedCI({ ...run, head_sha: "b".repeat(40) }, sha, repository), false)
})
test("background evidence verifies its triggering CI, never workflow_run's default-branch SHA", () => {
  const background = { ...run, id: 9, path: ".github/workflows/regression.yml", event: "workflow_run", head_sha: "b".repeat(40) }
  const receipt = { ...full, run_id: 9, source_ci_run: 7, source_ci_attempt: 1, mode: "preview" }
  assert.equal(check(receipt, background, { sourceRun: run }), receipt)
  assert.throws(() => check(receipt, background))
  assert.throws(() => check(receipt, background, { sourceRun: { ...run, conclusion: "failure" } }))
})
test("a newer CI attempt invalidates old background evidence until its own regression passes", () => {
  const background = { ...run, id: 9, path: ".github/workflows/regression.yml", event: "workflow_run", head_sha: "b".repeat(40) }
  const receipt = { ...full, run_id: 9, source_ci_run: 7, source_ci_attempt: 1, mode: "preview" }
  assert.equal(check(receipt, background, { sourceRun: run }), receipt)
  const rerun = { ...run, run_attempt: 2 }
  assert.throws(() => check(receipt, background, { sourceRun: rerun }))
  assert.throws(() => check({ ...receipt, source_ci_attempt: undefined }, background, { sourceRun: run }))
  const replacement = { ...receipt, run_id: 10, source_ci_attempt: 2 }
  const newBackground = { ...background, id: 10 }
  for (const [status, conclusion] of [
    ["in_progress", null],
    ["completed", "failure"],
    ["completed", "cancelled"],
  ]) {
    assert.throws(() => check(receipt, background, { sourceRun: rerun }))
    assert.throws(() => check(replacement, { ...newBackground, status, conclusion }, { sourceRun: rerun }))
  }
  assert.equal(check(replacement, newBackground, { sourceRun: rerun }), replacement)
})
test("expired or wrong-run artifacts cannot supply evidence", () => {
  const artifact = { id: 1, name: `ci-full-${sha}`, expired: false, workflow_run: { id: 7 } }
  assert.equal(artifactFor([artifact], "full", sha, 7).id, 1)
  assert.throws(() => artifactFor([artifact], "full", sha, 8))
  assert.throws(() => artifactFor([{ ...artifact, expired: true }], "full", sha))
})
test("background admission and recording cannot relabel an old event with a rerun's readiness", () => {
  const ready = { ...full, kind: "ready", mode: "preview", full: false }
  assert.equal(checkTriggerReadiness(run, ready, sha, repository), ready)
  const nextReady = { ...ready, attempt: 2 },
    nextRun = { ...run, run_attempt: 2 }
  // This is the same guard called at admission and after regression, immediately before writing its full receipt.
  assert.throws(() => checkTriggerReadiness(run, nextReady, sha, repository))
  assert.throws(() => checkTriggerReadiness(nextRun, ready, sha, repository))
  assert.equal(checkTriggerReadiness(nextRun, nextReady, sha, repository), nextReady)
  assert.throws(() => checkTriggerReadiness({ ...run, run_attempt: undefined }, ready, sha, repository))
})
const jobs = (mode) =>
  Object.fromEntries(
    ["plan", "static", "worker", "client", "webkit", "core", "regression", "dev"].map((k) => [
      k,
      { result: k === "dev" || k === (mode === "full" ? "core" : "regression") ? "skipped" : "success" },
    ]),
  )
test("readiness fails closed for every missing, cancelled, skipped or failed required job", () => {
  for (const mode of ["preview", "full"]) {
    assert.equal(readiness({ mode }, jobs(mode)).full, mode === "full")
    for (const name of ["plan", "static", "worker", "client", "webkit", mode === "full" ? "regression" : "core"]) {
      for (const result of ["skipped", "failure", "cancelled", undefined])
        assert.throws(() => readiness({ mode }, { ...jobs(mode), [name]: { result } }))
    }
    assert.throws(() => readiness({ mode, dev: true }, jobs(mode)))
  }
  assert.deepEqual(readiness({ mode: "docs" }, { plan: { result: "success" }, core: { result: "skipped" } }), {
    full: false,
    deploy_allowed: false,
  })
})
const report = (status = "passed") => ({
  suites: [
    {
      specs: [
        {
          id: "case",
          title: "test",
          file: "case.spec.ts",
          tests: [{ projectName: "e2e", expectedStatus: "passed", status: "expected", results: [{ status, duration: 10 }] }],
        },
      ],
    },
  ],
})
test("the browser receipt requires actual first-attempt passes, exact coverage, and no runner errors", () => {
  assert.equal(validateReport(report(), report()).length, 1)
  for (const state of ["failed", "skipped", "timedOut", "interrupted"]) assert.throws(() => validateReport(report(), report(state)))
  assert.throws(() => validateReport(report(), { suites: [] }))
  assert.throws(() => validateReport({ suites: [] }, { suites: [] }))
  assert.throws(() => validateReport(report(), { ...report(), errors: [{ message: "setup failed" }] }))
  const retry = report()
  retry.suites[0].specs[0].tests[0].results.push({ status: "passed" })
  assert.throws(() => validateReport(report(), retry))
})
test("two shards must cover the entire suite exactly once, with separate seeds", () => {
  const seed = { id: "seed:setup", project: "seed" }
  const a = { scope: "full", shard: "1/2", tests: [seed, { id: "e2e:case", project: "e2e" }] }
  const b = { scope: "full", shard: "2/2", tests: [seed] }
  verifyShards(report(), [a, b])
  assert.throws(() => verifyShards(report(), [a]))
  assert.throws(() => verifyShards(report(), [a, a]))
  assert.throws(() => verifyShards(report(), [a, { ...b, tests: a.tests }]))
  assert.throws(() => verifyShards(report(), [{ ...a, tests: a.tests.slice(1) }, b]))
})
test("scope selection never uses an unknown group or silently picks nothing", () => {
  assert.throws(() => selection("unknown"))
  assert.throws(() => selection("core", ["typo"]))
  assert.ok(selection("core", ["form"])[1].includes("submission-recovery"))
  assert.deepEqual(selection("webkit"), ["--grep", "@phone"])
})

test("list output of the installed Playwright covers all core tags and partitions without loss", async () => {
  const { execFileSync } = await import("node:child_process")
  const { entries, CORE } = await import("./ci-browser.mjs")
  const list = (...args) =>
    JSON.parse(
      execFileSync(process.execPath, ["scripts/ci-browser.mjs", "list", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    )
  const core = entries(list("core")),
    whole = list("full")
  for (const id of CORE)
    assert.ok(
      core.some((t) => t.tags.includes(`core-${id}`)),
      id,
    )
  assert.ok(
    entries(whole).some((t) => t.title.startsWith("collapses and opens again")),
    "panel motion stays in the production suite",
  )
  const shards = ["1/2", "2/2"].map((shard) => ({ scope: "full", shard, tests: entries(list("full", shard)) }))
  verifyShards(whole, shards)
  const webkit = entries(list("webkit"))
  assert.ok(webkit.some((t) => t.project === "seed"))
  // Existing five phone checks plus CSP enforcement, real photo upload and responsive gallery rendering.
  assert.equal(webkit.filter((t) => t.project === "webkit-phone").length, 8)
})
