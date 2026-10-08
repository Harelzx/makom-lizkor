import assert from "node:assert/strict"
import { test } from "node:test"
import { cohortCoverage, assertReport } from "./guards.mjs"

const at = new Date("2026-10-08T12:00:00Z")
const exportedAt = "2026-10-08T10:00:00Z"
const before = "2026-10-08T09:00:00Z"
const roles = ["published", "returned", "rejected", "pending", "withdrawn", "report"]
const receipt = () => ({ items: roles.map((role) => ({ role, id: `synthetic_${role}`, at: before })) })
const payload = () => ({
  created_at: exportedAt,
  tables: {
    places: roles.filter((role) => role !== "report").map((role) => ({ id: `synthetic_${role}` })),
    reports: [{ id: "synthetic_report" }],
  },
})
const source = () => ({
  id: "synthetic_report",
  status: "closed",
  purge_after: "2026-10-09T10:00:00Z",
  explanation: "synthetic text",
  reporter_key: null,
  explanation_hash: null,
})

test("all six cohort cases must actually be exercised for complete evidence", () => {
  const result = cohortCoverage(receipt(), payload(), at)
  assert.equal(result.complete, true)
  assert.equal(result.checked.length, 6)
  assert.deepEqual(result.missing, [])
  const empty = cohortCoverage({ items: [] }, { created_at: exportedAt, tables: { places: [], reports: [] } }, at)
  assert.equal(empty.complete, false)
  assert.deepEqual(empty.missing, roles)
})

test("missing expected returned, rejected, withdrawn or report rows fail instead of silently skipping", () => {
  for (const role of ["returned", "rejected", "withdrawn", "report"]) {
    const data = payload()
    const table = role === "report" ? "reports" : "places"
    data.tables[table] = data.tables[table].filter((row) => row.id !== `synthetic_${role}`)
    assert.throws(() => cohortCoverage(receipt(), data, at), new RegExp(`Expected ${role} cohort row is missing`))
  }
})

test("legitimate newer-than-export exclusions remain incomplete, not failed or passed", () => {
  const newer = receipt()
  const data = payload()
  newer.items.find((item) => item.role === "withdrawn").at = "2026-10-08T11:00:00Z"
  data.tables.places = data.tables.places.filter((row) => row.id !== "synthetic_withdrawn")
  const result = cohortCoverage(newer, data, at)
  assert.equal(result.complete, false)
  assert.deepEqual(result.missing, ["withdrawn"])
  assert.equal(result.excluded[0].role, "withdrawn")
  assert.equal(result.checked.length, 5)
})

test("a report must survive restoration, with text kept before and blanked at its own deadline", () => {
  assertReport(source(), source(), at, source())
  assert.throws(() => assertReport(source(), null, at, source()), /report is absent/)
  assert.throws(() => assertReport(source(), { ...source(), explanation: null }, at, source()), /explanation does not match/)
  const expired = new Date(source().purge_after)
  assertReport(source(), { ...source(), explanation: null }, expired, source())
  assert.throws(() => assertReport(source(), source(), expired, source()), /explanation does not match/)
})

test("retained abuse identifiers fail in both exported and restored report rows", () => {
  for (const field of ["reporter_key", "explanation_hash"]) {
    assert.throws(() => assertReport({ ...source(), [field]: "synthetic-secret" }, source(), at, source()), /Export retained report/)
    assert.throws(() => assertReport(source(), { ...source(), [field]: "synthetic-secret" }, at, source()), /Restore retained report/)
  }
})
