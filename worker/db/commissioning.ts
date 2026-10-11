import { captureTables, EXPORT_TABLES, writeSnapshot, type ExportEnv } from "./exports"
import { openExport } from "./drill"
import { importExport, type ExportPayload } from "./import"
import { readLedger, replayLedger } from "./replay"
import { REAL } from "../lib/durations"
import { publicKeys, sha256, type Manifest } from "../lib/sealed"
import { ulid } from "../lib/ids"
import { BLANK_COLUMNS } from "./retention"

// A dated, owner-only exercise on the existing private deployment. No client chooses a database, key or place.
export const COMMISSIONING = {
  origin: "https://makom-lizkor.makom-staging.workers.dev",
  audience: "caaf96997451ebbdaa85e6bcf0aec39d94b58a3848bc4314a3bdb1274148f81e",
  owner: "harelzx41@gmail.com",
  fixture: "p_01M4MKR97MH3WC4N2Y8F2CZVXM",
  fixtureName: "בדיקת השקה פרטית 78813DA",
  photoFixture: "p_01M4MT8YN5KHHTPZ8Z6DY4MR0F",
  photoFixtureName: "בדיקת מדיה פרטית 20261011",
  expires: "2026-10-11T18:00:00.000Z",
  // Prepared at this real ULID time. The usual 35-day export prune owns these records too;
  // the media orphan sweep must never remove the one-attempt guard.
  marker: "exports/ex_01M4MS90PPW5CG4YWF0649R50B/commissioning/",
} as const

export function commissioningAllowed(env: Env, actor: string, machine: boolean, origin: string, now: Date) {
  return (
    env.ENVIRONMENT === "production" &&
    actor === COMMISSIONING.owner &&
    !machine &&
    origin === COMMISSIONING.origin &&
    env.PUBLIC_ORIGIN === COMMISSIONING.origin &&
    env.ACCESS_AUD === COMMISSIONING.audience &&
    env.MODERATORS === COMMISSIONING.owner &&
    now.getTime() < Date.parse(COMMISSIONING.expires)
  )
}
function fail(code: string): never {
  throw new Error(code)
}
export type CommissionEnv = ExportEnv & { ledger: R2Bucket; target: D1Database; drillKey: string }
const markerKey = (action: string) => `${COMMISSIONING.marker}${action}.json`

/** Refuse any live visitor's record, even on a still protected deployment. */
export function checkFixture(payload: Pick<ExportPayload, "tables">) {
  const { tables } = payload
  const places = tables.places ?? []
  if (places.length < 1 || places.length > 2) fail("fixture_scope")
  const primary = places.find((p) => p.id === COMMISSIONING.fixture)
  if (!primary || primary.status !== "published") fail("fixture_not_published")
  for (const p of places) {
    if (p.id !== COMMISSIONING.fixture && p.id !== COMMISSIONING.photoFixture) fail("fixture_identity")
    if (p.status !== "published") fail("fixture_not_published")
    const revisions = (tables.revisions ?? []).filter((r) => r.place_id === p.id)
    const r = revisions.find((r) => r.id === p.published_revision_id)
    if (!r || (p.id === COMMISSIONING.fixture ? r.name_he !== COMMISSIONING.fixtureName : r.name_he !== COMMISSIONING.photoFixtureName))
      fail("fixture_identity")
  }
  if (
    Object.values(tables).reduce((n, rows) => n + rows.length, 0) > 200 ||
    new TextEncoder().encode(JSON.stringify(tables)).byteLength > 1_000_000
  )
    fail("row_budget")
  if ((tables.contacts ?? []).some((c) => c.email !== "makomlizkor@gmail.com")) fail("contact_scope")
  const ids = new Set(places.map((p) => p.id))
  for (const rows of Object.values(tables)) if (rows.some((r) => r.place_id !== undefined && !ids.has(r.place_id))) fail("fixture_scope")
  if ((tables.reports ?? []).length) fail("report_scope")
}

