// Append the facts even on an interrupted probe; a later success cannot erase contrary evidence.
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs"

export function freshReceipt(out) {
  for (const file of [out, `${out}.observations.jsonl`, `${out}.checked.json`])
    assert.ok(!existsSync(file), "Refusing to reuse a receipt or its observation history")
}

export async function observePrune(receipt, out, { query, objectStatus, clock = Date.now }) {
  const fixture = JSON.stringify({ marker: receipt.marker, at: receipt.at, exports: receipt.exports, objects: receipt.objects })
  const historyFile = `${out}.observations.jsonl`
  const history = existsSync(historyFile) ? readFileSync(historyFile, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : []
  const staleHistory = history.some((h) => h.fixture !== fixture)
  const record = { fixture, at: new Date(clock()).toISOString(), observed: [], complete: false, error: null }
  try {
    for (const e of receipt.exports) {
      assert.match(e.id, /^ex_[0-9A-HJKMNP-TV-Z]{26}$/)
      assert.match(e.photo, /^photos\/[a-f0-9]{64}$/)
      const item = { role: e.role, id: e.id, photoKey: e.photo }
      record.observed.push(item)
      item.row =
        (await query("SELECT ok,deleted_at FROM exports WHERE id=? AND retention_run=?", [e.id, `synthetic:${receipt.marker}`]))
          .results[0] ?? null
      for (const [field, key] of [
        ["data", `exports/${e.id}/data.bin`],
        ["manifest", `exports/${e.id}/manifest.json`],
        ["photo", e.photo],
      ]) {
        item[field] = await objectStatus(key)
        item[`${field}At`] = new Date(clock()).toISOString()
      }
    }
    record.complete = true
  } catch (err) {
    record.error = err instanceof Error ? err.name : "Error"
  }
  // Facts are durable before evaluating them, including partial observations and ordinary waiting.
  appendFileSync(historyFile, `${JSON.stringify(record)}\n`, { mode: 0o600 })
  const oldFixture = receipt.exports.find((e) => e.role === "old")
  const upload = Date.parse(receipt.objects.find((o) => o.key === oldFixture?.photo)?.provider_uploaded_at)
  assert.ok(Number.isFinite(upload), "Missing provider upload timestamp")
  const current = [...history.filter((h) => h.fixture === fixture), record]
  const tooYoung = (o) => Date.parse(o.photoAt) >= upload && Date.parse(o.photoAt) < upload + 7_200_000
  const premature = current.some((h) => h.observed.some((o) => o.role === "old" && o.photo === 404 && tooYoung(o)))
  const youngDamaged = current.some((h) =>
    h.observed.some(
      (o) =>
        o.role === "young" &&
        (o.row === null ||
          (o.row?.ok !== undefined && o.row.ok !== 0) ||
          !!o.row?.deleted_at ||
          [o.data, o.manifest, o.photo].some((s) => s !== undefined && s !== 200)),
    ),
  )
  const old = record.observed.find((o) => o.role === "old")
  const young = record.observed.find((o) => o.role === "young")
  const survived = current.some((h) =>
    h.observed.some(
      (o) =>
        o.role === "old" && o.row?.ok === 0 && !!o.row.deleted_at && o.data === 404 && o.manifest === 404 && o.photo === 200 && tooYoung(o),
    ),
  )
  let status = "incomplete"
  let reason = "Awaiting a complete scheduled-prune observation"
  if (premature || youngDamaged) {
    status = "failed"
    reason = premature ? "Observed premature photo deletion" : "Young backup changed"
  } else if (staleHistory) reason = "Receipt history belongs to another fixture"
  else if (
    record.complete &&
    old &&
    young &&
    old.row?.ok === 0 &&
    old.row.deleted_at &&
    old.data === 404 &&
    old.manifest === 404 &&
    young.row?.ok === 0 &&
    !young.row.deleted_at &&
    young.data === 200 &&
    young.manifest === 200 &&
    young.photo === 200
  ) {
    if (old.photo === 404 && survived) {
      status = "pass"
      reason = "Old export and aged orphan removed; young controls preserved"
    } else reason = survived ? "Waiting for real photo grace period and cron" : "Missing same-fixture young-orphan observation"
  }
  const result = { at: record.at, status, reason, observed: record.observed, error: record.error, providerTimeWasNotChanged: true }
  writeFileSync(`${out}.checked.json`, JSON.stringify(result, null, 2), { mode: 0o600 })
  return result
}
