import type { Element, ReportInput } from "@/shared/contract"
import { RETENTION } from "@/config"
import { REPORT_GUARDS, complete, isSpam, linkCount, normalizeExplanation } from "../lib/guards"
import { sha256Hex, ulid } from "../lib/ids"
import type { Mail } from "../lib/mail"
import { reportAlertMail } from "../lib/messages"
import { runOp, type OpEnv } from "./ops"
import { hmacHex } from "./places"

// An approximation of a month, as for contacts; phase 5 reads calendar months from RETENTION (src/config.ts).
const MONTH_MS = 30 * 24 * 3600 * 1000
const HOUR_MS = 3600 * 1000

/** The latest a hide's notes may be kept: 12 months from now (the same month as the requests', until phase 5). */
export const notesCeiling = (now: Date) => new Date(now.getTime() + 12 * MONTH_MS).toISOString()

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

/**
 * A retry under a key already used: the stored ticket and outcome when the body is the same, "mismatch" when it isn't,
 * null for a new key. Answered before anything about the place is checked, and without the browser check (its token
 * was single-use and the first try passed it).
 */
export async function replayReport(db: D1Database, input: ReportInput, key: string, secret: string) {
  const stored = await db
    .prepare("SELECT id, outcome, body_hash FROM reports WHERE submit_key_hash = ?")
    .bind(await sha256Hex(key))
    .first<{ id: string; outcome: "hidden_for_review" | "received"; body_hash: string }>()
  if (!stored) return null
  if (stored.body_hash !== (await hmacHex(secret, `report:${JSON.stringify(input)}`))) return "mismatch" as const
  return { ticket: stored.id, outcome: stored.outcome }
}

/**
 * Stores a request once per key. A retry with the same body gets the stored ticket and outcome and creates nothing; the
 * same key with a different body is refused. Everything the requester wrote, and their address, is kept to the earlier
 * of 12 months or 90 days after the case closes (spec 7). The two abuse codes (keyed hashes of the address and of the
 * explanation) are cleared much sooner, after RETENTION.reportAbuseCodeHours, by the scheduled job (worker/jobs.ts);
 * the body and key hashes, which recognise a retry, stay with the request.
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
/**
 * safe(r, t) from spec 6, as SQL over the database at this moment: the site-wide quotas, the per-place limit, the
 * circuit breaker, the request still open, its abuse codes still there, no copy of its explanation in the past day and
 * its reporter under the day's count. Numbered parameters: ?1 place, ?6 an hour ago, ?7 a day ago, ?8 per hour, ?9 per
 * day, ?10 breaker, ?11 the request, ?12 reporter's day, ?13 the oldest request whose abuse codes still count (they
 * expire with RETENTION.reportAbuseCodeMaxHours, less the half hour the job keeps in hand), ?14 the backstop run's
 * claim (null at intake). The request must still be awaiting its evaluation (backstop_at set, and claimed by this run
 * when a run is evaluating it), so a run whose claim went stale can't hide after another finished. Read once before
 * anything is written, and again as conditions of the place's own update, so nothing that changes in between (the
 * clock included, while the ledger is written) can let a hide through.
 */
const SAFE = `(SELECT COUNT(DISTINCT report_id) FROM field_suppressions WHERE kind = 'precautionary' AND created_at > ?6) < ?8
  AND (SELECT COUNT(DISTINCT report_id) FROM field_suppressions WHERE kind = 'precautionary' AND created_at > ?7) < ?9
  AND NOT EXISTS (SELECT 1 FROM field_suppressions WHERE place_id = ?1 AND kind = 'precautionary' AND created_at > ?7)
  AND (SELECT COUNT(*) FROM reports WHERE complete = 1 AND received_at > ?6) < ?10
  AND EXISTS (SELECT 1 FROM reports WHERE id = ?11 AND status != 'closed' AND outcome = 'received' AND explanation_hash IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM reports o JOIN reports me ON me.id = ?11
                  WHERE o.explanation_hash = me.explanation_hash AND o.id != me.id AND o.received_at > ?7)
  AND (SELECT COUNT(*) FROM reports o JOIN reports me ON me.id = ?11
       WHERE me.reporter_key IS NOT NULL AND o.reporter_key = me.reporter_key AND o.received_at > ?7) <= ?12
  AND (SELECT received_at FROM reports WHERE id = ?11) > ?13
  AND EXISTS (SELECT 1 FROM reports WHERE id = ?11 AND backstop_at IS NOT NULL AND (?14 IS NULL OR backstop_claim = ?14))`

