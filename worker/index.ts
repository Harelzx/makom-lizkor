import { Hono } from "hono"
import { problem } from "./lib/http"
import { sendMail, type SendMail } from "./lib/mail"
import { siteverify, type VerifyTurnstile } from "./lib/turnstile"
import { admin } from "./routes/admin"
import { dev } from "./routes/dev"
import { email } from "./routes/email"
import { feed } from "./routes/feed"
import { submissions } from "./routes/submissions"

/** What the routes reach outside the Worker; the tests pass stand-ins, the deployed Worker the real ones. */
export type Deps = { verifyTurnstile: VerifyTurnstile; sendMail: SendMail }
export type AppEnv = { Bindings: Env; Variables: Deps }

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>()
  app.use("*", async (c, next) => {
    c.set("verifyTurnstile", deps.verifyTurnstile)
    c.set("sendMail", deps.sendMail)
    await next()
  })

  app.get("/api/v1/health", (c) => c.json({ ok: true }))
  app.route("/api/v1/submissions", submissions)
  app.route("/api/v1/email", email)
  app.route("/api/v1", feed)
  app.route("/api/admin", admin)
  app.route("/__dev", dev)

  // Only /api/* and /__dev/* reach the Worker, so anything unmatched here is an API mistake, not a page.
  app.notFound((c) => problem(c, 404, "not_found"))
  // One JSON line with the route and the error's name only: never a body, a token, an address or a header.
  app.onError((err, c) => {
    console.error(JSON.stringify({ level: "error", event: "unhandled", method: c.req.method, path: c.req.routePath, error: err.name }))
    return problem(c, 500, "internal")
  })
  return app
}

export default createApp({ verifyTurnstile: siteverify, sendMail })
