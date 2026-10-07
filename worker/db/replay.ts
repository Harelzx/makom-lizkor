import { REAL, type Durations } from "../lib/durations"
import { replayDecision, type LedgerEntry } from "../lib/ledger"
import { sha256, type Manifest } from "../lib/sealed"
import { boundOpenReports, reconcilePlace, type ReconcileSummary } from "./reconcile"

export async function readLedger(ledger: R2Bucket) {
  const byPlace = new Map<string, LedgerEntry[]>()
  let cursor: string | undefined
  do {
    const page = await ledger.list({ prefix: "ledger/", cursor })
    for (const o of page.objects) {
      const entry = (await (await ledger.get(o.key))?.json()) as LedgerEntry | undefined
      if (entry) byPlace.set(entry.place, [...(byPlace.get(entry.place) ?? []), entry])
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return byPlace
}

type Row = Record<string, unknown>
const same = (a: unknown, b: unknown) => Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b)

/**
 * The statements that turn `before` into `after`, row by row and column by column: nothing else is written. A row is
 * known by its key columns (a curated photo by its revision and index).
 */
function changes(db: D1Database, table: string, before: Row[], after: Row[], key: string[] = ["id"]) {
  const out: D1PreparedStatement[] = []
  const id = (r: Row) => JSON.stringify(key.map((k) => r[k]))
  const where = key.map((k, i) => `${k} = ?${i + 1}`).join(" AND ")
  const was = new Map(before.map((r) => [id(r), r]))
  const now = new Set(after.map(id))
  for (const r of before) if (!now.has(id(r))) out.push(db.prepare(`DELETE FROM ${table} WHERE ${where}`).bind(...key.map((k) => r[k])))
  for (const r of after) {
    const old = was.get(id(r))
    if (!old) {
      const names = Object.keys(r)
      out.push(
        db
          .prepare(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`)
          .bind(...names.map((n) => r[n])),
      )
      continue
    }
    const changed = Object.keys(r).filter((c) => !same(r[c], old[c]))
    if (changed.length)
      out.push(
        db
          .prepare(`UPDATE ${table} SET ${changed.map((c, i) => `${c} = ?${i + key.length + 1}`).join(", ")} WHERE ${where}`)
          .bind(...key.map((k) => r[k]), ...changed.map((c) => r[c])),
      )
  }
  return out
}

/**
 * The ledger replayed onto a restored database: Route A from its point, and after Route B's import (which applied it
 * already, so this finds every place at the step it left it). Each place's rows are read, reconciled by the same rule
 * the import applies in memory (reconcilePlace), and only what changed is written. Requests open at the restore point
 * are bounded by `since`, the point itself (boundOpenReports). Content received after the point is not in the ledger,
 * and stays lost. Safe to run twice: a second run changes nothing.
 */
export async function replayLedger(
  db: D1Database,
  ledger: R2Bucket | Map<string, LedgerEntry[]>,
  now: Date,
  since: string,
  /** This deployment's retention day (worker/lib/durations.ts); the drill passes its own, the tests leave it real. */
  d: Durations = REAL,
) {
  const result: ReconcileSummary = { places: 0, applied: 0, quarantined: [], erased: [], lost: [] }
  const entriesByPlace = ledger instanceof Map ? ledger : await readLedger(ledger)
  let changed = false
  for (const [placeId, entries] of entriesByPlace) {
    result.places++
    const [p, revisions, contacts, suppressions, photos, sources] = await db.batch([
      db.prepare("SELECT * FROM places WHERE id = ?").bind(placeId),
      db.prepare("SELECT * FROM revisions WHERE place_id = ? ORDER BY rowid").bind(placeId),
      db.prepare("SELECT * FROM contacts WHERE place_id = ? ORDER BY rowid").bind(placeId),
      db.prepare("SELECT * FROM field_suppressions WHERE place_id = ? ORDER BY rowid").bind(placeId),
      db
        .prepare(
          "SELECT * FROM revision_photos WHERE revision_id IN (SELECT id FROM revisions WHERE place_id = ?) ORDER BY revision_id, idx",
        )
        .bind(placeId),
      db.prepare("SELECT * FROM place_sources WHERE place_id = ? ORDER BY rowid").bind(placeId),
    ])
    const place = p.results[0] as Row | undefined
    if (!place) {
      // Created after the restore point: its decisions are recorded, its content never was.
      const r = replayDecision(entries, 0)
      if (!r.erased && r.apply.length) result.lost.push(placeId)
      continue
    }
    const before = {
      place,
      revisions: revisions.results as Row[],
      contacts: contacts.results as Row[],
      suppressions: suppressions.results as Row[],
      photos: photos.results as Row[],
      sources: sources.results as Row[],
    }
    const r = reconcilePlace(before, entries, now, d)
    const statements = [
      ...changes(db, "places", [before.place], [r.rows.place]),
      ...changes(db, "revisions", before.revisions, r.rows.revisions),
      ...changes(db, "contacts", before.contacts, r.rows.contacts),
      ...changes(db, "field_suppressions", before.suppressions, r.rows.suppressions),
      // A revision is never deleted here, so the photos and sources that name it can follow in any order.
      ...changes(db, "revision_photos", before.photos, r.rows.photos!, ["revision_id", "idx"]),
      ...changes(db, "place_sources", before.sources, r.rows.sources!),
    ]
    if (statements.length) await db.batch(statements)
    changed ||= statements.length > 0
    result.applied += r.applied
    if (r.quarantined) result.quarantined.push(placeId)
    if (r.erased) result.erased.push(placeId)
  }
  const [reports, held] = await db.batch([
    db.prepare("SELECT id, status, purge_after FROM reports WHERE status != 'closed'"),
    db.prepare("SELECT id, report_id, notes_purge_after FROM field_suppressions WHERE report_id IS NOT NULL"),
  ])
  const bounded = boundOpenReports(reports.results as Row[], held.results as Row[], since, d)
  const statements = [
    ...changes(db, "reports", reports.results as Row[], bounded.reports),
    ...changes(db, "field_suppressions", held.results as Row[], bounded.suppressions),
  ]
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50))
  // The feed's version moves on, so every browser fetches the restored places again.
  if (changed && (result.applied || result.quarantined.length || result.erased.length))
    await db.prepare("UPDATE feed_state SET n = n + 1, changed_at = ? WHERE id = 1").bind(now.toISOString()).run()
  return result
}

/**
 * Photos put back from the export's copies when the photo bucket itself was lost (spec 8.3). A file returns only for a
 * place the restored database (after the ledger's replay) still publishes or holds, under the name it would have now:
 * public/ when shown, held/ when a hide covers it. Never for a withdrawn or erased place, never quarantine/, and only
 * if the copy's sha256 is the one the manifest recorded. A file already there is left as it is.
 */
export async function restorePhotos(db: D1Database, media: R2Bucket, exports: R2Bucket, manifest: Manifest) {
  const result = { restored: 0, missing: 0, damaged: 0 }
  const recorded = new Map(manifest.files.map((f) => [f.key.replace(/^held\//, "public/"), f.sha256]))
  const { results } = await db
    .prepare(
      `SELECT k.key, EXISTS (SELECT 1 FROM field_suppressions s WHERE s.place_id = p.id AND s.lifted_at IS NULL
         AND s.field IN ('photo', 'whole')) AS hidden
       FROM places p JOIN (
         SELECT id AS rid, photo_key AS key FROM revisions
         UNION ALL SELECT revision_id, key FROM revision_photos
         UNION ALL SELECT revision_id, thumb_key FROM revision_photos
       ) k ON k.rid = p.published_revision_id
       WHERE p.status IN ('published', 'hidden') AND k.key LIKE 'public/%'`,
    )
    .all<{ key: string; hidden: number }>()
  for (const { key, hidden } of results) {
    const target = hidden ? key.replace(/^public\//, "held/") : key
    if (await media.head(target)) continue
    const hash = recorded.get(key)
    const copy = hash ? await exports.get(`photos/${hash}`) : null
    if (!copy) {
      result.missing++
      continue
    }
    const bytes = new Uint8Array(await copy.arrayBuffer())
    if ((await sha256(bytes)) !== hash) {
      result.damaged++
      continue
    }
    await media.put(target, bytes, { httpMetadata: { contentType: key.endsWith(".webp") ? "image/webp" : "image/jpeg" } })
    result.restored++
  }
  return result
}
