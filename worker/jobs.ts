import { RETENTION } from "@/config"
import { resumeOps } from "./db/ops"
import { deliverAlerts, precaution, startAlertRound } from "./db/reports"
import type { SendMail } from "./lib/mail"
import { REPORT_GUARDS } from "./lib/guards"
import type { Purge } from "./lib/purge"

const HOUR_MS = 3600 * 1000
/** A backstop claimed this long ago by a run that never finished it is taken again. */
const BACKSTOP_CLAIM_MS = 10 * 60_000

/**
 * The scheduled pass (every 15 minutes in production; /__dev/cron locally), each part safe to run twice at once:
 * - operations left unfinished are finished, or refused as interrupted (resumeOps);
 * - the 24-hour backstop (spec 6) looks once at each complete request the automatic path held back, with every
 *   safeguard checked again at the moment it runs, and then leaves the request to people; a look that couldn't
 *   finish (a run that stopped, the ledger refusing) is taken again;
 * - moderators are reminded every 6 hours of each open request until one records handling it, each delivery
 *   claimed and retried on its own;
 * - the two abuse codes (keyed hashes of the reporter's address and of the explanation) are cleared
 *   RETENTION.reportAbuseCodeHours after the request, once the backstop has had its look: they exist only for the
 *   day's counts. The notice promises them gone within reportAbuseCodeMaxHours, so half an hour before that they are
 *   cleared whatever the backstop got through (a flood larger than one run takes, or a backstop that keeps failing).
 *   Nothing else is cleared here: the request, and its replay detection, stay to the request's own deletion date.
 * A part that fails is logged by name and never stops the others.
 */
export async function runJobs(env: Env, deps: { sendMail: SendMail; purge: Purge }, ctx: unknown, now: Date) {
  const opEnv = { db: env.DB, media: env.MEDIA, ledger: env.LEDGER, purge: (tags: string[]) => deps.purge(env, ctx, tags) }
  const at = now.toISOString()
  const part = async (name: string, run: () => Promise<unknown>) => {
    try {
      await run()
    } catch (err) {
      console.error(JSON.stringify({ level: "error", event: "job_failed", job: name, error: (err as Error).name }))
    }
  }

  await part("resume_ops", () => resumeOps(opEnv, now))

  await part("backstop", async () => {
    const stale = new Date(now.getTime() - BACKSTOP_CLAIM_MS).toISOString()
    const { results } = await env.DB.prepare(
      `SELECT id FROM reports WHERE backstop_at IS NOT NULL AND backstop_at <= ?1
         AND (backstop_claimed_at IS NULL OR backstop_claimed_at <= ?2) ORDER BY backstop_at LIMIT 50`,
    )
      .bind(at, stale)
      .all<{ id: string }>()
    for (const { id } of results) {
      // Claimed, so two runs at the same moment look once; a run that stops leaves a claim that goes stale.
      const claimed = await env.DB.prepare(
        "UPDATE reports SET backstop_claimed_at = ?2 WHERE id = ?1 AND backstop_at IS NOT NULL AND (backstop_claimed_at IS NULL OR backstop_claimed_at <= ?3)",
      )
        .bind(id, at, stale)
        .run()
      if (claimed.meta.changes !== 1) continue
      const result = await precaution(opEnv, id, now).catch(() => "retry" as const)
      // A finished evaluation (hidden or refused) is the backstop's one look; one that couldn't finish is taken again.
      await env.DB.prepare(
        result === "retry"
          ? "UPDATE reports SET backstop_claimed_at = NULL WHERE id = ?"
          : "UPDATE reports SET backstop_at = NULL, backstop_claimed_at = NULL WHERE id = ?",
      )
        .bind(id)
        .run()
    }
  })

  await part("alerts", async () => {
    const origin = env.PUBLIC_ORIGIN || ""
    const due = new Date(now.getTime() - REPORT_GUARDS.reminderHours * HOUR_MS).toISOString()
    const { results } = await env.DB.prepare(
      "SELECT id FROM reports WHERE status = 'open' AND (alerted_at IS NULL OR alerted_at <= ?) ORDER BY received_at LIMIT 50",
    )
      .bind(due)
      .all<{ id: string }>()
    for (const { id } of results) await startAlertRound(env.DB, env, id, now)
    await deliverAlerts(env.DB, env, deps.sendMail, now, origin)
  })

  // Last, and on its own: it runs even if every part before it failed.
  await part("abuse_codes", () =>
    env.DB.prepare(
      `UPDATE reports SET reporter_key = NULL, explanation_hash = NULL
       WHERE (reporter_key IS NOT NULL OR explanation_hash IS NOT NULL)
         AND ((received_at <= ?1 AND backstop_at IS NULL) OR received_at <= ?2)`,
    )
      .bind(
        new Date(now.getTime() - RETENTION.reportAbuseCodeHours * HOUR_MS).toISOString(),
        // The ceiling, whatever the backstop got through: the notice's hours, less half an hour for a late run.
        new Date(now.getTime() - (RETENTION.reportAbuseCodeMaxHours - 0.5) * HOUR_MS).toISOString(),
      )
      .run(),
  )
}
