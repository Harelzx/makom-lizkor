import { RETENTION } from "@/config"
import { durations, MONTH_DAYS, REAL, type Durations } from "../lib/durations"
import { ulid, ulidTime } from "../lib/ids"
import type { SendMail } from "../lib/mail"
import { runOp, WATCH_FIRST_LOOK_MS, type OpEnv } from "./ops"
import { erasePhotos, retirePhotos } from "./photos"
import { log } from "../lib/log"

/** Places erased in one run; the job runs every 15 minutes, so a backlog clears long before the day's bound. */
const ERASE_BATCH = 100

// Every content column of a revision and what an erasure leaves in it (the tombstone keeps the row's id, state and
// dates). The filtered import (db/import.ts) blanks with the same list.
export const BLANK_COLUMNS: Record<string, null | 0> = {
  kind: null,
  name_he: null,
  lat: null,
  lng: null,
  location_precision: null,
  on_private_property: 0,
  location_permission_at: null,
  access_note_he: null,
  place_he: null,
  in_memory_of: null,
  story_he: null,
  link_url: null,
  decision_note: null,
  photo_key: null,
  photo_alt: null,
  photo_credit: null,
  // A curated revision's own fields (phase 7); its photos and sources are rows of their own, deleted with it.
  curated: null,
}
const BLANK_REVISION = Object.entries(BLANK_COLUMNS)
  .map(([c, v]) => `${c} = ${v === null ? "NULL" : v}`)
  .join(", ")

/**
 * The dates each rule compares against, at a moment: the retention job binds these, and the filtered import applies
 * the same ones, so a restore can never keep what the job would have deleted by then. A month is 30 days (never a
 * calendar month), and a day is `d.day` (real everywhere but a scaled staging, worker/lib/durations.ts).
 */
export function retentionCutoffs(now: Date, d: Durations) {
  const ago = (days: number) => new Date(now.getTime() - days * d.day).toISOString()
  return {
    now: now.toISOString(),
    returned: ago(RETENTION.returnedDays),
    rejected: ago(RETENTION.rejectedTextDays),
    noteClosed: ago(RETENTION.contactAfterCloseDays),
    noteCeiling: ago(RETENTION.contactMaxMonths * MONTH_DAYS),
    photo: now.getTime() - RETENTION.unapprovedPhotoJobDays * d.day,
    tribute: ago(RETENTION.tributeDays),
    audit: ago(RETENTION.auditMonths * MONTH_DAYS),
  }
}
/** This deployment's retention day and hour: the env's, or real where none was given. */
const days = (env: { durations?: Durations }) => env.durations ?? REAL
const hasContent = (t: string) =>
  `(${["name_he", "story_he", "place_he", "in_memory_of", "lat", "access_note_he", "link_url", "decision_note", "photo_key", "curated"]
    .map((c) => `${t}.${c} IS NOT NULL`)
    .join(" OR ")})`

export type RetentionCounts = {
  erased: number
  revisions: number
  decisionNotes: number
  emails: number
  contacts: number
  reports: number
  notes: number
  photos: number
  tributes: number
  audit: number
}

/**
 * The retention job (spec 3.3, 7): the first part of every scheduled run, before anything else, and safe to run twice
 * at once. It erases what was abandoned and empties what reached its date:
 * - a submission returned for a correction and not corrected within RETENTION.returnedDays of being returned, and a
 *   refused one RETENTION.rejectedTextDays after the refusal, become tombstones: id, state, date and reason stay; all
 *   their content, their contact details and their files go, through the same durable operation as a withdrawal;
 * - a correction to a published place that was returned or refused loses its own text after the same days (the place,
 *   and what it publishes, stay), and a returned one is closed: no photo or text can be added to it any more;
 * - a moderator's note goes RETENTION.contactAfterCloseDays after its decision once its revision is closed, or at its ceiling;
 * - an address never verified goes when its verification link expires;
 * - contact details, a request's text and address, and moderators' notes on a hide go once their purge date passed;
 * - a photo not approved within RETENTION.rejectedPhotoDays of its upload, anemones' records after
 *   RETENTION.tributeDays, and audit rows after RETENTION.auditMonths.
 * A run is recorded, and counted as finished only when every part succeeded: a restore in place may go back no earlier
 * than the last finished run (spec 7, Route A).
 */
