import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { TributeInput } from "@/shared/contract"
import type { AppEnv } from "../index"
import { leaveTribute, tributeTotals } from "../db/tributes"
import { clock } from "../lib/clock"
import { jerusalemDay } from "../lib/day"
import { problem } from "../lib/http"
import { boundedBody, requestCap } from "../lib/request-guard"

export const tributes = new Hono<AppEnv>()

const KEY = /^[0-9a-f]{32}$/

tributes.post(
  "/",
  requestCap("TRIBUTE_LIMIT"),
  boundedBody(1024),
  zValidator("json", TributeInput, (r, c) => (r.success ? undefined : problem(c, 400, "invalid_input"))),
  async (c) => {
    // Only the site's own pages send anemones: another site can't spend its visitors' taps on a count. A script can
    // still claim any Origin, which is what the cap per address in leaveTribute is for.
    const site = c.env.ENVIRONMENT === "development" ? new URL(c.req.url).origin : c.env.PUBLIC_ORIGIN
    if (!site) return problem(c, 503, "not_configured")
    if (c.req.header("Origin") !== site) return problem(c, 403, "cross_site")
    const key = c.req.header("Idempotency-Key") ?? ""
    if (!KEY.test(key)) return problem(c, 400, "idempotency_key_required")
    // Without the secret a device can't be kept apart from day to day: count nothing rather than count it loosely.
    if (!c.env.TRIBUTE_SECRET) return problem(c, 503, "not_configured")
    // A coarse ceiling per address, counted at Cloudflare's edge under a keyed code, never the address itself.
    const now = clock(c.req.raw, c.env)
    const input = { key, ...c.req.valid("json") }
    const address = c.req.header("CF-Connecting-IP") ?? null
    const r = await leaveTribute(c.env.DB, c.env.TRIBUTE_SECRET, input, address, jerusalemDay(now), now)
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
