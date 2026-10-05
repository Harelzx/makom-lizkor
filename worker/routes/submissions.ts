import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { SubmissionInput } from "@/shared/contract"
import { insertSubmission, submissionStatus } from "../db/places"
import { clock } from "../lib/clock"
import { PRIVATE, problem } from "../lib/http"

export const submissions = new Hono<{ Bindings: Env }>()

submissions.post(
  "/",
  zValidator("json", SubmissionInput, (r, c) => (r.success ? undefined : problem(c, 400, "invalid_input"))),
  async (c) => {
    const created = await insertSubmission(c.env.DB, c.req.valid("json"), clock(c.req.raw, c.env))
    return c.json(created, 201, PRIVATE)
  },
)

submissions.get("/:id", async (c) => {
  const token = /^Bearer (.+)$/.exec(c.req.header("Authorization") ?? "")?.[1]
  // An unknown id and a wrong token look the same, so the endpoint reveals nothing about which ids exist.
  const status = token ? await submissionStatus(c.env.DB, c.req.param("id"), token) : null
  return status ? c.json(status, 200, PRIVATE) : problem(c, 404, "not_found")
})
