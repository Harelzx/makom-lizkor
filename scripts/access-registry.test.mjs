// node --test scripts/access-registry.test.mjs
import assert from "node:assert/strict"
import { test } from "node:test"
import { readRegistry, registryBlockers, registryProblems } from "./access-registry.mjs"

const base = () => ({
  people: [
    { id: "owner", name: "דנה" },
    { id: "approver-1", name: "יואב" },
  ],
  permissions: {
    cloudflare_account: ["owner"],
    access_identity: ["owner", "approver-1"],
    mailbox: ["owner"],
    release_approver: ["owner"],
    backup_private_key: ["owner"],
    ops_service_token: ["owner"],
  },
})

test("the committed registry is well formed", () => {
  assert.deepEqual(registryProblems(readRegistry()), [])
})
test("a fourth person fails", () => {
  const r = base()
  r.people.push({ id: "a2", name: "x" }, { id: "a3", name: "y" })
  r.permissions.access_identity.push("a2", "a3")
  assert.ok(registryProblems(r).some((p) => p.includes("at most two more")))
})
test("a permission no one holds, or held by someone not listed, fails", () => {
  const r = base()
  r.permissions.mailbox = []
  r.permissions.access_identity.push("stranger")
  const problems = registryProblems(r)
  assert.ok(problems.some((p) => p.includes("no one holds 'mailbox'")))
  assert.ok(problems.some((p) => p.includes("'stranger'")))
})
test("the operator must come first and hold the account, the releases and the backup key", () => {
  const r = base()
  r.permissions.backup_private_key = ["approver-1"]
  assert.ok(registryProblems(r).some((p) => p.includes("must hold 'backup_private_key'")))
  const s = base()
  s.people.reverse()
  assert.ok(registryProblems(s).some((p) => p.includes("first person")))
})
test("an unknown permission, a duplicate, or a person holding nothing fails", () => {
  const r = base()
  r.permissions.root = ["owner"]
  r.people.push({ id: "owner", name: "again" })
  const problems = registryProblems(r)
  assert.ok(problems.some((p) => p.includes("unknown permission")))
  assert.ok(problems.some((p) => p.includes("twice")))
  const s = base()
  s.permissions.access_identity = ["owner"]
  assert.ok(registryProblems(s).some((p) => p.includes("holds nothing")))
})
test("release needs real names and no more moderators than Access sign-ins", () => {
  assert.deepEqual(registryBlockers(base(), ["a@x.org.il", "b@x.org.il"]), [])
  assert.equal(registryBlockers(base(), ["a@x.org.il", "b@x.org.il", "c@x.org.il"]).length, 1)
  assert.ok(registryBlockers(readRegistry(), []).some((b) => b.includes("no real name")))
})