/**
 * hidden: done. refused: a finished evaluation said no (a safeguard, spam, the request closed or its codes gone).
 * retry: the evaluation couldn't finish (the ledger refused the intent, or another decision moved the place first while
 * the safeguards still allow it), so the backstop takes it again at its next run.
 */
export type Precaution = "hidden" | "refused" | "retry"

export async function precaution(
  env: OpEnv,
  ticket: string,
  now: Date,
  /** The backstop run's claim, and the clock read again at the update (the ledger may take a while). */
  opts: { claim?: string; clock?: () => Date } = {},
): Promise<Precaution> {
  const clockNow = opts.clock ?? (() => new Date(Math.max(now.getTime(), Date.now())))
  const evidenceSince = (t: Date) => new Date(t.getTime() - (RETENTION.reportAbuseCodeMaxHours - 0.5) * HOUR_MS).toISOString()
  const db = env.db
  const report = await db.prepare("SELECT * FROM reports WHERE id = ?").bind(ticket).first<ReportRow>()
  if (!report || !report.complete || report.origin !== "contribution" || report.outcome !== "received" || report.status === "closed")
    return "refused"
  // Without its abuse codes (cleared by their ceiling before a late backstop got to it) a request can't be checked
  // for spam, so the automatic path doesn't act on it: a person reviews it, as every request.
  if (!report.explanation_hash) return "refused"
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
  if (isSpam({ duplicate: !!duplicate, links: linkCount(explanation ?? ""), reporterCount: reporter ?? 0 })) return "refused"

  const place = await db
    .prepare(
      `SELECT p.rev, r.n, r.photo_key FROM places p JOIN revisions r ON r.id = p.published_revision_id WHERE p.id = ? AND p.status = 'published'`,
    )
    .bind(report.place_id)
    .first<{ rev: number; n: number; photo_key: string | null }>()
  if (!place) return "refused"
  // The safeguards read first, so a routine refusal writes nothing to the ledger; the same conditions are checked
  // again inside the place's own update.
  const binds = (tid: string, t: Date) => [
    report.place_id,
    tid,
    at,
    0,
    place.rev,
    hourAgo,
    dayAgo,
    REPORT_GUARDS.perHour,
    REPORT_GUARDS.perDay,
    REPORT_GUARDS.breakerPerHour,
    ticket,
    REPORT_GUARDS.reporterPerDay,
    evidenceSince(t),
    opts.claim ?? null,
  ]
  const safeNow = async () =>
    !!(await db
      .prepare(`SELECT ${SAFE} AS safe`)
      .bind(...binds("", clockNow()))
      .first<number>("safe"))
  if (!(await safeNow())) return "refused"
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
             WHERE id = ?1 AND rev = ?5 AND status = 'published' AND ${SAFE}`,
          )
          .bind(...binds(tid, clockNow()).map((v, i) => (i === 3 ? (whole ? 1 : 0) : v))),
        ...elements.map((field) =>
          db
            .prepare(
              `INSERT INTO field_suppressions (id, place_id, field, report_id, kind, revision_n, created_at, created_by, notes_ceiling_at,
                 notes_purge_after)
               SELECT ?3, ?1, ?4, ?5, 'precautionary', ?6, ?7, 'automatic', ?8, MIN(?8, (SELECT purge_after FROM reports WHERE id = ?5))
               WHERE ${happened}`,
            )
            .bind(report.place_id, tid, `s_${ulid(now.getTime())}`, field, ticket, place.n, at, notesCeiling(now)),
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
  if (outcome === "ok") return "hidden"
  if (outcome === "ledger_unwritten") return "retry"
  // Lost its update: a safeguard closed meanwhile (a finished refusal), or another decision moved the place first.
  return (await safeNow()) ? "retry" : "refused"
}

/** A delivery claimed this long ago by a run that never finished it is taken again. */
const CLAIM_STALE_MS = 2 * 60_000
/** A delivery that keeps failing is tried this many times; the next round (every reminderHours) starts afresh. */
const DELIVERY_TRIES = 5

/**
 * Opens an alert round for an open request when one is due: at once, then every `reminderHours` until a moderator
 * records handling it (viewing is not handling). The round is claimed on the request itself, so two runs at the same
 * moment open it once; it then holds one delivery per moderator.
 */
export async function startAlertRound(db: D1Database, env: Env, ticket: string, now: Date): Promise<boolean> {
  const at = now.toISOString()
  const due = new Date(now.getTime() - REPORT_GUARDS.reminderHours * HOUR_MS).toISOString()
  const moderators = [
    ...new Set(
      env.MODERATORS.split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  ]
  // One batch: the round and its deliveries exist together or not at all, so a crash can't open a round that sends
  // nothing for six hours. A second run at the same moment finds the round already open and adds nothing new.
  const [opened] = await db.batch([
    db
      .prepare(
        "UPDATE reports SET alerts = alerts + 1, alerted_at = ?2 WHERE id = ?1 AND status = 'open' AND (alerted_at IS NULL OR alerted_at <= ?3)",
      )
      .bind(ticket, at, due),
    ...moderators.map((to) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO report_alerts (report_id, round, recipient, state)
           SELECT id, alerts, ?3, 'pending' FROM reports WHERE id = ?1 AND alerted_at = ?2 AND status = 'open'`,
        )
        .bind(ticket, at, to),
    ),
  ])
  return opened.meta.changes === 1
}

