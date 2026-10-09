import assert from "node:assert/strict"
import { test } from "node:test"
import { classify } from "./ci-plan.mjs"
const plan = (...paths) =>
  classify(
    paths.map((path) => ({ status: "M", path })),
    { baseline: "base", sha: "target" },
  )
test("only known documentation skips runtime checks", () => {
  assert.equal(plan("docs/agent-handoff.md").mode, "docs")
  assert.equal(plan("src/data/legal.ts").mode, "full")
  assert.equal(plan("docs/decision.json").mode, "full")
  assert.equal(classify([{ status: "M", path: "README.md" }]).mode, "full")
})
test("presentation changes select the affected groups, cumulatively", () => {
  assert.deepEqual(plan("src/components/form-flower.tsx").groups, ["form"])
  assert.equal(plan("src/index.css").mode, "preview")
  assert.equal(plan("worker/index.ts", "src/index.css").mode, "full")
  for (const path of [
    "src/store.ts",
    "src/components/add-place.tsx",
    ".github/workflows/ci.yml",
    "package-lock.json",
    "e2e/fixtures.ts",
    "unknown.css",
  ])
    assert.equal(plan(path).mode, "full", path)
})
test("new, deleted and renamed paths fail closed even in a known folder", () => {
  for (const status of ["A", "D", "R100", "T"])
    assert.equal(classify([{ status, path: "docs/agent-handoff.md" }], { baseline: "base" }).mode, "full")
})
