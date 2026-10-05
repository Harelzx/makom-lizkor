import { Hono } from "hono"
import { submissions } from "./routes/submissions"

const app = new Hono<{ Bindings: Env }>()

app.get("/api/v1/health", (c) => c.json({ ok: true }))
app.route("/api/v1/submissions", submissions)

export default app
