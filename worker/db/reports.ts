import type { Element, ReportInput } from "@/shared/contract"
import { REPORT_GUARDS, complete, isSpam, linkCount, normalizeExplanation } from "../lib/guards"
import { sha256Hex, ulid } from "../lib/ids"
import type { Mail } from "../lib/mail"
import { reportAlertMail } from "../lib/messages"
import { runOp, type OpEnv } from "./ops"
import { hmacHex } from "./places"

// An approximation of a month, as for contacts; phase 5 reads calendar months from RETENTION (src/config.ts).
const MONTH_MS = 30 * 24 * 3600 * 1000
const HOUR_MS = 3600 * 1000

export type Target = { origin: "contribution" | "curated"; published: boolean }

export type ReportRow = {
  id: string
  place_id: string
  origin: "contribution" | "curated"
  elements: string
  complete: number
  outcome: "hidden_for_review" | "received"
  status: "open" | "in_review" | "closed"
  explanation_hash: string | null
  reporter_key: string | null
  received_at: string
  body_hash: string
}

/** Whether this key already made a report: its retry is answered from what is stored, and skips the browser check. */
export async function reportKnown(db: D1Database, key: string) {
  return !!(await db
    .prepare("SELECT 1 FROM reports WHERE submit_key_hash = ?")
    .bind(await sha256Hex(key))
    .first())
}

/**
 * Stores a request once per key. A retry with the same body gets the stored ticket and outcome and creates nothing; the
 * same key with a different body is refused. Everything the requester wrote, and their address, is kept to the earlier
 * of 12 months or 90 days after the case closes (spec 7); the keyed hashes used to spot spam go with it.
 */
export async function insertReport(
  db: D1Database,
  input: ReportInput,
  target: Target,
  key: string,
  secret: string,
  reporterKey: string | null,
  now: Date,
): Promise<
  { kind: "created"; ticket: string; complete: boolean } | { kind: "replayed"; ticket: string; outcome: string } | { kind: "mismatch" }
> {
  const keyHash = await sha256Hex(key)
  const bodyHash = await hmacHex(secret, `report:${JSON.stringify(input)}`)
  const ticket = `r_${ulid(now.getTime())}`
  const at = now.toISOString()
  const ceiling = new Date(now.getTime() + 12 * MONTH_MS).toISOString()
  const isComplete = complete(input, target)
  const inserted = await db
    .prepare(
      `INSERT INTO reports (id, place_id, origin, elements, requester_type, relationship, explanation, email, notice_version, submit_key_hash,
         body_hash, explanation_hash, reporter_key, complete, outcome, status, backstop_at, received_at, ceiling_at, purge_after)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 'received', 'open', ?15, ?16, ?17, ?17)
       ON CONFLICT (submit_key_hash) DO NOTHING`,
    )
    .bind(
      ticket,
      input.placeId,
      target.origin,
      JSON.stringify(input.elements),
      input.requesterType,
      input.relationship ?? null,
      input.explanation,
      input.email ?? null,
      input.noticeVersion,
      keyHash,
      bodyHash,
      await hmacHex(secret, `explanation:${normalizeExplanation(input.explanation)}`),
      reporterKey,
      isComplete ? 1 : 0,
      // A complete request the automatic path may not act on now is looked at again in 24 hours; set until it acts.
      isComplete ? new Date(now.getTime() + REPORT_GUARDS.backstopHours * HOUR_MS).toISOString() : null,
      at,
      ceiling,
    )
    .run()
  if (inserted.meta.changes === 1) return { kind: "created", ticket, complete: isComplete }
  const stored = await db
    .prepare("SELECT id, outcome, body_hash FROM reports WHERE submit_key_hash = ?")
    .bind(keyHash)
    .first<{ id: string; outcome: string; body_hash: string }>()
  if (!stored || stored.body_hash !== bodyHash) return { kind: "mismatch" }
  return { kind: "replayed", ticket: stored.id, outcome: stored.outcome }
}

