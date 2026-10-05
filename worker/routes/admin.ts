import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { z } from "zod"
import { listQueue, transition } from "../db/places"
import { moderator } from "../lib/access"
import { clock } from "../lib/clock"
import { PRIVATE, problem } from "../lib/http"

export const admin = new Hono<{ Bindings: Env; Variables: { actor: string } }>()

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

const Transition = z.object({ action: z.enum(["approve", "reject"]), revisionId: z.string(), expectedRev: z.number().int() }).strict()

admin.post(
  "/places/:id/transitions",
  zValidator("json", Transition, (r, c) => (r.success ? undefined : problem(c, 400, "invalid_input"))),
  async (c) => {
    const body = c.req.valid("json")
    const result = await transition(c.env.DB, { placeId: c.req.param("id"), ...body, actor: c.get("actor") }, clock(c.req.raw, c.env))
    return result === "ok" ? c.json({ ok: true }) : problem(c, 409, "changed_meanwhile")
  },
)