async function claim(exports: R2Bucket, action: string, receipt: object) {
  // R2's conditional write serializes competing requests. A failed attempt remains claimed, never blindly retried.
  if (!(await exports.put(markerKey(action), JSON.stringify(receipt), { onlyIf: { etagDoesNotMatch: "*" } }))) fail("already_attempted")
}
export async function commissioningStatus(exports: R2Bucket) {
  const read = async (name: string) => (await exports.get(markerKey(name)))?.json() ?? null
  return {
    snapshot: await read("snapshot-result"),
    recovery: await read("recovery-result"),
    snapshotAttempt: await read("snapshot"),
    recoveryAttempt: await read("recovery"),
  }
}
const save = (exports: R2Bucket, action: string, result: object) => exports.put(markerKey(`${action}-result`), JSON.stringify(result))
const errorCode = (e: unknown) => (e instanceof Error && /^[a-z_]+$/.test(e.message) ? e.message : "operation_failed")

/** Separate from exports/drill_runs: this snapshot cannot move either regular job's due date. */
export async function manualSnapshot(env: CommissionEnv, now: Date) {
  if (env.db === env.target || publicKeys(env.keys).length !== 2) fail("bindings")
  const captured = await captureTables(env.db, 200)
  checkFixture(captured)
  const id = `ex_${ulid(now.getTime())}`
  await claim(env.exports, "snapshot", { id, at: now.toISOString() })
  try {
    const manifest = await writeSnapshot(
      { ...env, limits: { files: 4, photoBytes: 2_000_000 } },
      captured,
      id,
      "manual-commissioning-20261011",
      now,
    )
    const payload = await verifiedPayload(env, manifest)
    checkFixture(payload)
    const result = {
      ok: true,
      id,
      at: now.toISOString(),
      tables: manifest.tables,
      files: manifest.files,
      recipients: manifest.data.recipients.length,
      scheduledRowsWritten: 0,
    }
    await save(env.exports, "snapshot", result)
    return result
  } catch (e) {
    await save(env.exports, "snapshot", { ok: false, id, failure: errorCode(e) })
    throw e
  }
}

