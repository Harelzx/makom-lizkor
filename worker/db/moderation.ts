import type { Element } from "@/shared/contract"
import { ulid } from "../lib/ids"
import { runOp, type OpEnv, type OpOutcome } from "./ops"
import { notesCeiling } from "./reports"

const DAY_MS = 24 * 3600 * 1000
const plus90 = (now: Date) => new Date(now.getTime() + 90 * DAY_MS).toISOString()
const heldKey = (key: string) => key.replace(/^public\//, "held/")

/** The restoration codes of spec 6. There is no code for "no answer" or for a family disagreement: neither is a basis. */
export const BASIS_CODES = [
  "requester_withdrew",
  "family_requested_restore",
  "rights_cleared",
  "content_corrected",
  "hidden_in_error",
  "review_supports_restore",
  "legal_advice",
] as const
export type BasisCode = (typeof BASIS_CODES)[number]

/** A place as a moderator decides on it: its rev, its published photo and revision, and what is hidden now. */
export async function placeView(db: D1Database, id: string) {
  const place = await db
    .prepare(
      `SELECT p.id, p.status, p.rev, r.n AS revision_n, r.name_he, r.photo_key FROM places p
       LEFT JOIN revisions r ON r.id = p.published_revision_id WHERE p.id = ?`,
    )
    .bind(id)
    .first<{ id: string; status: string; rev: number; revision_n: number | null; name_he: string | null; photo_key: string | null }>()
  if (!place) return null
  const { results } = await db
    .prepare(
      `SELECT id, field, kind, report_id, created_at, created_by, reason FROM field_suppressions
       WHERE place_id = ? AND lifted_at IS NULL ORDER BY created_at, id`,
    )
    .bind(id)
    .all()
  return { ...place, suppressions: results }
}

/**
 * A moderator's hide: one click, never limited by the automatic path's safeguards (spec 6), but still signed in,
 * aimed at a place that is public (or already hidden, for more of its elements), justified by a reason, and made
 * against the rev the moderator saw. A removal a person asked for: if the ledger can't take the intent now, it goes
 * ahead and the record is repaired later.
 */
export async function suppress(
  env: OpEnv,
  i: { placeId: string; fields: Element[]; expectedRev: number; reason: string; reportId?: string; actor: string },
  now: Date,
): Promise<OpOutcome | "not_found" | "invalid_report"> {
  const db = env.db
  const place = await placeView(db, i.placeId)
  if (!place || (place.status !== "published" && place.status !== "hidden")) return "not_found"
  if (i.reportId && !(await db.prepare("SELECT 1 FROM reports WHERE id = ? AND place_id = ?").bind(i.reportId, i.placeId).first()))
    return "invalid_report"
  const whole = i.fields.includes("whole")
  const photo = (whole || i.fields.includes("photo")) && place.photo_key?.startsWith("public/") ? [place.photo_key] : []
  const at = now.toISOString()
  const happened = "EXISTS (SELECT 1 FROM places WHERE id = ?1 AND last_transition_id = ?2)"
  const { outcome } = await runOp(
    env,
    {
      placeId: i.placeId,
      kind: "suppress",
      actor: "moderator",
      expectedRev: i.expectedRev,
      removal: true,
      public: true,
      onIntentFailure: "proceed",
      detail: { fields: i.fields, report: i.reportId, toHeld: photo, media: photo },
      statements: (tid) => [
        db
          .prepare(
            `UPDATE places SET rev = rev + 1, last_transition_id = ?2,
               status_changed_at = CASE WHEN ?4 = 1 AND status != 'hidden' THEN ?3 ELSE status_changed_at END,
               status = CASE WHEN ?4 = 1 THEN 'hidden' ELSE status END
             WHERE id = ?1 AND rev = ?5 AND status IN ('published', 'hidden')`,
          )
          .bind(i.placeId, tid, at, whole ? 1 : 0, i.expectedRev),
        ...i.fields.map((field) =>
          db
            .prepare(
              `INSERT INTO field_suppressions (id, place_id, field, report_id, kind, revision_n, created_at, created_by, reason,
                 notes_ceiling_at, notes_purge_after)
               SELECT ?3, ?1, ?4, ?5, 'manual', ?6, ?7, ?8, ?9, ?10, MIN(?10, COALESCE((SELECT purge_after FROM reports WHERE id = ?5), ?10))
               WHERE ${happened}`,
            )
            .bind(
              i.placeId,
              tid,
              `s_${ulid(now.getTime())}`,
              field,
              i.reportId ?? null,
              place.revision_n,
              at,
              i.actor,
              i.reason,
              notesCeiling(now),
            ),
        ),
        db.prepare(`UPDATE feed_state SET n = n + 1, changed_at = ?3 WHERE id = 1 AND ${happened}`).bind(i.placeId, tid, at),
        db
          .prepare(
            `INSERT INTO audit_log (id, at, actor, action, entity_id, fields) SELECT ?3, ?4, ?5, 'manual_hide', ?1, ?6 WHERE ${happened}`,
          )
          .bind(i.placeId, tid, `a_${ulid(now.getTime())}`, at, i.actor, i.fields.join(",")),
      ],
    },
    now,
  )
  return outcome
}

export type LiftInput = {
  expectedRev: number
  basisCode: BasisCode
  basisNote: string
  /** The moderator affirms the basis is documented and positive, and that neither silence nor a family disagreement is it. */
  confirm: { affirmativeBasis?: boolean; notNonresponseOrDispute?: boolean }
  evidenceRef?: string
  adviserName?: string
  adviceDate?: string
  /** The recorded contact with the family or the memorial's body (spec 6); a verified request of theirs can be it. */
  familyContact?: { note: string; date: string }
  /** How a withdrawal or a family's request to restore was checked, proportionately (never identity documents). */
  verificationNote?: string
  /** For content_corrected: the moderator confirms the disputed material is absent from the newer revision. */
  materialAbsent?: boolean
}

export type LiftRefusal =
  | "basis_confirmation_required"
  | "evidence_required"
  | "adviser_required"
  | "verification_required"
  | "correction_required"
  | "family_contact_required"

/**
 * Restoring an element needs a documented basis (spec 6). The code checks that the basis was recorded the way its code
 * requires; whether the evidence holds is the moderator's judgment, which this records and never replaces. Lifting one
 * suppression lifts only it: an element hidden by another case stays hidden.
 */
export async function lift(
  env: OpEnv,
  suppressionId: string,
  i: LiftInput,
  actor: string,
  now: Date,
): Promise<OpOutcome | "not_found" | { refused: LiftRefusal }> {
  const db = env.db
  const sup = await db
    .prepare(`SELECT s.*, rep.requester_type FROM field_suppressions s LEFT JOIN reports rep ON rep.id = s.report_id WHERE s.id = ?`)
    .bind(suppressionId)
    .first<{
      place_id: string
      field: Element
      lifted_at: string | null
      revision_n: number | null
      report_id: string | null
      requester_type: string | null
    }>()
  if (!sup) return "not_found"
  if (sup.lifted_at) return "conflict"
  const place = (await placeView(db, sup.place_id))!

  if (!i.confirm.affirmativeBasis || !i.confirm.notNonresponseOrDispute) return { refused: "basis_confirmation_required" }
  if (i.basisCode === "rights_cleared" && !i.evidenceRef) return { refused: "evidence_required" }
  if (i.basisCode === "legal_advice" && (!i.adviserName || !i.adviceDate)) return { refused: "adviser_required" }
  if (i.basisCode === "content_corrected" && !(i.materialAbsent && (place.revision_n ?? 0) > (sup.revision_n ?? 0)))
    return { refused: "correction_required" }
  if (sup.requester_type === "family" && !i.familyContact) return { refused: "family_contact_required" }
  if ((i.basisCode === "requester_withdrew" || i.basisCode === "family_requested_restore") && !i.verificationNote)
    return { refused: "verification_required" }

  const others = new Set((place.suppressions as { id: string; field: string }[]).filter((s) => s.id !== suppressionId).map((s) => s.field))
  const restorePlace = sup.field === "whole" && !others.has("whole")
  // The photo is served again only when nothing else still hides it, by itself or with the whole place.
  const photoBack = (sup.field === "photo" || sup.field === "whole") && !others.has("photo") && !others.has("whole")
  const photo = photoBack && place.photo_key?.startsWith("public/") ? place.photo_key : null
  const at = now.toISOString()
  const happened = "EXISTS (SELECT 1 FROM places WHERE id = ?1 AND last_transition_id = ?2)"
  const { basisCode, basisNote, expectedRev, ...detail } = i
  const { outcome } = await runOp(
    env,
    {
      placeId: sup.place_id,
      kind: "lift",
      actor: "moderator",
      expectedRev,
      removal: false,
      public: true,
      // A restoration never happens unrecorded (spec 8.2).
      onIntentFailure: "refuse",
      detail: { fields: [sup.field], basis: basisCode, report: sup.report_id ?? undefined },
      // The held file is copied back before the decision, and served only once the database says it is public again.
      prepare: async () => {
        if (!photo) return
        const held = await env.media.get(heldKey(photo))
        if (!held) return
        await env.media.put(photo, await held.arrayBuffer(), { httpMetadata: held.httpMetadata })
        return { prepared: [photo], dropHeld: [heldKey(photo)], media: [photo] }
      },
      statements: (tid) => [
        db
          .prepare(
            `UPDATE places SET rev = rev + 1, last_transition_id = ?2,
               status_changed_at = CASE WHEN ?4 = 1 THEN ?3 ELSE status_changed_at END,
               status = CASE WHEN ?4 = 1 THEN 'published' ELSE status END
             WHERE id = ?1 AND rev = ?5 AND status IN ('published', 'hidden') AND (?4 = 0 OR published_revision_id IS NOT NULL)
               AND EXISTS (SELECT 1 FROM field_suppressions WHERE id = ?6 AND lifted_at IS NULL)`,
          )
          .bind(sup.place_id, tid, at, restorePlace ? 1 : 0, expectedRev, suppressionId),
        db
          .prepare(
            `UPDATE field_suppressions SET lifted_at = ?4, lifted_by = ?5, basis_code = ?6, basis_note = ?7, basis_detail = ?8,
               notes_purge_after = MIN(notes_purge_after, ?9)
             WHERE id = ?3 AND ${happened}`,
          )
          // Lifting ends the hide's case: what was written about it goes 90 days later at most.
          .bind(sup.place_id, tid, suppressionId, at, actor, basisCode, basisNote, JSON.stringify(detail), plus90(now)),
        db.prepare(`UPDATE feed_state SET n = n + 1, changed_at = ?3 WHERE id = 1 AND ${happened}`).bind(sup.place_id, tid, at),
        db
          .prepare(`INSERT INTO audit_log (id, at, actor, action, entity_id, fields) SELECT ?3, ?4, ?5, 'lift', ?1, ?6 WHERE ${happened}`)
          .bind(sup.place_id, tid, `a_${ulid(now.getTime())}`, at, actor, sup.field),
      ],
    },
    now,
  )
  return outcome
}

/** A page of a moderator list, newest first; `next` continues after the last item, null at the end. */
export const PAGE = 50
export type Cursor = { at: string; id: string }
const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)\|([A-Za-z0-9_-]{1,64})$/
/** A cursor as the lists hand it out (`<time>|<id>`); anything else is refused rather than read as the first page. */
export function parseCursor(raw: string | undefined): Cursor | null | "invalid" {
  if (!raw) return null
  const m = CURSOR.exec(raw)
  return m ? { at: m[1], id: m[2] } : "invalid"
}
const nextOf = (rows: Record<string, unknown>[], timeKey: string) => {
  if (rows.length <= PAGE) return { items: rows, next: null }
  const last = rows[PAGE - 1]
  return { items: rows.slice(0, PAGE), next: `${last[timeKey]}|${last.id}` }
}

