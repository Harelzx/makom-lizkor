import assert from "node:assert/strict"
import { test } from "node:test"
import { compareSettings } from "./settings-compare.mjs"

const base = {
  hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "x" }] }] },
  permissions: { allow: ["a"] },
  model: "m",
}

test("names the exact deny rules added and removed, and reports hooks and every other setting compared whole", () => {
  const head = { ...base, permissions: { allow: ["a"], deny: ["Bash(wrangler deploy:*)"] } }
  assert.deepEqual(compareSettings(base, head), {
    denyAdded: ["Bash(wrangler deploy:*)"],
    denyRemoved: [],
    hooksUnchanged: true,
    otherPermissionsUnchanged: true,
    otherSettings: { model: "unchanged" },
  })
})

test("sees a hook, an allow rule or another setting changed, however deep", () => {
  const head = structuredClone(base)
  head.hooks.PreToolUse[0].hooks[0].command = "y"
  head.permissions.allow.push("b")
  head.model = "n"
  const r = compareSettings(base, head)
  assert.equal(r.hooksUnchanged, false)
  assert.equal(r.otherPermissionsUnchanged, false)
  assert.deepEqual(r.otherSettings, { model: "changed" })
})