/**
 * Sends the deliveries that are due (all of them, or one request's): each claimed first, so a run that stopped
 * mid-send leaves it to be taken again once the claim is stale; marked sent when the provider took it, so a moderator
 * who got it isn't sent it again; a failure is retried at the next run. A request no longer open sends nothing more.
 * An ambiguous send (the run stopped after the provider took the mail) may go twice: mail is never exactly once.
 * The mail carries a link to the queue and what the automatic path did, nothing of the request.
 */
export async function deliverAlerts(
  db: D1Database,
  env: Env,
  send: (env: Env, mail: Mail) => Promise<boolean>,
  now: Date,
  origin: string,
  ticket?: string,
) {
  const stale = new Date(now.getTime() - CLAIM_STALE_MS).toISOString()
  const { results } = await db
    .prepare(
      `SELECT a.report_id, a.round, a.recipient, rep.outcome, rep.origin, rep.received_at
       FROM report_alerts a JOIN reports rep ON rep.id = a.report_id
       WHERE rep.status = 'open' AND a.state IN ('pending', 'failed') AND a.tries < ?1 AND (a.claimed_at IS NULL OR a.claimed_at <= ?2)
         AND (?3 IS NULL OR a.report_id = ?3)
       ORDER BY a.report_id, a.round LIMIT 200`,
    )
    .bind(DELIVERY_TRIES, stale, ticket ?? null)
    .all<{ report_id: string; round: number; recipient: string; outcome: string; origin: string; received_at: string }>()
  for (const d of results) {
    const key = [d.report_id, d.round, d.recipient] as const
    const claim = crypto.randomUUID()
    // Claimed only while it is still due: unsent, under its tries, and its request still open.
    const claimed = await db
      .prepare(
        `UPDATE report_alerts SET claimed_at = ?4, claim = ?6, tries = tries + 1
         WHERE report_id = ?1 AND round = ?2 AND recipient = ?3 AND state IN ('pending', 'failed') AND tries < ?7
           AND (claimed_at IS NULL OR claimed_at <= ?5) AND EXISTS (SELECT 1 FROM reports WHERE id = ?1 AND status = 'open')`,
      )
      .bind(...key, now.toISOString(), stale, claim, DELIVERY_TRIES)
      .run()
    if (claimed.meta.changes !== 1) continue
    const ok = await send(
      env,
      reportAlertMail(d.recipient, {
        link: `${origin}/admin/#reports`,
        hidden: d.outcome === "hidden_for_review",
        curated: d.origin === "curated",
        reminder: d.round > 1,
        waitingHours: Math.floor((now.getTime() - new Date(d.received_at).getTime()) / HOUR_MS),
      }),
    ).catch(() => false)
    await completeDelivery(db, key, claim, ok, now)
  }
}

/** Records one send's result, only while that send still holds the claim: a late failure never undoes a delivery. */
export async function completeDelivery(db: D1Database, key: readonly [string, number, string], claim: string, ok: boolean, now: Date) {
  await db
    .prepare(
      ok
        ? "UPDATE report_alerts SET state = 'sent', sent_at = ?5, claim = NULL WHERE report_id = ?1 AND round = ?2 AND recipient = ?3 AND claim = ?4"
        : "UPDATE report_alerts SET state = 'failed', claimed_at = NULL, claim = NULL WHERE report_id = ?1 AND round = ?2 AND recipient = ?3 AND claim = ?4 AND ?5 IS NOT NULL",
    )
    .bind(...key, claim, now.toISOString())
    .run()
}
