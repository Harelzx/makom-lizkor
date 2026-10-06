import { RETENTION } from "@/config"
import { ulid } from "../lib/ids"
import { runOp, WATCH_FIRST_LOOK_MS, type OpEnv } from "./ops"
import { erasePhotos } from "./photos"

const DAY_MS = 86_400_000
/** Places erased in one run; the job runs every 15 minutes, so a backlog clears long before the day's bound. */
const ERASE_BATCH = 100

// Every content column of a revision: what an erasure blanks (the tombstone keeps the row's id, state and dates).
const BLANK_REVISION = `kind = NULL, name_he = NULL, lat = NULL, lng = NULL, location_precision = NULL, on_private_property = 0,
  location_permission_at = NULL, access_note_he = NULL, place_he = NULL, in_memory_of = NULL, story_he = NULL, link_url = NULL,
  decision_note = NULL, photo_key = NULL, photo_alt = NULL, photo_credit = NULL`
const hasContent = (t: string) =>
  `(${["name_he", "story_he", "place_he", "in_memory_of", "lat", "access_note_he", "link_url", "decision_note", "photo_key"]
    .map((c) => `${t}.${c} IS NOT NULL`)
    .join(" OR ")})`

export type RetentionCounts = { erased: number; revisions: number; contacts: number; reports: number; notes: number }

/**
 * The retention job (spec 3.3, 7): the first part of every scheduled run, before anything else, and safe to run twice
 * at once. It erases what was abandoned and empties what reached its date:
 * - a submission returned for a correction and not corrected within RETENTION.returnedDays of being returned, and a
 *   refused one RETENTION.rejectedTextDays after the refusal, become tombstones: id, state, date and reason stay; all
 *   their content, their contact details and their files go, through the same durable operation as a withdrawal;
 * - a correction to a published place that was returned or refused loses its own text after the same days (the place,
 *   and what it publishes, stay);
 * - contact details, a request's text and address, and moderators' notes on a hide go once their purge date passed.
 * A run is recorded, and counted as finished only when every part succeeded: a restore in place may go back no earlier
 * than the last finished run (spec 7, Route A).
 */
export async function runRetention(env: OpEnv, now: Date): Promise<{ id: string; ok: boolean; counts: RetentionCounts }> {
  const db = env.db
  const id = `rr_${ulid(now.getTime())}`
  const at = now.toISOString()
  await db.prepare("INSERT INTO retention_runs (id, started_at) VALUES (?, ?)").bind(id, at).run()
  const counts: RetentionCounts = { erased: 0, revisions: 0, contacts: 0, reports: 0, notes: 0 }
  let ok = true
  try {
    counts.erased = await eraseAbandoned(env, now)
    counts.revisions = await blankClosedCorrections(env, now)
    counts.contacts = (await db.prepare("DELETE FROM contacts WHERE purge_after <= ?").bind(at).run()).meta.changes
    counts.reports = (
      await db
        .prepare(
          `UPDATE reports SET relationship = NULL, explanation = NULL, email = NULL, explanation_hash = NULL, reporter_key = NULL,
             handling_note = NULL
           WHERE purge_after <= ?1 AND (relationship IS NOT NULL OR explanation IS NOT NULL OR email IS NOT NULL
             OR explanation_hash IS NOT NULL OR reporter_key IS NOT NULL OR handling_note IS NOT NULL)`,
        )
        .bind(at)
        .run()
    ).meta.changes
    // A lifted hide keeps that it had a documented basis (its code, and an empty note), not what the note said.
    counts.notes = (
      await db
        .prepare(
          `UPDATE field_suppressions SET reason = NULL, basis_detail = NULL,
             basis_note = CASE WHEN basis_note IS NULL THEN NULL ELSE '' END
           WHERE notes_purge_after <= ?1 AND (reason IS NOT NULL OR basis_detail IS NOT NULL OR basis_note != '')`,
        )
        .bind(at)
        .run()
    ).meta.changes
  } catch (err) {
    ok = false
    console.error(JSON.stringify({ level: "error", event: "retention_failed", error: (err as Error).name }))
  }
  await env.db
    .prepare("UPDATE retention_runs SET finished_at = ?, ok = ?, counts = ? WHERE id = ?")
    .bind(new Date(Math.max(now.getTime(), Date.now())).toISOString(), ok ? 1 : 0, JSON.stringify(counts), id)
    .run()
  return { id, ok, counts }
}

