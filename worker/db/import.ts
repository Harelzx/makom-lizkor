import { EXPORT_TABLES, type ExportTable } from "./exports"
import { BLANK_COLUMNS, retentionCutoffs } from "./retention"

type Row = Record<string, unknown>
/** An export as unsealed: what runExport wrote, table by table. */
export type ExportPayload = { format: 1; id: string; created_at: string; schema: string | null; tables: Record<string, Row[]> }

const due = (value: unknown, cutoff: string) => typeof value === "string" && value <= cutoff

/**
 * What a restore may write (spec 7, Route B): the export with every deletion rule applied at the moment of the import,
 * the same rules and dates as the retention job (retentionCutoffs, BLANK_COLUMNS). A submission whose days ran out
 * arrives as a tombstone, a closed correction past its days empty, and contact details, a request's text, a hide's
 * notes and a moderator's note past their dates are never written. So the new database's own history never holds them.
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
  const revisions = (tables.revisions ?? []).map((r0) => {
    const r = { ...r0 }
    if (erased.has(r.place_id)) return { ...r, ...BLANK_COLUMNS }
    const live = status.get(r.place_id) === "published" || status.get(r.place_id) === "hidden"
    if (live && ((r.state === "returned" && due(r.decided_at, c.returned)) || (r.state === "rejected" && due(r.decided_at, c.rejected))))
      return { ...r, ...BLANK_COLUMNS, state: r.state === "returned" ? "superseded" : r.state }
    const closed = r.state === "approved" || r.state === "rejected" || r.state === "superseded"
    if (r.decision_note !== null && (due(r.decided_at, c.noteCeiling) || (closed && due(r.decided_at, c.noteClosed))))
      r.decision_note = null
    return r
  })
  const contacts = (tables.contacts ?? []).filter((x) => !erased.has(x.place_id) && !due(x.purge_after, c.now))
  const reports = (tables.reports ?? []).map((x) =>
    due(x.purge_after, c.now)
      ? { ...x, relationship: null, explanation: null, email: null, explanation_hash: null, reporter_key: null, handling_note: null }
      : x,
  )
  const field_suppressions = (tables.field_suppressions ?? []).map((x) =>
    due(x.notes_purge_after, c.now) ? { ...x, reason: null, basis_detail: null, basis_note: x.basis_note === null ? null : "" } : x,
  )
  const out = { places, revisions, contacts, reports, field_suppressions } as Record<string, Row[]>
  return Object.fromEntries(EXPORT_TABLES.map((t) => [t, out[t] ?? tables[t] ?? []])) as Record<ExportTable, Row[]>
}

/** Rows written per batch: well under D1's limits on statements and bound values. */
const CHUNK = 50

/**
 * The filtered import into a new, empty database migrated to the export's schema (spec 8.3 B, step 3). Refused, with
 * nothing written, for another schema, a database that already holds places, or a column the database doesn't have.
 * Not atomic across batches: a failed import leaves a partial new database, which the procedure discards.
 */
export async function importExport(
  db: D1Database,
  payload: ExportPayload,
  now: Date,
): Promise<{ ok: true; counts: Record<string, number> } | { ok: false; reason: "format" | "schema" | "not_empty" | "columns" }> {
  if (payload.format !== 1 || typeof payload.tables !== "object") return { ok: false, reason: "format" }
  const [schema, places, ...columns] = await db.batch([
    db.prepare("SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1"),
    db.prepare("SELECT COUNT(*) AS n FROM places"),
    ...EXPORT_TABLES.map((t) => db.prepare("SELECT name FROM pragma_table_info(?)").bind(t)),
  ])
  if ((schema.results[0] as { name: string } | undefined)?.name !== payload.schema) return { ok: false, reason: "schema" }
  if ((places.results[0] as { n: number }).n !== 0) return { ok: false, reason: "not_empty" }
  const rows = filterForImport(payload.tables, now)
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
  return { ok: true, counts: Object.fromEntries(EXPORT_TABLES.map((t) => [t, rows[t].length])) }
}
