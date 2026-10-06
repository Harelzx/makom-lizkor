import { zValidator } from "@hono/zod-validator"
import { Hono, type Context } from "hono"
import { ReportInput, type ReportResult } from "@/shared/contract"
import { deliverAlerts, insertReport, precaution, replayReport, startAlertRound, type Target } from "../db/reports"
import { clock } from "../lib/clock"
import { curatedPlace } from "../lib/curated"
import { PRIVATE, problem } from "../lib/http"
import { rateKey } from "../lib/ids"
import { opEnv } from "../lib/purge"
import { checkTurnstile } from "../lib/turnstile"
import type { AppEnv } from "../index"

export const reports = new Hono<AppEnv>()

// As for submissions: one key per request, made by the browser before its first try.
const KEY = /^[A-Za-z0-9_-]{22,64}$/

/** The coarse per-address cap, under a keyed hash of the address; the address itself is never stored or logged. */
async function overLimit(c: Context<AppEnv>, key: string | null): Promise<Response | null> {
  if (key && !(await c.env.REPORT_LIMIT.limit({ key })).success) return problem(c, 429, "rate_limited", {}, { "Retry-After": "60" })
  return null
}

/** The place a request names: a published or hidden contribution, or one of the site's own places (curated, until phase 7). */
async function targetOf(db: D1Database, placeId: string): Promise<Target | null> {
  if (placeId.startsWith("p_")) {
    const status = await db.prepare("SELECT status FROM places WHERE id = ?").bind(placeId).first<string>("status")
    // A place hidden whole can still be asked about (another element, or by someone else): a person reviews it, and the
    // automatic path never acts on it.
    if (status === "hidden") return { origin: "contribution", published: false }
    return status === "published" ? { origin: "contribution", published: true } : null
  }
  return curatedPlace(placeId).kind === "published" ? { origin: "curated", published: true } : null
}

/**
 * A request to remove or correct something (spec 6, 10). Every one accepted is reviewed urgently by a person, as the
 * notice promises; a complete one on a published contribution may also be hidden at once as a precaution, within the
 * safeguards. The answer says which, and never that the request was found credible.
 */
reports.post(
  "/",
  zValidator("json", ReportInput, (r, c) => (r.success ? undefined : problem(c, 400, "invalid_input"))),
  async (c) => {
    const key = c.req.header("Idempotency-Key") ?? ""
    if (!KEY.test(key)) return problem(c, 400, "invalid_input")
    if (!c.env.TRACKING_SECRET) return problem(c, 503, "not_configured")
    const input = c.req.valid("json")
    const address = c.req.header("CF-Connecting-IP")
    const visitor = address ? await rateKey(c.env.TRACKING_SECRET, address) : null
    // A retry under a known key skips the browser check (its token was single-use) but still counts against the cap.
    const limited = await overLimit(c, visitor)
    if (limited) return limited
    // A retry under a known key is answered from what is stored, before the place is looked at: the place may have
    // been withdrawn or hidden since, and the request was accepted. The same key with another body is refused.
    const replay = await replayReport(c.env.DB, input, key, c.env.TRACKING_SECRET)
    if (replay === "mismatch") return problem(c, 409, "idempotency_key_reused")
    if (replay) return c.json<ReportResult>(replay, 202, PRIVATE)
    {
      const outcome = await checkTurnstile(c.env, c.get("verifyTurnstile"), c.req.header("Turnstile-Token"), "report", address)
      if (outcome === "required") return problem(c, 403, "turnstile_required")
      if (outcome === "failed") return problem(c, 403, "turnstile_failed")
      if (outcome === "unavailable") return problem(c, 503, "turnstile_unavailable", {}, { "Retry-After": "30" })
    }
    const target = await targetOf(c.env.DB, input.placeId)
    if (!target) return problem(c, 404, "not_found")
    const now = clock(c.req.raw, c.env)
    const stored = await insertReport(c.env.DB, input, target, key, c.env.TRACKING_SECRET, visitor, now)
    if (stored.kind === "mismatch") return problem(c, 409, "idempotency_key_reused")
    if (stored.kind === "replayed")
      return c.json<ReportResult>({ ticket: stored.ticket, outcome: stored.outcome as ReportResult["outcome"] }, 202, PRIVATE)
    const hidden = stored.complete ? (await precaution(opEnv(c), stored.ticket, now)) === "hidden" : false
    // The alert never holds up the answer: a delivery that can't go now is retried by the scheduled job.
    const origin = c.env.ENVIRONMENT === "development" ? new URL(c.req.url).origin : c.env.PUBLIC_ORIGIN || ""
    try {
      await startAlertRound(c.env.DB, c.env, stored.ticket, now)
      await deliverAlerts(c.env.DB, c.env, c.get("sendMail"), now, origin, stored.ticket)
    } catch (err) {
      console.error(JSON.stringify({ level: "error", event: "report_alert", error: (err as Error).name }))
    }
    return c.json<ReportResult>({ ticket: stored.ticket, outcome: hidden ? "hidden_for_review" : "received" }, 202, PRIVATE)
  },
)