/**
 * The automatic path for one complete request: precautionary(r) at intake, backstop(r) at 24 hours (spec 6). The
 * spam signals are read first; the site-wide quotas, the per-place limit, the circuit breaker and the request still
 * being open are conditions of the place's own update, so requests at the same moment can't pass a quota together.
 * Recorded as automatic, and only if the ledger holds the intent: an automatic hide never happens unrecorded.
 * The hide is a precaution until a person decides, never a finding that the request is credible.
 */
export async function precaution(env: OpEnv, ticket: string, now: Date): Promise<"hidden" | "held_back"> {
  const db = env.db
  const report = await db.prepare("SELECT * FROM reports WHERE id = ?").bind(ticket).first<ReportRow>()
  if (!report || !report.complete || report.origin !== "contribution" || report.outcome !== "received" || report.status === "closed")
    return "held_back"
  const at = now.toISOString()
  const hourAgo = new Date(now.getTime() - HOUR_MS).toISOString()
  const dayAgo = new Date(now.getTime() - 24 * HOUR_MS).toISOString()
  const [duplicate, reporter] = await Promise.all([
    db
      .prepare("SELECT 1 FROM reports WHERE explanation_hash = ? AND id != ? AND received_at > ?")
      .bind(report.explanation_hash, ticket, dayAgo)
      .first(),
    report.reporter_key
      ? db
          .prepare("SELECT COUNT(*) AS n FROM reports WHERE reporter_key = ? AND received_at > ?")
          .bind(report.reporter_key, dayAgo)
          .first<number>("n")
      : 0,
  ])
  const explanation = await db.prepare("SELECT explanation FROM reports WHERE id = ?").bind(ticket).first<string>("explanation")
  if (isSpam({ duplicate: !!duplicate, links: linkCount(explanation ?? ""), reporterCount: reporter ?? 0 })) return "held_back"

  const place = await db
    .prepare(
      `SELECT p.rev, r.n, r.photo_key FROM places p JOIN revisions r ON r.id = p.published_revision_id WHERE p.id = ? AND p.status = 'published'`,
    )
    .bind(report.place_id)
    .first<{ rev: number; n: number; photo_key: string | null }>()
  if (!place) return "held_back"
  const elements = JSON.parse(report.elements) as Element[]
  const whole = elements.includes("whole")
  const photo = (whole || elements.includes("photo")) && place.photo_key?.startsWith("public/") ? [place.photo_key] : []
  const happened = "EXISTS (SELECT 1 FROM places WHERE id = ?1 AND last_transition_id = ?2)"
  const { outcome } = await runOp(
    env,
    {
      placeId: report.place_id,
      kind: "suppress",
      actor: "automatic",
      expectedRev: place.rev,
      removal: true,
      public: true,
      onIntentFailure: "refuse",
      detail: { fields: elements, report: ticket, toHeld: photo, media: photo },
      statements: (tid) => [
        db
          .prepare(
            `UPDATE places SET rev = rev + 1, last_transition_id = ?2,
               status = CASE WHEN ?4 = 1 THEN 'hidden' ELSE status END,
               status_changed_at = CASE WHEN ?4 = 1 THEN ?3 ELSE status_changed_at END
             WHERE id = ?1 AND rev = ?5 AND status = 'published'
               AND (SELECT COUNT(DISTINCT report_id) FROM field_suppressions WHERE kind = 'precautionary' AND created_at > ?6) < ?8
               AND (SELECT COUNT(DISTINCT report_id) FROM field_suppressions WHERE kind = 'precautionary' AND created_at > ?7) < ?9
               AND NOT EXISTS (SELECT 1 FROM field_suppressions WHERE place_id = ?1 AND kind = 'precautionary' AND created_at > ?7)
               AND (SELECT COUNT(*) FROM reports WHERE complete = 1 AND received_at > ?6) < ?10
               AND EXISTS (SELECT 1 FROM reports WHERE id = ?11 AND status != 'closed' AND outcome = 'received')`,
          )
          .bind(
            report.place_id,
            tid,
            at,
            whole ? 1 : 0,
            place.rev,
            hourAgo,
            dayAgo,
            REPORT_GUARDS.perHour,
            REPORT_GUARDS.perDay,
            REPORT_GUARDS.breakerPerHour,
            ticket,
          ),
        ...elements.map((field) =>
          db
            .prepare(
              `INSERT INTO field_suppressions (id, place_id, field, report_id, kind, revision_n, created_at, created_by)
               SELECT ?3, ?1, ?4, ?5, 'precautionary', ?6, ?7, 'automatic' WHERE ${happened}`,
            )
            .bind(report.place_id, tid, `s_${ulid(now.getTime())}`, field, ticket, place.n, at),
        ),
        db.prepare(`UPDATE feed_state SET n = n + 1, changed_at = ?3 WHERE id = 1 AND ${happened}`).bind(report.place_id, tid, at),
        db
          .prepare(`UPDATE reports SET outcome = 'hidden_for_review', backstop_at = NULL WHERE id = ?3 AND ${happened}`)
          .bind(report.place_id, tid, ticket),
        db
          .prepare(
            `INSERT INTO audit_log (id, at, actor, action, entity_id, fields) SELECT ?3, ?4, 'automatic', 'precautionary_hide', ?1, ?5 WHERE ${happened}`,
          )
          .bind(report.place_id, tid, `a_${ulid(now.getTime())}`, at, elements.join(",")),
      ],
    },
    now,
  )
  return outcome === "ok" ? "hidden" : "held_back"
}

