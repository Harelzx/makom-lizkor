import { RETENTION } from "@/config"
import { decidedAt, replayDecision, type LedgerEntry } from "../lib/ledger"
import { notesCeiling } from "./reports"
import { BLANK_COLUMNS } from "./retention"

type Row = Record<string, unknown>
/** One place as a restore holds it: its row and the rows that belong to it. */
export type PlaceRows = { place: Row; revisions: Row[]; contacts: Row[]; suppressions: Row[] }
export type Reconciled = { rows: PlaceRows; applied: number; quarantined: boolean; erased: boolean }

const DAY_MS = 86_400_000
const plusDays = (at: string, days: number) => new Date(Date.parse(at) + days * DAY_MS).toISOString()
const earlier = (a: unknown, b: string) => (typeof a === "string" && a <= b ? a : b)
const TOMBSTONE = ["withdrawn", "erased"]

/**
 * The ledger's decisions applied to one place as a restore holds it (spec 8.2, 8.3), by replayDecision's rules. Pure:
 * the same rules for the rows of an export before anything is written (Route B and the drill), and for a database
 * restored in place (Route A), so the two can never drift apart.
 * - A withdrawal or an erasure that took effect makes the place a tombstone, its content and contact gone, whatever
 *   else was recorded: it never comes back. A place that is a tombstone already stays one.
 * - Committed decisions are applied in chain order, each dated by when it was made. An approval or a refusal moves
 *   the sender's contact date to at most RETENTION.contactAfterCloseDays after it, as the live decision did; a date is
 *   never moved later. An approval publishes exactly the photo it published, or none.
 * - A gap in the chain, an approval of a revision the restored copy doesn't have, or of a photo other than the one the
 *   restored copy names, hides the whole place until a moderator looks.
 */
export function reconcilePlace(original: PlaceRows, entries: LedgerEntry[], now: Date): Reconciled {
  const rows: PlaceRows = {
    place: { ...original.place },
    revisions: original.revisions.map((r) => ({ ...r })),
    contacts: original.contacts.map((c) => ({ ...c })),
    suppressions: original.suppressions.map((s) => ({ ...s })),
  }
  const { place } = rows
  const placeId = place.id as string
  const fromSeq = (place.ledger_seq as number) ?? 0
  const r = replayDecision(entries, fromSeq)
  const lastSeq = Math.max(fromSeq, ...r.apply.map((e) => e.seq_to))

  if (r.erased) {
    const status = entries.some((e) => e.kind === "withdraw" && (e.phase === "commit" || e.phase === "intent")) ? "withdrawn" : "erased"
    Object.assign(place, {
      status,
      published_revision_id: null,
      submit_body_hash: null,
      ledger_seq: lastSeq,
      erased_reason: status === "erased" ? (place.erased_reason ?? "restored") : place.erased_reason,
    })
    for (const rev of rows.revisions) Object.assign(rev, BLANK_COLUMNS, status === "withdrawn" ? { state: "withdrawn" } : {})
    rows.contacts = []
    return { rows, applied: r.apply.length, quarantined: false, erased: true }
  }
  if (TOMBSTONE.includes(place.status as string)) return { rows, applied: 0, quarantined: false, erased: false }

  const closeContacts = (at: string) => {
    for (const c of rows.contacts) c.purge_after = earlier(c.purge_after, plusDays(at, RETENTION.contactAfterCloseDays))
  }
  let quarantine = r.quarantine
  for (const e of r.apply) {
    const at = decidedAt(e)
    const revision = e.revision ? rows.revisions.find((x) => x.id === e.revision) : undefined
    if (e.kind === "approve") {
      // The sender's contact date follows the decision, whether or not the restored copy holds what it decided.
      closeContacts(at)
      if (!revision) {
        quarantine = true
        continue
      }
      const published = e.media?.find((k) => k.startsWith(`public/${placeId}/`)) ?? null
      // The photo it published came from the one the revision named then; a restored copy naming another can't say
      // which description and credit go with it.
      const unknown = published !== null && e.source !== undefined && revision.photo_key !== e.source && revision.photo_key !== published
      if (unknown) quarantine = true
      const photo = unknown ? null : published
      for (const other of rows.revisions) if (other.state === "approved" && other.id !== revision.id) other.state = "superseded"
      Object.assign(
        revision,
        { state: "approved", decided_at: at, photo_key: photo },
        photo === null ? { photo_alt: null, photo_credit: null } : {},
      )
      Object.assign(place, { status: e.status ?? "published", published_revision_id: revision.id, status_changed_at: at })
    } else if (e.kind === "reject" || e.kind === "return") {
      if (revision) {
        const dropPhoto = e.kind === "reject" && typeof revision.photo_key === "string" && revision.photo_key.startsWith("quarantine/")
        Object.assign(
          revision,
          { state: e.kind === "reject" ? "rejected" : "returned", decided_at: at },
          dropPhoto ? { photo_key: null, photo_alt: null, photo_credit: null } : {},
        )
      }
      if (e.status) Object.assign(place, { status: e.status, status_changed_at: at })
      if (e.kind === "reject") closeContacts(at)
    } else if (e.kind === "suppress") {
      for (const [i, id] of (e.targets ?? []).entries())
        if (!rows.suppressions.some((s) => s.id === id))
          rows.suppressions.push({
            id,
            place_id: placeId,
            field: e.fields?.[i] ?? "whole",
            kind: e.actor === "automatic" ? "precautionary" : "manual",
            created_at: at,
            created_by: "ledger",
            notes_ceiling_at: notesCeiling(new Date(at)),
            notes_purge_after: notesCeiling(new Date(at)),
          })
      const status = e.status ?? (e.fields?.includes("whole") ? "hidden" : null)
      if (status && (place.status === "published" || place.status === "hidden")) place.status = status
    } else if (e.kind === "lift") {
      for (const id of e.targets ?? []) {
        const s = rows.suppressions.find((x) => x.id === id && x.lifted_at == null)
        if (s)
          Object.assign(s, {
            lifted_at: at,
            lifted_by: "ledger",
            basis_code: e.basis ?? "restored",
            basis_note: "",
            notes_purge_after: earlier(s.notes_purge_after, plusDays(at, 90)),
          })
      }
      if (e.status) place.status = e.status
    }
    place.rev = Math.max(place.rev as number, e.rev_to)
  }
  place.ledger_seq = lastSeq
  if (quarantine) {
    // Hidden whole, by a hide a moderator lifts after looking; one per place and step, so a second run adds none.
    const id = `s_replay_${placeId}_${lastSeq}`
    if (!rows.suppressions.some((s) => s.id === id))
      rows.suppressions.push({
        id,
        place_id: placeId,
        field: "whole",
        kind: "precautionary",
        created_at: now.toISOString(),
        created_by: "ledger",
        notes_ceiling_at: notesCeiling(now),
        notes_purge_after: notesCeiling(now),
      })
    if (place.status === "published") place.status = "hidden"
  }
  return { rows, applied: r.apply.length, quarantined: quarantine, erased: false }
}

