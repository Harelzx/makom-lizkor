import { RETENTION } from "@/config"
import { resumeOps } from "./db/ops"
import { alertReport, precaution } from "./db/reports"
import type { SendMail } from "./lib/mail"
import { REPORT_GUARDS } from "./lib/guards"
import type { Purge } from "./lib/purge"

const HOUR_MS = 3600 * 1000

/**
 * The scheduled pass (every 15 minutes in production; /__dev/cron locally), each part safe to run twice at once:
 * - operations left unfinished are finished, or refused as interrupted (resumeOps);
 * - the 24-hour backstop (spec 6) looks once at each complete request the automatic path held back, with every
 *   safeguard checked again at the moment it runs, and then leaves the request to people;
 * - moderators are reminded every 6 hours of each open request until one records handling it;
 * - the two abuse codes (keyed hashes of the reporter's address and of the explanation) are cleared
 *   RETENTION.reportAbuseCodeHours after the request, once the backstop has had its look: they exist only for the
 *   day's counts. The notice promises them gone within reportAbuseCodeMaxHours, which leaves room for late runs.
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
    const { results } = await env.DB.prepare(
      "SELECT id FROM reports WHERE backstop_at IS NOT NULL AND backstop_at <= ? ORDER BY backstop_at LIMIT 50",
    )
      .bind(at)
      .all<{ id: string }>()
    for (const { id } of results) {
      // Claimed first, so two runs at the same moment look once; precaution() itself skips a closed request.
      const claimed = await env.DB.prepare("UPDATE reports SET backstop_at = NULL WHERE id = ? AND backstop_at IS NOT NULL").bind(id).run()
      if (claimed.meta.changes === 1) await precaution(opEnv, id, now)
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
    for (const { id } of results) await alertReport(env.DB, env, deps.sendMail, id, now, origin)
  })

  await part("abuse_codes", () =>
    env.DB.prepare(
      `UPDATE reports SET reporter_key = NULL, explanation_hash = NULL
       WHERE received_at <= ? AND backstop_at IS NULL AND (reporter_key IS NOT NULL OR explanation_hash IS NOT NULL)`,
    )
      .bind(new Date(now.getTime() - RETENTION.reportAbuseCodeHours * HOUR_MS).toISOString())
      .run(),
  )
}
