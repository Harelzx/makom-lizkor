import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { TributeInput } from "@/shared/contract"
import type { AppEnv } from "../index"
import { leaveTribute, tributeTotals } from "../db/tributes"
import { clock } from "../lib/clock"
import { jerusalemDay } from "../lib/day"
import { problem } from "../lib/http"
import { rateKey } from "../lib/ids"

export const tributes = new Hono<AppEnv>()

const KEY = /^[0-9a-f]{32}$/

tributes.post(
  "/",
  zValidator("json", TributeInput, (r, c) => (r.success ? undefined : problem(c, 400, "invalid_input"))),
  async (c) => {
    const key = c.req.header("Idempotency-Key") ?? ""
    if (!KEY.test(key)) return problem(c, 400, "idempotency_key_required")
    // Without the secret a device can't be kept apart from day to day: count nothing rather than count it loosely.
    if (!c.env.TRIBUTE_SECRET) return problem(c, 503, "not_configured")
    // A coarse ceiling per address, counted at Cloudflare's edge under a keyed code, never the address itself.
    const address = c.req.header("CF-Connecting-IP")
    if (address && !(await c.env.TRIBUTE_LIMIT.limit({ key: await rateKey(c.env.TRIBUTE_SECRET, address) })).success)
      return problem(c, 429, "rate_limited", {}, { "Retry-After": "60" })
    const now = clock(c.req.raw, c.env)
    const r = await leaveTribute(c.env.DB, c.env.TRIBUTE_SECRET, { key, ...c.req.valid("json") }, jerusalemDay(now), now)
    if (r === "key_reused") return problem(c, 409, "idempotency_key_reused")
    return c.json(r, 200, { "Cache-Control": "no-store" })
  },
)

// The browser never keeps the counts; the edge keeps them a minute (spec 5), unverified until staging.
tributes.get("/", async (c) =>
  c.json({ totals: await tributeTotals(c.env.DB) }, 200, {
    "Cache-Control": "no-store",
    "Cloudflare-CDN-Cache-Control": "max-age=60",
    "Cache-Tag": "tributes",
  }),
)
