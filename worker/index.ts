import { Hono } from "hono"
import { problem } from "./lib/http"
import { admin } from "./routes/admin"
import { dev } from "./routes/dev"
import { feed } from "./routes/feed"
import { submissions } from "./routes/submissions"

const app = new Hono<{ Bindings: Env }>()

app.get("/api/v1/health", (c) => c.json({ ok: true }))
app.route("/api/v1/submissions", submissions)
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

export default app