export async function runRetention(env: OpEnv, now: Date): Promise<{ id: string; ok: boolean; counts: RetentionCounts }> {
  const db = env.db
  const id = `rr_${ulid(now.getTime())}`
  const at = now.toISOString()
  await db.prepare("INSERT INTO retention_runs (id, started_at) VALUES (?, ?)").bind(id, at).run()
  const counts: RetentionCounts = {
    erased: 0,
    revisions: 0,
    decisionNotes: 0,
    emails: 0,
    contacts: 0,
    reports: 0,
    notes: 0,
    photos: 0,
    tributes: 0,
    audit: 0,
  }
  // Each part on its own: one that keeps failing (a bad row, say) never holds back the others. The run is finished
  // only when every part succeeded.
  let ok = true
  const part = async (name: keyof RetentionCounts, run: () => Promise<number>) => {
    try {
      counts[name] = await run()
    } catch (err) {
      ok = false
      // Logged as a code (decision_notes), which the log keeps; the counts' own key would be dropped.
      log("error", "retention_failed", { part: name.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`), error: (err as Error).name })
    }
  }
  await part("erased", () => eraseAbandoned(env, now))
  await part("revisions", () => blankClosedCorrections(env, now))
  // A moderator's note goes RETENTION.contactAfterCloseDays after its decision once that revision is no longer open
  // (approved, refused, or replaced by the sender's correction): never later than that after its case closed. A note on
  // a revision still returned to the sender goes with the 30-day erasure, and any note at RETENTION.contactMaxMonths.
  await part(
    "decisionNotes",
    async () =>
      (
        await db
          .prepare(
            `UPDATE revisions SET decision_note = NULL
             WHERE decision_note IS NOT NULL
               AND (decided_at <= ?1 OR (state IN ('approved', 'rejected', 'superseded') AND decided_at <= ?2))`,
          )
          .bind(retentionCutoffs(now, days(env)).noteCeiling, retentionCutoffs(now, days(env)).noteClosed)
          .run()
      ).meta.changes,
  )
  // An address nobody verified before its link expired can never be used: it goes then, not at its contact's date.
  await part(
    "emails",
    async () =>
      (
        await db
          .prepare(
            `UPDATE contacts SET email = NULL, email_verify_hash = NULL, verify_mail_state = NULL
             WHERE email IS NOT NULL AND email_verified_at IS NULL AND email_verify_expires <= ?`,
          )
          .bind(at)
          .run()
      ).meta.changes,
  )
  await part("contacts", async () => (await db.prepare("DELETE FROM contacts WHERE purge_after <= ?").bind(at).run()).meta.changes)
  await part(
    "reports",
    async () =>
      (
        await db
          .prepare(
            // The replay check's hash was taken over the whole request, email and explanation included, so it goes with
            // them (a fixed value: the column can't be empty, and a replay this late is refused as a different request).
            `UPDATE reports SET relationship = NULL, explanation = NULL, email = NULL, explanation_hash = NULL, reporter_key = NULL,
               handling_note = NULL, body_hash = 'purged'
             WHERE purge_after <= ?1 AND (relationship IS NOT NULL OR explanation IS NOT NULL OR email IS NOT NULL
               OR explanation_hash IS NOT NULL OR reporter_key IS NOT NULL OR handling_note IS NOT NULL OR body_hash != 'purged')`,
          )
          .bind(at)
          .run()
      ).meta.changes,
  )
  // A lifted hide keeps that it had a documented basis (its code, and an empty note), not what the note said.
  await part(
    "notes",
    async () =>
      (
        await db
          .prepare(
            `UPDATE field_suppressions SET reason = NULL, basis_detail = NULL,
               basis_note = CASE WHEN basis_note IS NULL THEN NULL ELSE '' END
             WHERE notes_purge_after <= ?1 AND (reason IS NOT NULL OR basis_detail IS NOT NULL OR basis_note != '')`,
          )
          .bind(at)
          .run()
      ).meta.changes,
  )
  await part("photos", () => expireUnapprovedPhotos(env, now))
  // The day's code of each anemone, with its place, day and time; the place's total stays.
  await part(
    "tributes",
    async () =>
      (
        await db
          .prepare("DELETE FROM tribute_events WHERE received_at <= ?")
          .bind(retentionCutoffs(now, days(env)).tribute)
          .run()
      ).meta.changes,
  )
  await part(
    "audit",
    async () =>
      (
        await db
          .prepare("DELETE FROM audit_log WHERE at <= ?")
          .bind(retentionCutoffs(now, days(env)).audit)
          .run()
      ).meta.changes,
  )
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
    .bind(retentionCutoffs(now, days(env)).returned, retentionCutoffs(now, days(env)).rejected, ERASE_BATCH)
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
        // A curated revision's photos and their credits, and every revision's sources, go with the content (P7-REC-1).
        db
          .prepare(`DELETE FROM revision_photos WHERE revision_id IN (SELECT id FROM revisions WHERE place_id = ?1) AND ${happened}`)
          .bind(row.id, tid),
        db.prepare(`DELETE FROM place_sources WHERE place_id = ?1 AND ${happened}`).bind(row.id, tid),
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
    .bind(retentionCutoffs(now, days(env)).returned, retentionCutoffs(now, days(env)).rejected, ERASE_BATCH)
    .all<{ id: string; photo_key: string | null }>()
  for (const r of results) {
    // A returned correction left uncorrected is closed with its text: an upload or a correction can't land in an empty row.
    await db.batch([
      db
        .prepare(
          `UPDATE revisions SET ${BLANK_REVISION}, state = CASE state WHEN 'returned' THEN 'superseded' ELSE state END
           WHERE id = ? AND state IN ('returned', 'rejected')`,
        )
        .bind(r.id),
      db.prepare("DELETE FROM revision_photos WHERE revision_id = ?").bind(r.id),
      db.prepare("DELETE FROM place_sources WHERE revision_id = ?").bind(r.id),
    ])
    // Its photo waited in quarantine; once no revision names it, the file goes too.
    if (r.photo_key?.startsWith("quarantine/")) {
      const named = await db.prepare("SELECT 1 FROM revisions WHERE photo_key = ?").bind(r.photo_key).first()
      if (!named) await env.media.delete(r.photo_key)
    }
  }
  return results.length
}

/** When a waiting photo was uploaded: its key ends with the upload's ULID (attachPhoto). */
export const uploadedAt = (key: string) =>
  ulidTime(
    key
      .split("/")
      .pop()
      ?.split("-")
      .pop()
      ?.replace(/\.jpg$/, "") ?? "",
  )

/**
 * A photo still waiting in quarantine/ RETENTION.unapprovedPhotoJobDays after its upload (a day inside the notice's
 * RETENTION.rejectedPhotoDays, so a late pass still keeps the promise), its submission or correction
 * undecided (or returned), goes: the revision stops naming it and the place's rev moves on in one step, so a
 * moderator's view that still showed it conflicts instead of approving a photo that is gone; then the file. A file whose deletion
 * fails is named by nothing, and the photo sweep takes it.
 */
async function expireUnapprovedPhotos(env: OpEnv, now: Date) {
  const db = env.db
  const { results } = await db
    .prepare("SELECT id, place_id, photo_key FROM revisions WHERE photo_key LIKE 'quarantine/%' AND state IN ('pending', 'returned')")
    .all<{ id: string; place_id: string; photo_key: string }>()
  let n = 0
  for (const r of results) {
    if (!(uploadedAt(r.photo_key) <= retentionCutoffs(now, days(env)).photo)) continue
    // One step (a batch is one transaction), both under the same condition: a decision that lands first leaves the
    // photo where it is, and one made on the view that showed the photo conflicts once this has landed.
    const still = "EXISTS (SELECT 1 FROM revisions WHERE id = ?2 AND photo_key = ?3 AND state IN ('pending', 'returned'))"
    const [moved] = await db.batch([
      db.prepare(`UPDATE places SET rev = rev + 1 WHERE id = ?1 AND ${still}`).bind(r.place_id, r.id, r.photo_key),
      db
        .prepare(
          `UPDATE revisions SET photo_key = NULL, photo_alt = NULL, photo_credit = NULL WHERE id = ?2 AND place_id = ?1 AND ${still}`,
        )
        .bind(r.place_id, r.id, r.photo_key),
    ])
    if (moved.meta.changes !== 1) continue
    n++
    await env.media.delete(r.photo_key).catch(() => undefined)
  }
  return n + (await expireCuratedPhotos(env, now))
}

/** When a curated photo's waiting files were uploaded: the earlier of the two quarantined keys (P7-RET-1). */
const waitingSince = (key: string, thumb: string) => Math.min(...[key, thumb].filter((k) => k.startsWith("quarantine/")).map(uploadedAt))

/**
 * A curated revision's photo still waiting in quarantine/ past the same days, its revision undecided (a draft whose
 * publication never landed, say): the photo's row and its source go and the place's rev moves on, in one step under
 * the same condition, so an approval made on the view that showed it conflicts; then its files, unless a live
 * revision names them (retirePhotos). A published photo is never in quarantine/, so it is never touched.
 */
async function expireCuratedPhotos(env: OpEnv, now: Date) {
  const db = env.db
  const { results } = await db
    .prepare(
      `SELECT rp.revision_id, rp.idx, rp.key, rp.thumb_key, r.place_id FROM revision_photos rp JOIN revisions r ON r.id = rp.revision_id
       WHERE r.state IN ('pending', 'returned') AND (rp.key LIKE 'quarantine/%' OR rp.thumb_key LIKE 'quarantine/%')`,
    )
    .all<{ revision_id: string; idx: number; key: string; thumb_key: string; place_id: string }>()
  let n = 0
  for (const r of results) {
    if (!(waitingSince(r.key, r.thumb_key) <= retentionCutoffs(now, days(env)).photo)) continue
    const still = `EXISTS (SELECT 1 FROM revision_photos rp JOIN revisions r ON r.id = rp.revision_id
      WHERE rp.revision_id = ?2 AND rp.idx = ?3 AND rp.key = ?4 AND rp.thumb_key = ?5 AND r.state IN ('pending', 'returned'))`
    const [moved] = await db.batch([
      db.prepare(`UPDATE places SET rev = rev + 1 WHERE id = ?1 AND ${still}`).bind(r.place_id, r.revision_id, r.idx, r.key, r.thumb_key),
      db
        .prepare(`DELETE FROM place_sources WHERE revision_id = ?2 AND field = 'photo' AND photo_idx = ?3 AND place_id = ?1 AND ${still}`)
        .bind(r.place_id, r.revision_id, r.idx, r.key, r.thumb_key),
      db
        .prepare(
          `DELETE FROM revision_photos WHERE revision_id = ?2 AND idx = ?3 AND ${still} AND EXISTS (SELECT 1 FROM revisions WHERE id = ?2 AND place_id = ?1)`,
        )
        .bind(r.place_id, r.revision_id, r.idx, r.key, r.thumb_key),
    ])
    if (moved.meta.changes !== 1) continue
    n++
    await retirePhotos(
      db,
      env.media,
      [r.key, r.thumb_key].filter((k) => k.startsWith("quarantine/")),
    )
  }
  return n
}

/**
 * Submissions and corrections waiting for review longer than RETENTION.reviewReminderDays (spec 7: the moderation
 * target; an unapproved photo goes at RETENTION.rejectedPhotoDays): the moderators are reminded, a count and nothing
 * else, once a day while any wait.
 */
export async function remindOverdueReview(db: D1Database, env: Env, sendMail: SendMail, now: Date) {
  const d = durations(env)
  const waiting = await db
    .prepare("SELECT COUNT(*) AS n FROM revisions WHERE state = 'pending' AND created_at <= ?")
    .bind(new Date(now.getTime() - RETENTION.reviewReminderDays * d.day).toISOString())
    .first<number>("n")
  if (!waiting) return false
  const sent = await db.prepare("SELECT sent_at FROM job_alerts WHERE job = 'review_overdue'").first<{ sent_at: string }>()
  if (sent && sent.sent_at > new Date(now.getTime() - d.day).toISOString()) return false
  const text = [
    `${waiting} הצעות או תיקונים ב"מקום לזכור" ממתינות לבדיקה יותר מ־${RETENTION.reviewReminderDays} יום.`,
    `תמונה שלא אושרה נמחקת ${RETENTION.rejectedPhotoDays} יום אחרי שהועלתה.`,
  ].join("\n")
  return tellModerators(db, env, sendMail, "review_overdue", "מקום לזכור: הצעות ממתינות לבדיקה", text, now)
}

/** Hours without a finished run before the moderators hear of it, and between reminders while it lasts. */
export const RETENTION_ALERT_HOURS = 6

/**
 * A stalled retention job breaks every deletion date the notices promise, quietly. When no run has finished in
 * RETENTION_ALERT_HOURS, the moderators are told by mail, with no data of anyone in it, and told again every
 * RETENTION_ALERT_HOURS while it lasts. A mail that couldn't go now is tried at the next run.
 */
export async function alertStalledRetention(db: D1Database, env: Env, sendMail: SendMail, now: Date) {
  const d = durations(env)
  const since = new Date(now.getTime() - RETENTION_ALERT_HOURS * d.hour).toISOString()
  const last = await db
    .prepare("SELECT MAX(finished_at) AS at, (SELECT MIN(started_at) FROM retention_runs) AS first FROM retention_runs WHERE ok = 1")
    .first<{ at: string | null; first: string | null }>()
  // A job that has never run yet (a new database) isn't stalled; one that has, with nothing finished since, is.
  if (!last?.first || (last.at ?? last.first) > since) return false
  const sent = await db.prepare("SELECT sent_at FROM job_alerts WHERE job = 'retention'").first<{ sent_at: string }>()
  if (sent && sent.sent_at > since) return false
  const text = [
    `עבודת המחיקה של "מקום לזכור" לא הסתיימה בהצלחה מאז ${last.at ?? "שהתחילה לרוץ"}.`,
    "כל עוד היא לא רצה, מועדי המחיקה שההודעות מבטיחות לא מתקיימים. כדאי לבדוק את היומנים (event: retention_failed).",
  ].join("\n")
  return tellModerators(db, env, sendMail, "retention", "מקום לזכור: עבודת המחיקה תקועה", text, now)
}

/**
 * A job's alert to every moderator, with no data of anyone in it; recorded as sent (so repeated only after the job's
 * interval) only when every mail went, so one that couldn't go now is tried at the next run.
 */
export async function tellModerators(db: D1Database, env: Env, sendMail: SendMail, job: string, subject: string, text: string, now: Date) {
  const moderators = [
    ...new Set(
      env.MODERATORS.split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  ]
  let all = moderators.length > 0
  for (const to of moderators) if (!(await sendMail(env, { to, subject, text, budget: "ops" }))) all = false
  if (!all) return false
  await db
    .prepare("INSERT INTO job_alerts (job, sent_at) VALUES (?1, ?2) ON CONFLICT (job) DO UPDATE SET sent_at = excluded.sent_at")
    .bind(job, now.toISOString())
    .run()
  return true
}
