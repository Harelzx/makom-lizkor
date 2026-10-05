import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { SubmissionInput } from "@/shared/contract"
import { insertSubmission, submissionStatus, withdraw } from "../db/places"
import { clock } from "../lib/clock"
import { PRIVATE, problem } from "../lib/http"

export const submissions = new Hono<{ Bindings: Env }>()

// One key per place, made by the browser before its first try; 128 random bits in base64url, or a hex UUID.
const KEY = /^[A-Za-z0-9_-]{22,64}$/

submissions.post(
  "/",
  zValidator("json", SubmissionInput, (r, c) => (r.success ? undefined : problem(c, 400, "invalid_input"))),
  async (c) => {
    const key = c.req.header("Idempotency-Key") ?? ""
    if (!KEY.test(key)) return problem(c, 400, "idempotency_key_required")
    const r = await insertSubmission(c.env.DB, c.req.valid("json"), key, clock(c.req.raw, c.env))
    if (r.kind === "mismatch") return problem(c, 409, "idempotency_key_reused")
    // 200 for the same submission sent again, so the browser can tell, though it treats both alike.
    return c.json({ id: r.id, trackingToken: r.trackingToken }, r.kind === "created" ? 201 : 200, PRIVATE)
  },
)

const bearer = (header: string | undefined) => /^Bearer (.+)$/.exec(header ?? "")?.[1]

submissions.get("/:id", async (c) => {
  const token = bearer(c.req.header("Authorization"))
  // An unknown id and a wrong token look the same, so the endpoint reveals nothing about which ids exist.
  const status = token ? await submissionStatus(c.env.DB, c.req.param("id"), token) : null
  return status ? c.json(status, 200, PRIVATE) : problem(c, 404, "not_found")
})

submissions.post("/:id/withdraw", async (c) => {
  const token = bearer(c.req.header("Authorization"))
  const done = token ? await withdraw(c.env.DB, c.req.param("id"), token, clock(c.req.raw, c.env)) : false
  return done ? c.json({ status: "withdrawn" }, 200, PRIVATE) : problem(c, 404, "not_found")
})