/**
 * A request's closure is not in the ledger (it changes no place), so one closed after the restore point is open in the
 * restored copy. Its contact and text go RETENTION 90 days after closing, and closing came at that point or later: every
 * request open at that point goes at most 90 days after it, and its hides' notes with it. Earlier, never later, than the
 * live date. Moderators go through the open requests first after a restore (docs/retention-timeline.md).
 */
export function boundOpenReports(reports: Row[], suppressions: Row[], since: string) {
  const bound = plusDays(since, 90)
  const open = new Set<unknown>()
  const outReports = reports.map((r) => {
    if (r.status === "closed") return r
    open.add(r.id)
    return { ...r, purge_after: earlier(r.purge_after, bound) }
  })
  const outSuppressions = suppressions.map((s) =>
    open.has(s.report_id) ? { ...s, notes_purge_after: earlier(s.notes_purge_after, bound) } : s,
  )
  return { reports: outReports, suppressions: outSuppressions }
}

export type ReconcileSummary = { places: number; applied: number; quarantined: string[]; erased: string[]; lost: string[] }

/**
 * The ledger applied to an export's tables in memory (Route B, the drill), before anything is filtered or written:
 * so the new database never holds, even for a moment, what was withdrawn or decided after the export.
 */
export function reconcileTables(
  tables: Record<string, Row[]>,
  ledger: Map<string, LedgerEntry[]>,
  now: Date,
  since: string,
): { tables: Record<string, Row[]>; summary: ReconcileSummary } {
  const summary: ReconcileSummary = { places: 0, applied: 0, quarantined: [], erased: [], lost: [] }
  const out: Record<string, Row[]> = { ...tables }
  const byPlace = (t: string, id: unknown) => (out[t] ?? []).filter((x) => x.place_id === id)
  for (const [placeId, entries] of ledger) {
    summary.places++
    const place = (out.places ?? []).find((p) => p.id === placeId)
    if (!place) {
      // Created after the export: its decisions are recorded, its content never was.
      const r = replayDecision(entries, 0)
      if (!r.erased && r.apply.length) summary.lost.push(placeId)
      continue
    }
    const result = reconcilePlace(
      {
        place,
        revisions: byPlace("revisions", placeId),
        contacts: byPlace("contacts", placeId),
        suppressions: byPlace("field_suppressions", placeId),
      },
      entries,
      now,
    )
    const swap = (t: string, rows: Row[]) => [...(out[t] ?? []).filter((x) => x.place_id !== placeId), ...rows]
    out.places = (out.places ?? []).map((p) => (p.id === placeId ? result.rows.place : p))
    out.revisions = swap("revisions", result.rows.revisions)
    out.contacts = swap("contacts", result.rows.contacts)
    out.field_suppressions = swap("field_suppressions", result.rows.suppressions)
    summary.applied += result.applied
    if (result.quarantined) summary.quarantined.push(placeId)
    if (result.erased) summary.erased.push(placeId)
  }
  const bounded = boundOpenReports(out.reports ?? [], out.field_suppressions ?? [], since)
  out.reports = bounded.reports
  out.field_suppressions = bounded.suppressions
  // The feed's version moves on, so every browser fetches the restored places again.
  if (summary.applied || summary.quarantined.length || summary.erased.length)
    out.feed_state = (out.feed_state ?? []).map((f) => ({ ...f, n: (f.n as number) + 1, changed_at: now.toISOString() }))
  return { tables: out, summary }
}