/**
 * The moderators' queue of requests: what was asked and by whom (by kind), never the address unless asked for. Paged
 * by (received_at, id), newest first, so every request stays reachable however many there are.
 */
export async function listReports(db: D1Database, status: "open" | "closed" | "all", cursor: Cursor | null) {
  const where = status === "all" ? "1 = 1" : status === "closed" ? "rep.status = 'closed'" : "rep.status IN ('open', 'in_review')"
  const { results } = await db
    .prepare(
      `SELECT rep.id, rep.place_id, rep.origin, rep.elements, rep.requester_type, rep.relationship, rep.explanation,
         rep.email IS NOT NULL AS has_contact, rep.complete, rep.outcome, rep.status, rep.received_at, rep.backstop_at, rep.alerts,
         rep.alerted_at, rep.handled_by, rep.handling_note, rep.closed_at, r.name_he AS place_name, p.status AS place_status, p.rev AS place_rev
       FROM reports rep LEFT JOIN places p ON p.id = rep.place_id LEFT JOIN revisions r ON r.id = p.published_revision_id
       WHERE ${where} AND (?1 IS NULL OR rep.received_at < ?1 OR (rep.received_at = ?1 AND rep.id < ?2))
       ORDER BY rep.received_at DESC, rep.id DESC LIMIT ?3`,
    )
    .bind(cursor?.at ?? null, cursor?.id ?? null, PAGE + 1)
    .all<Record<string, unknown>>()
  return nextOf(results, "received_at")
}