async function verifiedPayload(env: CommissionEnv, manifest: Manifest) {
  if (manifest.data.key !== `exports/${manifest.id}/data.bin` || manifest.data.size > 1_000_000 || manifest.files.length > 4)
    fail("manifest_scope")
  if (JSON.stringify(Object.keys(manifest.tables).sort()) !== JSON.stringify([...EXPORT_TABLES].sort())) fail("table_set")
  const sealed = await env.exports.get(manifest.data.key)
  if (!sealed || sealed.size !== manifest.data.size) fail("data_missing")
  const bytes = new Uint8Array(await sealed.arrayBuffer())
  if ((await sha256(bytes)) !== manifest.data.sha256) fail("data_checksum")
  const payload = await openExport(bytes, manifest, env.drillKey)
  if (payload.id !== manifest.id || payload.created_at !== manifest.created_at || payload.schema !== manifest.schema)
    fail("payload_identity")
  for (const t of EXPORT_TABLES) {
    const rows = payload.tables[t]
    if (
      !rows ||
      rows.length !== manifest.tables[t].rows ||
      (await sha256(new TextEncoder().encode(JSON.stringify(rows)))) !== manifest.tables[t].sha256
    )
      fail("table_checksum")
  }
  checkFixture(payload)
  for (const file of manifest.files) {
    if (!/^public\/p_[A-Z0-9]+\//.test(file.key) || file.size > 2_000_000) fail("photo_scope")
    const copy = await env.exports.get(`photos/${file.sha256}`)
    if (!copy || copy.size !== file.size || (await sha256(new Uint8Array(await copy.arrayBuffer()))) !== file.sha256) fail("photo_checksum")
  }
  return payload
}

async function counts(db: D1Database) {
  const result = await db.batch(EXPORT_TABLES.map((t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`)))
  return Object.fromEntries(EXPORT_TABLES.map((t, i) => [t, (result[i].results[0] as { n: number }).n]))
}

/** Only the empty DRILL_DB binding is writable, and only after a committed withdrawal of the captured fixtures. */
export async function manualRecovery(env: CommissionEnv, now: Date) {
  if (env.db === env.target) fail("bindings")
  const snapshot = await (await env.exports.get(markerKey("snapshot-result")))?.json<{ ok: boolean; id: string }>()
  if (!snapshot?.ok) fail("no_snapshot")
  const manifest = await (await env.exports.get(`exports/${snapshot.id}/manifest.json`))?.json<Manifest>()
  if (!manifest || manifest.retention_run !== "manual-commissioning-20261011") fail("no_manifest")
  const payload = await verifiedPayload(env, manifest)
  const fixtures = payload.tables.places.map((p) => String(p.id))
  for (const id of fixtures) {
    if ((await env.db.prepare("SELECT status FROM places WHERE id = ?").bind(id).first<string>("status")) !== "withdrawn")
      fail("not_withdrawn")
  }
  // A successful weekly drill within a day means its seven-day cadence excludes a competing scheduled restore.
  const scheduled = await env.db
    .prepare("SELECT started_at FROM drill_runs WHERE ok = 1 ORDER BY started_at DESC LIMIT 1")
    .first<string>("started_at")
  if (!scheduled || Date.parse(scheduled) < now.getTime() - REAL.day) fail("scheduled_drill_conflict")
  const before = await counts(env.target)
  if (Object.values(before).some((n) => n !== 0)) fail("target_not_empty")
  const ledgerPage = await env.ledger.list({ prefix: "ledger/", limit: 65 })
  if (ledgerPage.truncated || ledgerPage.objects.length > 64) fail("ledger_budget")
  const ledger = await readLedger(env.ledger)
  for (const id of fixtures)
    if (
      !(ledger.get(id) ?? []).some(
        (e) => e.kind === "withdraw" && e.phase === "commit" && Date.parse(e.at) >= Date.parse(manifest.created_at),
      )
    )
      fail("withdrawal_commit_missing")
  await claim(env.exports, "recovery", { id: snapshot.id, at: now.toISOString() })
  let outcome: Record<string, unknown> = { ok: false, id: snapshot.id }
  let failure: unknown
  try {
    const imported = await importExport(env.target, payload, now, ledger, REAL)
    if (!imported.ok) fail(`import_${imported.reason}`)
    const restoredCounts = await counts(env.target)
    if (EXPORT_TABLES.some((t) => restoredCounts[t] !== imported.counts[t])) fail("row_counts")
    await replayLedger(env.target, ledger, now, payload.created_at, REAL)
    for (const id of fixtures) {
      const place = await env.target
        .prepare("SELECT status, published_revision_id, submit_body_hash FROM places WHERE id = ?")
        .bind(id)
        .first()
      if (!place || place.status !== "withdrawn" || place.published_revision_id !== null || place.submit_body_hash !== null)
        fail("resurrected_place")
      const rows = await env.target.prepare("SELECT * FROM revisions WHERE place_id = ?").bind(id).all<Record<string, unknown>>()
      if (!rows.results.length || rows.results.some((r) => Object.entries(BLANK_COLUMNS).some(([k, v]) => r[k] !== v)))
        fail("resurrected_content")
      for (const table of ["contacts", "place_sources"])
        if (await env.target.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE place_id = ?`).bind(id).first<number>("n"))
          fail("resurrected_contact")
    }
    if (await env.target.prepare("SELECT COUNT(*) AS n FROM revision_photos").first<number>("n")) fail("resurrected_photo")
    outcome = {
      ok: true,
      id: snapshot.id,
      at: now.toISOString(),
      fixtures,
      restoredCounts,
      filesChecked: manifest.files.length,
      publicPhotoWrites: 0,
      scheduledRowsWritten: 0,
    }
  } catch (e) {
    failure = e
    outcome.failure = errorCode(e)
  } finally {
    try {
      await env.target.batch([...EXPORT_TABLES].reverse().map((t) => env.target.prepare(`DELETE FROM ${t}`)))
      const after = await counts(env.target)
      outcome.cleanup = after
      if (Object.values(after).some((n) => n !== 0)) fail("cleanup")
    } catch (e) {
      failure = e
      outcome.ok = false
      outcome.cleanupFailed = true
    }
    await save(env.exports, "recovery", outcome)
  }
  if (failure) throw failure
  return outcome
}
