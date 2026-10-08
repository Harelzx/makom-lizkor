import assert from "node:assert/strict"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"
import { cloudD1, queryResults, recoveryBudget, cleanupRecovery, targetSizeUpperBound } from "./cloud-recovery-support.mjs"

test("real adapter preserves bound null/numeric/text values and ordered batch results", async (t) => {
  const sqlite = new DatabaseSync(":memory:")
  t.after(() => sqlite.close())
  sqlite.exec("CREATE TABLE test(id INTEGER, value TEXT)")
  const db = cloudD1(async (body) =>
    queryResults(
      {
        success: true,
        result: (body.batch ?? [body]).map(({ sql, params }) => ({
          success: true,
          results: JSON.parse(JSON.stringify(sqlite.prepare(sql).all(...params))),
        })),
      },
      body.batch?.length ?? 1,
    ),
  )
  await db.prepare("INSERT INTO test VALUES (?,?)").bind(42, null).run()
  assert.deepEqual(await db.prepare("SELECT * FROM test").first(), { id: 42, value: null })
  const result = await db.batch([db.prepare("SELECT ? AS value").bind("first"), db.prepare("SELECT ? AS value").bind("second")])
  assert.deepEqual(
    result.map((x) => x.results[0].value),
    ["first", "second"],
  )
  assert.equal(await db.prepare("SELECT id FROM test").first("id"), 42)
})
test("refused, partial and failed per-statement replies cannot look successful", () => {
  for (const reply of [
    { success: false, result: [] },
    { success: true, result: [] },
    { success: true, result: [{ success: false, results: [] }] },
  ])
    assert.throws(() => queryResults(reply, 1))
})
test("a batch consumes its statement count and leaves cleanup allowance", () => {
  const b = recoveryBudget(),
    body = { batch: Array.from({ length: 50 }, () => ({ sql: "SELECT 1", params: [] })) }
  for (let i = 0; i < 19; i++) b.statements(body)
  assert.equal(b.sql, 950)
  assert.throws(() => b.statements(body))
  b.cleaning = true
  b.statements(body)
  assert.equal(b.sql, 1000)
  assert.throws(() => b.statements({ sql: "SELECT 1" }))
})
test("photo cleanup budget is reserved before writes", () => {
  const b = recoveryBudget()
  b.reservePhotos(20)
  for (let i = 0; i < 920; i++) b.request()
  assert.throws(() => b.request())
  b.cleaning = true
  for (let i = 0; i < 80; i++) b.request()
  assert.throws(() => b.request())
})
test("D1 cleanup failure cannot suppress photo deletion or later verification", async () => {
  const attempted = [],
    saved = []
  const result = await cleanupRecovery({
    db: {
      prepare: (sql) => ({ sql }),
      batch: async () => {
        throw Error()
      },
    },
    tables: ["places"],
    allocated: ["first", "second"],
    mayContainExercise: true,
    wasEmpty: false,
    remove: async (key) => {
      attempted.push(key)
      if (key === "first") throw Error()
    },
    absent: async (key) => key === "second",
    save: (x) => saved.push(structuredClone(x)),
  })
  assert.deepEqual(attempted, ["first", "second"])
  assert.equal(result.complete, false)
  assert.equal(result.database, "unverified")
  assert.equal(result.media[0].state, "unresolved")
  assert.ok(saved.length >= 3)
})
test("nonempty preflight does not claim cleanup; retry of already-absent objects is idempotent", async () => {
  let deleted = false
  const result = await cleanupRecovery({
    db: {
      batch: async () => {
        deleted = true
      },
    },
    tables: [],
    allocated: [],
    mayContainExercise: false,
    wasEmpty: false,
  })
  assert.equal(deleted, false)
  assert.equal(result.complete, false)
  const retry = await cleanupRecovery({
    db: { prepare: (sql) => ({ sql }), batch: async (rows) => rows.map(() => ({ results: [{ n: 0 }] })) },
    tables: ["places"],
    allocated: ["already-gone"],
    mayContainExercise: true,
    wasEmpty: false,
    remove: async () => {},
    absent: async () => true,
  })
  assert.equal(retry.complete, true)
})
test("space estimate includes data and worst-case row/index page overhead", () => {
  assert.ok(targetSizeUpperBound(278528, { places: [{ id: "one" }] }, { places: 3 }) > 278528 + 5 * 4096)
})
