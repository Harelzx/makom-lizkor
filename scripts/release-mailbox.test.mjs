import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { mailboxBlockers } from "./release-mailbox.mjs"
import { MAILBOX, CONTACT_EMAIL } from "../src/config.ts"
const receipt = JSON.parse(readFileSync(new URL("../docs/mailbox-verification-20261011.json", import.meta.url), "utf8"))
const checked = { ...MAILBOX, verified: true }
test("real operational evidence passes without claiming physical deletion", () => {
  assert.deepEqual(mailboxBlockers(checked, receipt, CONTACT_EMAIL), [])
})
test("a verified flag alone cannot replace the actual trigger and per-message evidence", () => {
  assert.ok(mailboxBlockers(checked, {}, CONTACT_EMAIL).length)
  assert.ok(mailboxBlockers({ ...checked, verified: false }, receipt, CONTACT_EMAIL).length)
  for (const mutate of [
    (r) => {
      r.mailbox = "other@gmail.com"
    },
    (r) => {
      r.configuration.unit = "thread"
    },
    (r) => {
      r.configuration.triggerCount = 2
    },
    (r) => {
      r.actualExecution.manual = true
    },
    (r) => {
      r.actualExecution.status = "failed"
    },
    (r) => {
      r.fixture.recentKept = false
    },
    (r) => {
      r.fixture.oldTrashed = false
    },
    (r) => {
      r.fixture.permanentDeletion = true
    },
    (r) => {
      r.evidence = []
    },
  ]) {
    const wrong = structuredClone(receipt)
    mutate(wrong)
    assert.ok(mailboxBlockers(checked, wrong, CONTACT_EMAIL).length)
  }
})
test("changed periods or unsupported physical-erasure claims block release", () => {
  for (const wrong of [
    { ...checked, maxMonths: 24 },
    { ...checked, deletionTailDays: 7 },
    { ...checked, physicalDeletionVerified: true },
    { ...checked, trashTailBasis: "measured" },
  ])
    assert.ok(mailboxBlockers(wrong, receipt, CONTACT_EMAIL).length)
})
