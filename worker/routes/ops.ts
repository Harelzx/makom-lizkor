import { Hono } from "hono"
import { opsCaller } from "../lib/access"
import { clock } from "../lib/clock"
import { problem } from "../lib/http"
import { opsSummary } from "../lib/ops-summary"
import type { AppEnv } from "../index"

/** The diagnostic agent's view of production (spec 10, 12.1): aggregates only, never cached, for a listed service token. */
export const ops = new Hono<AppEnv>()

ops.get("/summary", async (c) => {
  const caller = await opsCaller(c.req.raw, c.env)
  if (!caller.ok) return problem(c, caller.status, caller.status === 401 ? "unauthorized" : "forbidden")
  const summary = await opsSummary(c.env, c.get("errorRates"), clock(c.req.raw, c.env))
  return c.json(summary, 200, { "Cache-Control": "private, no-store" })
})
