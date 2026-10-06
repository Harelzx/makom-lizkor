import type { LedgerEntry } from "../lib/ledger"
import { EXPORT_TABLES, type ExportTable } from "./exports"
import { reconcileTables, type ReconcileSummary } from "./reconcile"
import { BLANK_COLUMNS, retentionCutoffs, uploadedAt } from "./retention"

type Row = Record<string, unknown>
/** An export as unsealed: what runExport wrote, table by table. */
export type ExportPayload = { format: 1; id: string; created_at: string; schema: string | null; tables: Record<string, Row[]> }

const due = (value: unknown, cutoff: string) => typeof value === "string" && value <= cutoff

/**
 * What a restore may write (spec 7, Route B): the export with every deletion rule applied at the moment of the import,
 * the same rules and dates as the retention job (retentionCutoffs, BLANK_COLUMNS). A submission whose days ran out
 * arrives as a tombstone, a closed correction past its days empty, an address never verified before its link expired
 * without it, and contact details, a request's text, a hide's
 * notes, a moderator's note, a waiting photo's name and audit rows past their dates are never written (anemones'
 * records aren't exported at all). So the new database's own history never holds them.
 */
export function filterForImport(tables: Record<string, Row[]>, now: Date): Record<ExportTable, Row[]> {
  const c = retentionCutoffs(now)
  const erased = new Set<unknown>()
  const places = (tables.places ?? []).map((p0) => {
    const p = { ...p0 }
    const expired =
      (p.status === "returned" && due(p.status_changed_at, c.returned)) || (p.status === "rejected" && due(p.status_changed_at, c.rejected))
    if (!expired) return p
    erased.add(p.id)
    return {
      ...p,
      status: "erased",
      erased_reason: p.status === "returned" ? "returned_expired" : "rejected_expired",
      published_revision_id: null,
      submit_body_hash: null,
    }
  })
  const status = new Map(places.map((p) => [p.id, p.status]))
  // Revisions blanked here lose their curated photos and sources too, as the job deletes them (P7-REC-1).
  const blanked = new Set<unknown>()
  const revisions = (tables.revisions ?? []).map((r0) => {
    const r = { ...r0 }
    if (erased.has(r.place_id) || status.get(r.place_id) === "erased" || status.get(r.place_id) === "withdrawn") blanked.add(r.id)
    if (erased.has(r.place_id)) return { ...r, ...BLANK_COLUMNS }
    const live = status.get(r.place_id) === "published" || status.get(r.place_id) === "hidden"
    if (live && ((r.state === "returned" && due(r.decided_at, c.returned)) || (r.state === "rejected" && due(r.decided_at, c.rejected)))) {
      blanked.add(r.id)
      return { ...r, ...BLANK_COLUMNS, state: r.state === "returned" ? "superseded" : r.state }
    }
    const closed = r.state === "approved" || r.state === "rejected" || r.state === "superseded"
    if (r.decision_note !== null && (due(r.decided_at, c.noteCeiling) || (closed && due(r.decided_at, c.noteClosed))))
      r.decision_note = null
    // A photo still waiting past its days (its file isn't in the backup anyway).
    if ((r.state === "pending" || r.state === "returned") && typeof r.photo_key === "string" && r.photo_key.startsWith("quarantine/"))
      if (uploadedAt(r.photo_key) <= c.photo) Object.assign(r, { photo_key: null, photo_alt: null, photo_credit: null })
    return r
  })
  const contacts = (tables.contacts ?? [])
    .filter((x) => !erased.has(x.place_id) && !due(x.purge_after, c.now))
    .map((x) =>
      x.email !== null && x.email_verified_at === null && due(x.email_verify_expires, c.now)
        ? { ...x, email: null, email_verify_hash: null }
        : x,
    )
  const reports = (tables.reports ?? []).map((x) =>
    due(x.purge_after, c.now)
      ? { ...x, relationship: null, explanation: null, email: null, explanation_hash: null, reporter_key: null, handling_note: null }
      : x,
  )
  const field_suppressions = (tables.field_suppressions ?? []).map((x) =>
    due(x.notes_purge_after, c.now) ? { ...x, reason: null, basis_detail: null, basis_note: x.basis_note === null ? null : "" } : x,
  )
  const audit_log = (tables.audit_log ?? []).filter((x) => !due(x.at, c.audit))
  const revision_photos = (tables.revision_photos ?? []).filter((x) => !blanked.has(x.revision_id))
  const place_sources = (tables.place_sources ?? []).filter((x) => !blanked.has(x.revision_id))
  const out = { places, revisions, revision_photos, place_sources, contacts, reports, field_suppressions, audit_log } as Record<
    string,
    Row[]
  >
  return Object.fromEntries(EXPORT_TABLES.map((t) => [t, out[t] ?? tables[t] ?? []])) as Record<ExportTable, Row[]>
}

/** Rows written per batch: well under D1's limits on statements and bound values. */
const CHUNK = 50

/**
 * The filtered import into a new, empty database migrated to the export's schema (spec 8.3 B, step 3). The ledger is
 * applied to the export's rows first, in memory (reconcileTables), then the deletion rules (filterForImport), and only
 * then is anything written: a place withdrawn or a decision taken after the export never reaches the new database's
 * history in its earlier state. Refused, with nothing written, for another schema, a database that already holds
 * places, or a column the database doesn't have. Not atomic across batches: a failed import leaves a partial new
 * database, which the procedure discards.
 */
export async function importExport(
  db: D1Database,
  payload: ExportPayload,
  now: Date,
  ledger: Map<string, LedgerEntry[]>,
): Promise<
  | { ok: true; counts: Record<string, number>; reconciled: ReconcileSummary }
  | { ok: false; reason: "format" | "schema" | "not_empty" | "columns" }
> {
  if (payload.format !== 1 || typeof payload.tables !== "object") return { ok: false, reason: "format" }
  const [schema, places, ...columns] = await db.batch([
    db.prepare("SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1"),
    db.prepare("SELECT COUNT(*) AS n FROM places"),
    ...EXPORT_TABLES.map((t) => db.prepare("SELECT name FROM pragma_table_info(?)").bind(t)),
  ])
  if ((schema.results[0] as { name: string } | undefined)?.name !== payload.schema) return { ok: false, reason: "schema" }
  if ((places.results[0] as { n: number }).n !== 0) return { ok: false, reason: "not_empty" }
  const reconciled = reconcileTables(payload.tables, ledger, now, payload.created_at)
  const rows = filterForImport(reconciled.tables, now)
  const statements: D1PreparedStatement[] = [db.prepare("DELETE FROM feed_state")]
  for (const [i, t] of EXPORT_TABLES.entries()) {
    const known = new Set((columns[i].results as { name: string }[]).map((c) => c.name))
    for (const row of rows[t]) {
      const names = Object.keys(row)
      if (!names.length || names.some((n) => !known.has(n))) return { ok: false, reason: "columns" }
      statements.push(
        db.prepare(`INSERT INTO ${t} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`).bind(...names.map((n) => row[n])),
      )
    }
  }
  for (let i = 0; i < statements.length; i += CHUNK) await db.batch(statements.slice(i, i + CHUNK))
  return { ok: true, counts: Object.fromEntries(EXPORT_TABLES.map((t) => [t, rows[t].length])), reconciled: reconciled.summary }
}
