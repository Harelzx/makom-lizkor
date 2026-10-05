import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { z } from "zod"
import { text } from "@/shared/contract"
import { listQueue, transition, verifiedContact } from "../db/places"
import { decisionMail } from "../lib/messages"
import type { AppEnv } from "../index"
import { moderator } from "../lib/access"
import { clock } from "../lib/clock"
import { PRIVATE, problem } from "../lib/http"

export const admin = new Hono<{ Bindings: Env; Variables: AppEnv["Variables"] & { actor: string } }>()

admin.use("*", async (c, next) => {
  // Every admin answer, errors included, stays out of shared caches.
  c.header("Cache-Control", PRIVATE["Cache-Control"])
  // The admin authenticates by cookie, so a change must come from our own pages.
  if (c.req.method !== "GET" && c.req.header("Sec-Fetch-Site") !== "same-origin") return problem(c, 403, "cross_site")
  const who = await moderator(c.req.raw, c.env)
  if (!who.ok) return problem(c, who.status, who.status === 401 ? "sign_in" : "not_allowed")
  c.set("actor", who.email)
  await next()
})

admin.get("/queue", async (c) => c.json({ items: await listQueue(c.env.DB) }))

// Returning asks the sender for a change, so it carries a note; the note is all the moderator writes.
const Transition = z
  .object({
    action: z.enum(["approve", "reject", "return"]),
    revisionId: z.string(),
    expectedRev: z.number().int(),
    note: text({ max: 500, multiline: true }).optional(),
  })
  .strict()
  .refine((t) => t.action !== "return" || !!t.note, { message: "note_required" })

admin.post(
  "/places/:id/transitions",
  zValidator("json", Transition, (r, c) => (r.success ? undefined : problem(c, 400, "invalid_input"))),
  async (c) => {
    const body = c.req.valid("json")
    const result = await transition(c.env.DB, { placeId: c.req.param("id"), ...body, actor: c.get("actor") }, clock(c.req.raw, c.env))
    if (result !== "ok") return problem(c, 409, "changed_meanwhile")
    // A verified address hears about the decision; a mail that can't go now never undoes the decision.
    const contact = await verifiedContact(c.env.DB, c.req.param("id"))
    if (contact)
      await c
        .get("sendMail")(c.env, decisionMail(contact.email, body.action, contact.name_he ?? "", body.note))
        .catch(() => false)
    return c.json({ ok: true })
  },
)
