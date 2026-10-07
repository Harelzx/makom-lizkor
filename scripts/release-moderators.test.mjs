// node --test scripts/release-moderators.test.mjs
import assert from "node:assert/strict"
import { test } from "node:test"
import { moderatorBlockers } from "./release-moderators.mjs"

const vars = (MODERATORS) => ({ vars: { MODERATORS } })

test("one to three real addresses pass", () => {
  assert.deepEqual(moderatorBlockers(vars("operator@makom-lizkor.org.il")), [])
  assert.deepEqual(moderatorBlockers(vars("a@makom-lizkor.org.il, b@gmail.com,c@outlook.com")), [])
})
test("an empty or missing list blocks: no one would hear an alert", () => {
  assert.equal(moderatorBlockers(vars("")).length, 1)
  assert.equal(moderatorBlockers(vars(" , ")).length, 1)
  assert.equal(moderatorBlockers({}).length, 1)
})
test("a development or placeholder address blocks", () => {
  for (const bad of ["dev@example.test", "a@example.org", "x@makom.example", "nobody", "a@localhost"])
    assert.equal(moderatorBlockers(vars(bad)).length, 1, bad)
})
test("a fourth person blocks, however the addresses are written", () => {
  assert.equal(moderatorBlockers(vars("a@x.org.il,b@x.org.il,c@x.org.il,d@x.org.il")).length, 1)
  assert.deepEqual(moderatorBlockers(vars("a@x.org.il,A@x.org.il,b@x.org.il,c@x.org.il")), [])
})
test("a machine moderator's token in the production config blocks: it is staging's alone (H1)", () => {
  const raw = { vars: { MODERATORS: "operator@makom-lizkor.org.il", MODERATOR_SERVICE_TOKENS: "abc.access" } }
  const blockers = moderatorBlockers(raw)
  assert.equal(blockers.length, 1)
  assert.match(blockers[0], /MODERATOR_SERVICE_TOKENS/)
  assert.deepEqual(moderatorBlockers({ vars: { MODERATORS: "operator@makom-lizkor.org.il", MODERATOR_SERVICE_TOKENS: " " } }), [])
})
