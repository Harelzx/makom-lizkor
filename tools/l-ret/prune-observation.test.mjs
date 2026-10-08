import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { freshReceipt, observePrune } from "./prune-observation.mjs"

const start = Date.parse("2026-10-08T15:00:00Z")
const fixture = () => ({
  marker: "PRUNE-example",
  at: new Date(start).toISOString(),
  exports: ["old", "young"].map((role, i) => ({ role, id: `ex_${String(i).repeat(26)}`, photo: `photos/${String(i).repeat(64)}` })),
  objects: [{ key: `photos/${"0".repeat(64)}`, provider_uploaded_at: new Date(start).toISOString() }],
})
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "prune-test-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const out = join(dir, "receipt.json")
  const receipt = fixture()
  return {
    out,
    receipt,
    run: (minutes, gone = false, interrupted = false, pruned = true) =>
      observePrune(receipt, out, {
        clock: () => start + minutes * 60000,
        query: async (_sql, [id]) => ({ results: [{ ok: 0, deleted_at: pruned && id === receipt.exports[0].id ? "removed" : null }] }),
        objectStatus: async (key) => {
          if (interrupted && key.endsWith("manifest.json")) throw new Error("private detail")
          return key === receipt.exports[0].photo ? (gone ? 404 : 200) : pruned && key.includes(receipt.exports[0].id) ? 404 : 200
        },
      }),
  }
}
test("same fixture survives grace then passes real-age cleanup", async (t) => {
  const x = setup(t)
  assert.equal((await x.run(15)).status, "incomplete")
  assert.equal((await x.run(130, true)).status, "pass")
  assert.equal(JSON.parse(readFileSync(`${x.out}.checked.json`)).status, "pass")
})
test("sidecars cannot be reused; stale history does not fulfill young control", async (t) => {
  const x = setup(t)
  freshReceipt(x.out)
  await x.run(15)
  assert.throws(() => freshReceipt(x.out))
  x.receipt.marker = "PRUNE-new"
  assert.equal((await x.run(130, true)).status, "incomplete")
  writeFileSync(`${x.out}.checked.json`, "{}")
  assert.throws(() => freshReceipt(x.out))
})
test("premature deletion is durable even if a later observation would pass", async (t) => {
  const x = setup(t)
  await x.run(15)
  assert.equal((await x.run(60, true)).status, "failed")
  assert.equal((await x.run(130, true)).status, "failed")
  assert.equal(readFileSync(`${x.out}.observations.jsonl`, "utf8").trim().split("\n").length, 3)
})
test("interrupted collection records sanitized partial facts and cannot pass", async (t) => {
  const x = setup(t)
  const result = await x.run(15, false, true)
  assert.equal(result.status, "incomplete")
  const record = JSON.parse(readFileSync(`${x.out}.observations.jsonl`))
  assert.equal(record.complete, false)
  assert.equal(record.observed[0].data, 404)
  assert.equal(record.error, "Error")
  assert.ok(!JSON.stringify(record).includes("private detail"))
})

test("photo present before pruning is not proof the cleaner honored its grace", async (t) => {
  const x = setup(t)
  assert.equal((await x.run(15, false, false, false)).status, "incomplete")
  assert.equal((await x.run(130, true)).status, "incomplete")
})