/** Returned and refused submissions past their days, erased to tombstones one durable operation each. */
async function eraseAbandoned(env: OpEnv, now: Date) {
  const db = env.db
  const { results } = await db
    .prepare(
      `SELECT id, rev, status FROM places
       WHERE (status = 'returned' AND status_changed_at <= ?1) OR (status = 'rejected' AND status_changed_at <= ?2)
       ORDER BY status_changed_at LIMIT ?3`,
    )
    .bind(
      new Date(now.getTime() - RETENTION.returnedDays * DAY_MS).toISOString(),
      new Date(now.getTime() - RETENTION.rejectedTextDays * DAY_MS).toISOString(),
      ERASE_BATCH,
    )
    .all<{ id: string; rev: number; status: "returned" | "rejected" }>()
  let erased = 0
  for (const row of results) if (await eraseOne(env, row, now)) erased++
  return erased
}

async function eraseOne(env: OpEnv, row: { id: string; rev: number; status: "returned" | "rejected" }, now: Date) {
  const db = env.db
  const at = now.toISOString()
  const reason = row.status === "returned" ? "returned_expired" : "rejected_expired"
  const happened = "EXISTS (SELECT 1 FROM places WHERE id = ?1 AND last_transition_id = ?2)"
  // Never public, so nothing to purge; recorded as a removal, so no restore can bring it back (spec 8.2). It goes ahead
  // even if the ledger can't record it now, and is repaired later, as a withdrawal is.
  const { outcome } = await runOp(
    env,
    {
      placeId: row.id,
      kind: "erase",
      actor: "automatic",
      expectedRev: row.rev,
      removal: true,
      public: false,
      onIntentFailure: "proceed",
      statements: (tid) => [
        // Only while it is still what was found: a correction sent at this moment takes it back to review instead.
        db
          .prepare(
            `UPDATE places SET status = 'erased', erased_reason = ?5, rev = rev + 1, last_transition_id = ?2, status_changed_at = ?3,
               published_revision_id = NULL, submit_body_hash = NULL
             WHERE id = ?1 AND rev = ?4 AND status = ?6`,
          )
          .bind(row.id, tid, at, row.rev, reason, row.status),
        db.prepare(`UPDATE revisions SET ${BLANK_REVISION} WHERE place_id = ?1 AND ${happened}`).bind(row.id, tid),
        db.prepare(`DELETE FROM contacts WHERE place_id = ?1 AND ${happened}`).bind(row.id, tid),
        // On the photo watch, as a withdrawal is: it erases whatever files the place still has.
        db
          .prepare(
            `INSERT INTO media_checks (place_id, due_at) SELECT ?1, ?3 WHERE ${happened}
             ON CONFLICT (place_id) DO UPDATE SET due_at = MIN(due_at, excluded.due_at)`,
          )
          .bind(row.id, tid, new Date(now.getTime() + WATCH_FIRST_LOOK_MS).toISOString()),
        db
          .prepare(
            `INSERT INTO audit_log (id, at, actor, action, entity_id, fields) SELECT ?3, ?4, 'automatic', 'erase', ?1, 'status' WHERE ${happened}`,
          )
          .bind(row.id, tid, `a_${ulid(now.getTime())}`, at),
      ],
    },
    now,
  )
  if (outcome !== "ok") return false
  // Its files go now, as a withdrawal's do; one that can't be deleted now (or a late write) is the photo watch's.
  await erasePhotos(env.media, row.id).catch(() => undefined)
  return true
}

/** A returned or refused correction to a place that stays published (or hidden): its own text and photo go. */
async function blankClosedCorrections(env: OpEnv, now: Date) {
  const db = env.db
  const { results } = await db
    .prepare(
      `SELECT r.id, r.photo_key FROM revisions r JOIN places p ON p.id = r.place_id
       WHERE r.state IN ('returned', 'rejected') AND p.status IN ('published', 'hidden') AND ${hasContent("r")}
         AND ((r.state = 'returned' AND r.decided_at <= ?1) OR (r.state = 'rejected' AND r.decided_at <= ?2))
       LIMIT ?3`,
    )
    .bind(
      new Date(now.getTime() - RETENTION.returnedDays * DAY_MS).toISOString(),
      new Date(now.getTime() - RETENTION.rejectedTextDays * DAY_MS).toISOString(),
      ERASE_BATCH,
    )
    .all<{ id: string; photo_key: string | null }>()
  for (const r of results) {
    await db.prepare(`UPDATE revisions SET ${BLANK_REVISION} WHERE id = ? AND state IN ('returned', 'rejected')`).bind(r.id).run()
    // Its photo waited in quarantine; once no revision names it, the file goes too.
    if (r.photo_key?.startsWith("quarantine/")) {
      const named = await db.prepare("SELECT 1 FROM revisions WHERE photo_key = ?").bind(r.photo_key).first()
      if (!named) await env.media.delete(r.photo_key)
    }
  }
  return results.length
}
