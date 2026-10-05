import { zValidator } from "@hono/zod-validator"
import { Hono, type Context } from "hono"
import { RevisionInput, SubmissionInput } from "@/shared/contract"
import { insertSubmission, pendingCount, revise, submissionKnown, submissionStatus, withdraw } from "../db/places"
import { clock } from "../lib/clock"
import { PRIVATE, problem } from "../lib/http"
import { checkTurnstile } from "../lib/turnstile"
import type { AppEnv } from "../index"

export const submissions = new Hono<AppEnv>()

// One key per place, made by the browser before its first try; 128 random bits in base64url, or a hex UUID.
const KEY = /^[A-Za-z0-9_-]{22,64}$/

/**
 * What a new submission or a correction passes before it is stored: room in the review queue, the coarse per-address
 * cap, and a browser check for this action. The address is passed through to Cloudflare and never stored or logged.
 * A refusal is 403; anything the sender can't help (a full queue, a busy check) is 429 or 503, which the browser retries.
 */
async function guard(c: Context<AppEnv>, action: "submit" | "revise", queue: boolean): Promise<Response | null> {
  if (queue && (await pendingCount(c.env.DB)) >= Number(c.env.QUEUE_LIMIT ?? 200))
    return problem(c, 503, "queue_full", {}, { "Retry-After": "3600" })
  const address = c.req.header("CF-Connecting-IP")
  if (address && !(await c.env.SUBMIT_LIMIT.limit({ key: address })).success)
    return problem(c, 429, "rate_limited", {}, { "Retry-After": "60" })
  const outcome = await checkTurnstile(c.env, c.get("verifyTurnstile"), c.req.header("Turnstile-Token"), action, address)
  if (outcome === "required") return problem(c, 403, "turnstile_required")
  if (outcome === "failed") return problem(c, 403, "turnstile_failed")
  if (outcome === "unavailable") return problem(c, 503, "turnstile_unavailable", {}, { "Retry-After": "30" })
  return null
}

submissions.post(
  "/",
  zValidator("json", SubmissionInput, (r, c) => (r.success ? undefined : problem(c, 400, "invalid_input"))),
  async (c) => {
    const key = c.req.header("Idempotency-Key") ?? ""
    if (!KEY.test(key)) return problem(c, 400, "idempotency_key_required")
    // The same submission sent again (its answer was lost) was checked on its first try; Turnstile tokens are single-use.
    if (!(await submissionKnown(c.env.DB, key))) {
      const refused = await guard(c, "submit", true)
      if (refused) return refused
    }
    const r = await insertSubmission(c.env.DB, c.req.valid("json"), key, clock(c.req.raw, c.env))
    if (r.kind === "mismatch") return problem(c, 409, "idempotency_key_reused")
    // 200 for the same submission sent again, so the browser can tell, though it treats both alike.
    return c.json({ id: r.id, trackingToken: r.trackingToken }, r.kind === "created" ? 201 : 200, PRIVATE)
  },
)

const bearer = (header: string | undefined) => /^Bearer (.+)$/.exec(header ?? "")?.[1]

submissions.get("/:id", async (c) => {
  const token = bearer(c.req.header("Authorization"))
  // An unknown id and a wrong token look the same, so the endpoint reveals nothing about which ids exist.
  const status = token ? await submissionStatus(c.env.DB, c.req.param("id"), token) : null
  return status ? c.json(status, 200, PRIVATE) : problem(c, 404, "not_found")
})

submissions.post("/:id/withdraw", async (c) => {
  const token = bearer(c.req.header("Authorization"))
  const done = token ? await withdraw(c.env.DB, c.req.param("id"), token, clock(c.req.raw, c.env)) : false
  return done ? c.json({ status: "withdrawn" }, 200, PRIVATE) : problem(c, 404, "not_found")
})

submissions.post(
  "/:id/revisions",
  zValidator("json", RevisionInput, (r, c) => (r.success ? undefined : problem(c, 400, "invalid_input"))),
  async (c) => {
    const token = bearer(c.req.header("Authorization"))
    if (!token) return problem(c, 404, "not_found")
    const refused = await guard(c, "revise", false)
    if (refused) return refused
    const { expectedRev, ...r } = c.req.valid("json")
    const result = token ? await revise(c.env.DB, c.req.param("id"), token, r, expectedRev, clock(c.req.raw, c.env)) : "not_found"
    if (result === "not_found") return problem(c, 404, "not_found")
    return result === "ok" ? c.json({ ok: true }, 200, PRIVATE) : problem(c, 409, "changed_meanwhile")
  },
)
