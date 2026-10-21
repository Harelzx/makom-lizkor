import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { ContactInput } from "@/shared/contact"
import { CONTACT_EMAIL } from "@/config"
import type { AppEnv } from "../index"
import { PRIVATE, problem } from "../lib/http"
import { contactMailReady } from "../lib/mail"
import { boundedBody, requestCap } from "../lib/request-guard"
import { checkTurnstile } from "../lib/turnstile"

export const contact = new Hono<AppEnv>()
contact.get("/", (c) => c.json({ enabled: contactMailReady(c.env) }, 200, PRIVATE))
contact.post(
  "/",
  requestCap("REPORT_LIMIT", "contact:"),
  boundedBody(12_000),
  zValidator("json", ContactInput, (r, c) => (r.success ? undefined : problem(c, 400, "invalid_input"))),
  async (c) => {
    // The recipient is fixed on the server. This endpoint cannot relay mail to a caller's chosen address.
    if (!contactMailReady(c.env)) return problem(c, 503, "not_configured")
    if (c.req.header("Origin") !== c.env.PUBLIC_ORIGIN || c.req.header("Sec-Fetch-Site") !== "same-origin")
      return problem(c, 403, "cross_site")
    const address = c.req.header("CF-Connecting-IP")
    const outcome = await checkTurnstile(c.env, c.get("verifyTurnstile"), c.req.header("Turnstile-Token"), "contact", address)
    if (outcome !== "ok") return problem(c, outcome === "unavailable" ? 503 : 403, `turnstile_${outcome}`)
    const { email, message } = c.req.valid("json")
    // No local database, outbox, automatic retry or copy in the browser. Gmail's existing retention rules apply.
    const accepted = await c.get("sendMail")(c.env, {
      to: CONTACT_EMAIL,
      subject: "פנייה ממקום לזכור",
      text: `כתובת לתשובה: ${email}\n\n${message}`,
      budget: "visitor",
    })
    return accepted ? c.json({ accepted: true }, 202, PRIVATE) : problem(c, 503, "mail_unavailable")
  },
)
