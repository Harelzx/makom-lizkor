import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "../index"
import { verifyEmail } from "../db/places"
import { clock } from "../lib/clock"
import { PRIVATE, problem } from "../lib/http"
import { trackingMail } from "../lib/messages"

export const email = new Hono<AppEnv>()

/**
 * The confirmation page in the site posts here when the sender presses "אישור הכתובת". A GET would let a mail scanner
 * that follows links confirm the address on its own.
 */
email.post(
  "/verify",
  zValidator("json", z.object({ token: z.string().min(1).max(64) }).strict(), (r, c) =>
    r.success ? undefined : problem(c, 400, "invalid_input"),
  ),
  async (c) => {
    const r = await verifyEmail(c.env.DB, c.req.valid("json").token, clock(c.req.raw, c.env))
    if (!r) return problem(c, 404, "not_found")
    if (r.first) {
      const link = `${new URL(c.req.url).origin}/#/track/${r.placeId}/${r.emailToken}`
      await c
        .get("sendMail")(c.env, trackingMail(r.to, link))
        .catch(() => false)
    }
    return c.json({ ok: true }, 200, PRIVATE)
  },
)
