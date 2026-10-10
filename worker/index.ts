import { Hono } from "hono"
import { durations } from "./lib/durations"
import { problem } from "./lib/http"
import { sendMail, type SendMail } from "./lib/mail"
import { runJobs } from "./jobs"
import { edgePurge, type Purge } from "./lib/purge"
import { siteverify, type VerifyTurnstile } from "./lib/turnstile"
import { admin } from "./routes/admin"
import { dev } from "./routes/dev"
import { email } from "./routes/email"
import { contact } from "./routes/contact"
import { feed } from "./routes/feed"
import { reports } from "./routes/reports"
import { share } from "./routes/share"
import { submissions } from "./routes/submissions"
import { tributes } from "./routes/tributes"
import { ogResponse } from "./lib/og"
import { log } from "./lib/log"
import { ops } from "./routes/ops"
import { csp } from "./routes/csp"
import { probe, probeMove } from "./routes/purge-probe"
import { secure } from "./lib/security-headers"
import type { ErrorRates } from "./lib/ops-summary"

/** What the routes reach outside the Worker; the tests pass stand-ins, the deployed Worker the real ones. */
export type Deps = {
  verifyTurnstile: VerifyTurnstile
  sendMail: SendMail
  purge: Purge
  /** Error rates for /api/ops from the structured logs; none connected yet (they read as unavailable). */
  errorRates?: ErrorRates
}
export type AppEnv = { Bindings: Env; Variables: Deps }

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>()
  app.use("*", async (c, next) => {
    c.set("verifyTurnstile", deps.verifyTurnstile)
    c.set("sendMail", deps.sendMail)
    c.set("purge", deps.purge)
    c.set("errorRates", deps.errorRates)
    await next()
    // The site's security headers on everything the Worker answers, errors included (spec 11); the static files get
    // the same ones from public/_headers. A response made by fetch has fixed headers, so it is copied first.
    // And the serving version's tag, on every answer: a check after a deploy reads it to know which version answered
    // (a61). An untagged version names nothing.
    const tag = c.env.CF_VERSION_METADATA?.tag
    const mark = (h: Headers) => {
      secure(h)
      if (tag) h.set("X-Worker-Version", tag)
    }
    try {
      mark(c.res.headers)
    } catch {
      c.res = new Response(c.res.body, c.res)
      mark(c.res.headers)
    }
  })

  // The retention scale is checked before any route runs: a value refused here (worker/lib/durations.ts) answers every
  // request with an error before anything is written, a curated draft included (L-RET-GUARD-1), and a staging deploy
  // with a wrong value fails its own checks at once.
  app.use("*", async (c, next) => {
    durations(c.env)
    await next()
  })

  app.get("/api/v1/health", (c) => c.json({ ok: true }))
  app.route("/api/v1/submissions", submissions)
  app.route("/api/v1/email", email)
  app.route("/api/v1/contact", contact)
  app.route("/api/v1/tributes", tributes)
  app.route("/api/v1/reports", reports)
  app.route("/api/v1/purge-probe", probe)
  app.route("/api/v1", feed)
  app.route("/api/admin", admin)
  app.route("/api/ops/purge-probe", probeMove)
  app.route("/api/ops", ops)
  app.route("/api/csp-report", csp)
  app.route("/__dev", dev)
  app.route("/", share)

  // A contribution's share image, only while it is the place's current one (worker/lib/og.ts).
  app.get("/media/og/:id/:file", (c) => {
    const file = c.req.param("file")
    return ogResponse({ db: c.env.DB, media: c.env.MEDIA }, c.req.param("id"), file.endsWith(".png") ? file.slice(0, -4) : "")
  })

  // Approved photos only: the Worker is the one door to the bucket, and it opens public/ alone (spec 5).
  app.get("/media/public/*", async (c) => {
    const key = c.req.path.replace(/^\/media\//, "")
    // Only a photo of a revision published now (a contribution's one, or a curated place's, with its thumbnail): a file
    // a lost race or a failed cleanup left behind serves nothing.
    // And only while the photo isn't hidden, by itself or with its whole place (spec 6).
    const live = await c.env.DB.prepare(
      `SELECT p.id FROM places p JOIN revisions r ON r.id = p.published_revision_id
       WHERE p.status = 'published'
         AND (r.photo_key = ?1 OR EXISTS (SELECT 1 FROM revision_photos rp WHERE rp.revision_id = r.id AND ?1 IN (rp.key, rp.thumb_key)))
         AND NOT EXISTS (SELECT 1 FROM field_suppressions s WHERE s.place_id = p.id AND s.lifted_at IS NULL AND s.field IN ('photo', 'whole'))`,
    )
      .bind(key)
      .first<string>("id")
    if (!live) return problem(c, 404, "not_found")
    const object = await c.env.MEDIA.get(key)
    if (!object) return problem(c, 404, "not_found")
    // A minute in the browser and at the edge (spec 5), tagged with its place: a takedown purges the edge copy, and
    // the minute bounds it if the purge fails.
    // A contribution's photo is re-encoded JPEG; a curated one may be WebP. Nothing else is ever served as a picture.
    const type = object.httpMetadata?.contentType === "image/webp" ? "image/webp" : "image/jpeg"
    return c.body(object.body, 200, {
      "Content-Type": type,
      "Cache-Control": "public, max-age=60",
      "Cloudflare-CDN-Cache-Control": "max-age=60",
      "Cache-Tag": `place:${live}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    })
  })

  // Only /api/*, /__dev/*, /media/* and /place/* reach the Worker, so anything unmatched here is an API mistake, not a page.
  app.notFound((c) => problem(c, 404, "not_found"))
  // One JSON line with the route and the error's name only: never a body, a token, an address or a header.
  app.onError((err, c) => {
    log("error", "unhandled", { method: c.req.method, path: c.req.routePath, error: err.name })
    return problem(c, 500, "internal")
  })
  return app
}

const deps = { verifyTurnstile: siteverify, sendMail, purge: edgePurge }
const app = createApp(deps)

export default {
  fetch: app.fetch,
  // Every 15 minutes (wrangler.jsonc): unfinished decisions, the 24-hour backstop, reminders, the abuse codes.
  scheduled(controller, env, ctx) {
    ctx.waitUntil(runJobs(env, deps, ctx, new Date(controller.scheduledTime)))
  },
} satisfies ExportedHandler<Env>
