import { Hono } from "hono"
import { admin } from "./routes/admin"
import { dev } from "./routes/dev"
import { submissions } from "./routes/submissions"

const app = new Hono<{ Bindings: Env }>()

app.get("/api/v1/health", (c) => c.json({ ok: true }))
app.route("/api/v1/submissions", submissions)
app.route("/api/admin", admin)
app.route("/__dev", dev)

export default app
