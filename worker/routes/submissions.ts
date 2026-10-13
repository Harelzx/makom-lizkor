import { durations } from "../lib/durations"
import { zValidator } from "@hono/zod-validator"
import { Hono, type Context } from "hono"
import { z } from "zod"
import { RevisionInput, SubmissionInput, text } from "@/shared/contract"
import { erasePhotos, photosRemain } from "../db/photos"
import {
  attachPhoto,
  canTrack,
  insertSubmission,
  trackingTokenFor,
  pendingCount,
  revise,
  submissionKnown,
  submissionStatus,
  withdraw,
} from "../db/places"
import { clock } from "../lib/clock"
import { PRIVATE, problem } from "../lib/http"
import { opEnv } from "../lib/purge"
import { boundedBody, PHOTO_REQUEST_BYTES, PUBLIC_JSON_BYTES, requestCap } from "../lib/request-guard"
import { deliverVerification } from "../db/verification-delivery"
import { checkTurnstile } from "../lib/turnstile"
import type { AppEnv } from "../index"
import { log } from "../lib/log"

export const submissions = new Hono<AppEnv>()

// One key per place, made by the browser before its first try; 128 random bits in base64url, or a hex UUID.
const KEY = /^[A-Za-z0-9_-]{22,64}$/

/**
 * What a new submission or a correction passes before it is stored: room in the review queue, the coarse per-address
 * cap, and a browser check for this action. The address is passed through to Cloudflare and never stored or logged.
 * A refusal is 403; anything the sender can't help (a full queue, a busy check) is 429 or 503, which the browser retries.
 */
const queueLimit = (c: Context<AppEnv>) => Number(c.env.QUEUE_LIMIT ?? 200)
const queueFull = (c: Context<AppEnv>) => problem(c, 503, "queue_full", {}, { "Retry-After": "3600" })

/**
 * A full queue refuses a new submission before Turnstile is spent; the insert checks again, since requests at once all
 * pass this. A correction is checked only in its own update, so a stale one is told it's stale, full queue or not.
 */
async function guard(c: Context<AppEnv>, action: "submit" | "revise"): Promise<Response | null> {
  if (action === "submit" && (await pendingCount(c.env.DB)) >= queueLimit(c)) return queueFull(c)
  const address = c.req.header("CF-Connecting-IP")
  const outcome = await checkTurnstile(c.env, c.get("verifyTurnstile"), c.req.header("Turnstile-Token"), action, address)
  if (outcome === "required") return problem(c, 403, "turnstile_required")
  if (outcome === "failed") return problem(c, 403, "turnstile_failed")
  if (outcome === "unavailable") return problem(c, 503, "turnstile_unavailable", {}, { "Retry-After": "30" })
  return null
}

submissions.post(
  "/",
  requestCap("SUBMIT_LIMIT"),
  boundedBody(PUBLIC_JSON_BYTES),
  zValidator("json", SubmissionInput, (r, c) => (r.success ? undefined : problem(c, 400, "invalid_input"))),
  async (c) => {
    const key = c.req.header("Idempotency-Key") ?? ""
    if (!KEY.test(key)) return problem(c, 400, "idempotency_key_required")
    // Without the server's secret there is no tracking token to give, nor a way to count an address without keeping
    // it: refuse rather than hand out a weak one.
    if (!c.env.TRACKING_SECRET) return problem(c, 503, "not_configured")
    // The same submission sent again (its answer was lost) was checked on its first try, and Turnstile tokens are
    // single-use, so it skips the check; it still counts against the address's cap like any request.
    const refused = (await submissionKnown(c.env.DB, key)) ? null : await guard(c, "submit")
    if (refused) return refused
    const token = await trackingTokenFor(c.env.TRACKING_SECRET, key)
    const r = await insertSubmission(
      c.env.DB,
      c.req.valid("json"),
      key,
      token,
      clock(c.req.raw, c.env),
      queueLimit(c),
      c.env.TRACKING_SECRET,
      durations(c.env),
    )
    if (r.kind === "mismatch") return problem(c, 409, "idempotency_key_reused")
    if (r.kind === "queue_full") return queueFull(c)
    // 200 for the same submission sent again, so the browser can tell, though it treats both alike.
    // An address was given: the verification mail goes first, and says nothing about the place.
    if (c.req.valid("json").email) {
      const env = c.env.ENVIRONMENT === "development" ? { ...c.env, PUBLIC_ORIGIN: new URL(c.req.url).origin } : c.env
      const delivery = deliverVerification(env, c.get("mailAttempt")!, clock(c.req.raw, c.env), r.id).catch((err: Error) =>
        log("error", "verification_delivery_failed", { error: err.name }),
      )
      // Production receipt never waits for Gmail. Development stays deterministic for local fixtures.
      if (c.env.ENVIRONMENT === "development") await delivery
      else c.executionCtx.waitUntil(delivery)
    }
    return c.json({ id: r.id, trackingToken: r.trackingToken }, r.kind === "created" ? 201 : 200, PRIVATE)
  },
)