/**
 * Tells every moderator about an open request: at once, then every `reminderHours` until one records handling it
 * (viewing is not handling). Each alert is claimed first, so two runs at the same moment send it once; if no mail
 * could go, the claim is given back and the next run tries again.
 */
export async function alertReport(
  db: D1Database,
  env: Env,
  send: (env: Env, mail: Mail) => Promise<boolean>,
  ticket: string,
  now: Date,
  origin: string,
): Promise<boolean> {
  const row = await db
    .prepare("SELECT alerted_at, alerts, outcome, origin, received_at FROM reports WHERE id = ? AND status = 'open'")
    .bind(ticket)
    .first<{ alerted_at: string | null; alerts: number; outcome: string; origin: string; received_at: string }>()
  if (!row) return false
  const due = !row.alerted_at || new Date(row.alerted_at).getTime() <= now.getTime() - REPORT_GUARDS.reminderHours * HOUR_MS
  if (!due) return false
  const at = now.toISOString()
  const claimed = await db
    .prepare("UPDATE reports SET alerted_at = ?2, alerts = alerts + 1 WHERE id = ?1 AND status = 'open' AND alerted_at IS ?3")
    .bind(ticket, at, row.alerted_at)
    .run()
  if (claimed.meta.changes !== 1) return false
  const moderators = env.MODERATORS.split(",")
    .map((e) => e.trim())
    .filter(Boolean)
  const reminder = row.alerts > 0
  const sent = await Promise.all(
    moderators.map((to) =>
      send(
        env,
        reportAlertMail(to, {
          link: `${origin}/admin/#reports`,
          hidden: row.outcome === "hidden_for_review",
          curated: row.origin === "curated",
          reminder,
          waitingHours: Math.floor((now.getTime() - new Date(row.received_at).getTime()) / HOUR_MS),
        }),
      ).catch(() => false),
    ),
  )
  if (sent.some(Boolean)) return true
  await db
    .prepare("UPDATE reports SET alerted_at = ?3, alerts = alerts - 1 WHERE id = ?1 AND alerted_at = ?2")
    .bind(ticket, at, row.alerted_at)
    .run()
  return false
}
