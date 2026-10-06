import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "../index"
import { claimTrackingMail, trackingMailSent, verifyEmail } from "../db/places"
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
    if (!c.env.TRACKING_SECRET) return problem(c, 503, "not_configured")
    const now = clock(c.req.raw, c.env)
    const r = await verifyEmail(c.env.DB, c.req.valid("json").token, now, c.env.TRACKING_SECRET)
    if (!r) return problem(c, 404, "not_found")
    // The tracking mail, if it hasn't gone out yet: this click, or a later one, tries again (five tries at most).
    // `mail` tells the page what happened to it, so a visitor whose mail didn't go knows to try again: "failed" also
    // when a click at the same moment holds the try (the next click learns how it went).
    let mail: "sent" | "earlier" | "failed" | "stopped" = r.mailState === "due" ? "failed" : r.mailState
    if (r.mail && (await claimTrackingMail(c.env.DB, r.mail.contactId))) {
      const link = `${new URL(c.req.url).origin}/#/track/${r.mail.placeId}/${r.mail.emailToken}`
      const sendMail = c.get("sendMail")
      const sent = await Promise.resolve()
        .then(() => sendMail(c.env, trackingMail(r.mail!.to, link)))
        .catch(() => false)
      if (sent) {
        await trackingMailSent(c.env.DB, r.mail.contactId, now)
        mail = "sent"
      }
    }
    // `first`: whether this click verified the address, or it was verified before.
    return c.json({ ok: true, first: r.first, mail }, 200, PRIVATE)
  },
)