const bearer = (header: string | undefined) => /^Bearer (.+)$/.exec(header ?? "")?.[1]

submissions.get("/:id", async (c) => {
  const token = bearer(c.req.header("Authorization"))
  // An unknown id and a wrong token look the same, so the endpoint reveals nothing about which ids exist.
  const status = token ? await submissionStatus(c.env.DB, c.req.param("id"), token) : null
  if (!status) return problem(c, 404, "not_found")
  // A withdrawal whose files couldn't all be erased yet says so (they are no longer served), on every later visit.
  const pending = status.status === "withdrawn" && (await photosRemain(c.env.MEDIA, c.req.param("id")))
  return c.json(pending ? { ...status, files: "pending" } : status, 200, PRIVATE)
})

submissions.post("/:id/withdraw", requestCap("SUBMIT_LIMIT", "withdraw:"), boundedBody(0), async (c) => {
  const token = bearer(c.req.header("Authorization"))
  const done = token ? await withdraw(opEnv(c), c.req.param("id"), token, clock(c.req.raw, c.env)) : "missing"
  if (done === "missing") return problem(c, 404, "not_found")
  // The link is good but the place kept changing: nothing was withdrawn yet, and the same request again will do it.
  if (done === "busy") return problem(c, 503, "withdrawal_busy", {}, { "Retry-After": "1" })
  // The withdrawal stands once stored. Files that can't be erased now are already unreachable (only published photos
  // are served); the answer says so, and the same request again (or the sweep) finishes them.
  const erased = await erasePhotos(c.env.MEDIA, c.req.param("id")).then(
    () => true,
    (err: Error) => (log("error", "withdraw_files", { error: err.name }), false),
  )
  return c.json(erased ? { status: "withdrawn" } : { status: "withdrawn", files: "pending" }, 200, PRIVATE)
})

submissions.post(
  "/:id/revisions",
  requestCap("SUBMIT_LIMIT"),
  boundedBody(PUBLIC_JSON_BYTES),
  zValidator("json", RevisionInput, (r, c) => (r.success ? undefined : problem(c, 400, "invalid_input"))),
  async (c) => {
    const token = bearer(c.req.header("Authorization"))
    if (!token) return problem(c, 404, "not_found")
    if (!c.env.TRACKING_SECRET) return problem(c, 503, "not_configured")
    const refused = await guard(c, "revise")
    if (refused) return refused
    const { expectedRev, ...r } = c.req.valid("json")
    const result = await revise(c.env.DB, c.req.param("id"), token, r, expectedRev, clock(c.req.raw, c.env), queueLimit(c))
    if (result === "not_found") return problem(c, 404, "not_found")
    if (result === "queue_full") return queueFull(c)
    return result === "ok" ? c.json({ ok: true }, 200, PRIVATE) : problem(c, 409, "changed_meanwhile")
  },
)

const PhotoFields = z.object({ alt: text({ max: 140 }), credit: text({ max: 60 }).optional() })

/** The photo for the sender's open revision, after the submission itself: a second request, so the submission's retry stays exact. */
submissions.put(
  "/:id/photo",
  requestCap("SUBMIT_LIMIT", "photo:"),
  async (c, next) => {
    const token = bearer(c.req.header("Authorization"))
    // The token first, then the declared size, and only then the body: nothing large is read for a stranger.
    if (!token || !(await canTrack(c.env.DB, c.req.param("id"), token))) return problem(c, 404, "not_found")
    const length = Number(c.req.header("Content-Length"))
    if (!c.req.header("Content-Length") || !Number.isFinite(length)) return problem(c, 411, "length_required")
    if (length > PHOTO_REQUEST_BYTES) return problem(c, 413, "too_large")
    await next()
  },
  boundedBody(PHOTO_REQUEST_BYTES),
  async (c) => {
    const token = bearer(c.req.header("Authorization"))!
    const body = await c.req.parseBody().catch(() => null)
    const file = body?.photo
    if (!(file instanceof File)) return problem(c, 400, "invalid_input")
    const fields = PhotoFields.safeParse({ alt: body?.alt, credit: body?.credit || undefined })
    if (!fields.success) return problem(c, 400, "invalid_input")
    const r = await attachPhoto(
      c.env.DB,
      c.env.MEDIA,
      c.req.param("id"),
      token,
      new Uint8Array(await file.arrayBuffer()),
      fields.data.alt,
      fields.data.credit,
    )
    if (r === "not_found") return problem(c, 404, "not_found")
    if (r === "too_large") return problem(c, 413, "too_large")
    if (r === "not_jpeg") return problem(c, 415, "not_jpeg")
    if (r === "closed") return problem(c, 409, "not_open")
    return c.json({ ok: true }, 200, PRIVATE)
  },
)