/** The requester's address, for a moderator who needs to write to them; every reading is recorded (spec 10). */
export async function readContact(db: D1Database, ticket: string, actor: string, now: Date) {
  const email = await db.prepare("SELECT email FROM reports WHERE id = ?").bind(ticket).first<string | null>("email")
  if (email === undefined || email === null) return null
  await db
    .prepare("INSERT INTO audit_log (id, at, actor, action, entity_id, fields) VALUES (?, ?, ?, 'read_contact', ?, 'email')")
    .bind(`a_${ulid(now.getTime())}`, now.toISOString(), actor, ticket)
    .run()
  return email
}

/**
 * Recorded handling (stops the reminders; viewing doesn't), closing (the deletion date only moves earlier: at most 90
 * days from now, never past the 12-month ceiling) and reopening (which moves no date). Closing lifts nothing: a hide
 * is lifted only with its own documented basis.
 */
export async function setReportStatus(
  db: D1Database,
  ticket: string,
  to: "in_review" | "closed" | "open",
  actor: string,
  note: string | null,
  now: Date,
) {
  const at = now.toISOString()
  const stmt =
    to === "in_review"
      ? db
          .prepare("UPDATE reports SET status = 'in_review', handled_by = ?2, handling_note = ?3 WHERE id = ?1 AND status = 'open'")
          .bind(ticket, actor, note)
      : to === "closed"
        ? db
            .prepare(
              `UPDATE reports SET status = 'closed', closed_at = ?4, handled_by = ?2, handling_note = COALESCE(?3, handling_note), backstop_at = NULL,
                 purge_after = MIN(purge_after, ?5) WHERE id = ?1 AND status != 'closed'`,
            )
            .bind(ticket, actor, note, at, plus90(now))
        : db.prepare("UPDATE reports SET status = 'open', closed_at = NULL WHERE id = ?1 AND status = 'closed'").bind(ticket)
  const [changed] = await db.batch([
    stmt,
    db
      .prepare("INSERT INTO audit_log (id, at, actor, action, entity_id, fields) SELECT ?, ?, ?, ?, ?, 'status' WHERE changes() = 1")
      .bind(`a_${ulid(now.getTime())}`, at, actor, `report_${to}`, ticket),
    // A closed request's hides keep what moderators wrote about them 90 days at most, like the request itself. After
    // the audit row, which reads changes() of the status update just before it.
    ...(to === "closed"
      ? [
          db
            .prepare(
              "UPDATE field_suppressions SET notes_purge_after = MIN(notes_purge_after, ?2) WHERE report_id = ?1 AND EXISTS (SELECT 1 FROM reports WHERE id = ?1 AND status = 'closed')",
            )
            .bind(ticket, plus90(now)),
        ]
      : []),
  ])
  return changed.meta.changes === 1
}

/**
 * Operations a moderator should see: removals that stopped before they landed, records to repair, purges given up.
 * Paged like the requests, so none is out of reach.
 */
export async function attention(db: D1Database, cursor: Cursor | null) {
  const { results } = await db
    .prepare(
      `SELECT id, place_id, kind, actor, created_at,
         CASE WHEN state = 'refused' THEN 'interrupted'
              WHEN intent = 'failed' OR ledger_commit = 'failed' THEN 'ledger_repair'
              WHEN media = 'failed' THEN 'media_failed'
              ELSE 'purge_abandoned' END AS problem
       FROM visibility_ops
       WHERE ((state = 'refused' AND refused_reason = 'interrupted' AND removal = 1)
          OR (state = 'applied' AND (intent = 'failed' OR ledger_commit = 'failed' OR media = 'failed' OR purge = 'abandoned')))
         AND (?1 IS NULL OR created_at < ?1 OR (created_at = ?1 AND id < ?2))
       ORDER BY created_at DESC, id DESC LIMIT ?3`,
    )
    .bind(cursor?.at ?? null, cursor?.id ?? null, PAGE + 1)
    .all<Record<string, unknown>>()
  return nextOf(results, "created_at")
}
