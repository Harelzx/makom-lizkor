import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { z } from "zod"
import { ELEMENTS, text } from "@/shared/contract"
import { attention, BASIS_CODES, lift, listReports, parseCursor, placeView, readContact, setReportStatus, suppress } from "../db/moderation"
import { runOp } from "../db/ops"
import { photosBefore, preparePhoto } from "../db/photos"
import { listQueue, transitionStatements, verifiedContact } from "../db/places"
import { decisionMail } from "../lib/messages"
import type { AppEnv } from "../index"
import { moderator } from "../lib/access"
import { clock } from "../lib/clock"
import { PRIVATE, problem } from "../lib/http"
import { opEnv } from "../lib/purge"

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
    const placeId = c.req.param("id")
    // Whether this decides a correction of a place already published: the mail says so.
    const status = await c.env.DB.prepare("SELECT status FROM places WHERE id = ?").bind(placeId).first<string>("status")
    const correction = status === "published" || status === "hidden"
    // The files this decision may make obsolete, as they are before it.
    const before = await photosBefore(c.env.DB, placeId, body.revisionId)
    const now = clock(c.req.raw, c.env)
    let photo: { key: string | null; fresh: boolean } | undefined
    // Recorded before it happens: no decision is made that the ledger can't hold (spec 8.2). An approval publishes the
    // photo in the same step as the place, so its copy is made first; one that never lands is removed again.
    const { outcome } = await runOp(
      opEnv(c),
      {
        placeId,
        kind: body.action,
        actor: "moderator",
        detail: { revision: body.revisionId },
        expectedRev: body.expectedRev,
        removal: false,
        public: body.action === "approve",
        onIntentFailure: "refuse",
        prepare: async () => {
          if (body.action === "reject") return { retire: [before.source].filter((k): k is string => !!k) }
          if (body.action !== "approve") return
          photo = await preparePhoto(c.env.DB, c.env.MEDIA, placeId, body.revisionId)
          // A correction approved while the photo is hidden keeps it hidden: the hide applies to whatever is published.
          const photoHidden = await c.env.DB.prepare(
            "SELECT 1 FROM field_suppressions WHERE place_id = ? AND lifted_at IS NULL AND field IN ('photo', 'whole')",
          )
            .bind(placeId)
            .first()
          return {
            prepared: photo.fresh && photo.key ? [photo.key] : [],
            toHeld: photoHidden && photo.fresh && photo.key ? [photo.key] : [],
            media: photo.key ? [photo.key] : [],
            retire: [before.source, before.published !== photo.key ? before.published : null].filter((k): k is string => !!k),
          }
        },
        statements: (tid) => transitionStatements(c.env.DB, { placeId, ...body, actor: c.get("actor"), photoKey: photo?.key }, tid, now),
      },
      now,
    )
    if (outcome === "ledger_unwritten") return problem(c, 503, "ledger_unavailable", {}, { "Retry-After": "30" })
    if (outcome === "prepare_failed") return problem(c, 503, "media_unavailable", {}, { "Retry-After": "30" })
    if (outcome !== "ok") return problem(c, 409, "changed_meanwhile")
    // A verified address hears about the decision; a mail that can't go now never undoes the decision.
    const contact = await verifiedContact(c.env.DB, c.req.param("id"))
    if (contact)
      await c
        .get("sendMail")(c.env, decisionMail(contact.email, body.action, contact.name_he ?? "", body.note, correction, status === "hidden"))
        .catch(() => false)
    return c.json({ ok: true })
  },
)

/** A photo as the moderator must see it before deciding: in quarantine, or already public. */
admin.get("/media/*", async (c) => {
  const key = c.req.path.replace(/^.*\/api\/admin\/media\//, "")
  if (!/^(quarantine|public)\//.test(key)) return problem(c, 404, "not_found")
  const object = await c.env.MEDIA.get(key)
  if (!object) return problem(c, 404, "not_found")
  // Served as a picture and nothing else: never sniffed into another type, and sandboxed if opened on its own.
  return c.body(object.body, 200, {
    "Content-Type": "image/jpeg",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
  })
})

const invalid = (r: { success: boolean }, c: Parameters<typeof problem>[0]) => (r.success ? undefined : problem(c, 400, "invalid_input"))
const outcomeOf = (c: Parameters<typeof problem>[0], outcome: string) =>
  outcome === "ok"
    ? c.json({ ok: true })
    : outcome === "not_found"
      ? problem(c, 404, "not_found")
      : outcome === "ledger_unwritten"
        ? problem(c, 503, "ledger_unavailable", {}, { "Retry-After": "30" })
        : outcome === "prepare_failed"
          ? problem(c, 503, "media_unavailable", {}, { "Retry-After": "30" })
          : outcome === "invalid_report"
            ? problem(c, 422, "invalid_report")
            : problem(c, 409, "changed_meanwhile")

admin.get("/places/:id", async (c) => {
  const view = await placeView(c.env.DB, c.req.param("id"))
  return view ? c.json(view) : problem(c, 404, "not_found")
})

// A manual hide: elements of a public place, or the whole place, with a reason; never limited by the safeguards.
const Suppression = z
  .object({
    placeId: z.string().min(1).max(64),
    fields: z
      .array(z.enum(ELEMENTS))
      .min(1)
      .refine((f) => new Set(f).size === f.length),
    expectedRev: z.number().int(),
    reason: text({ max: 500, multiline: true }),
    reportId: z.string().max(64).optional(),
  })
  .strict()

admin.post("/suppressions", zValidator("json", Suppression, invalid), async (c) => {
  const body = c.req.valid("json")
  return outcomeOf(c, await suppress(opEnv(c), { ...body, actor: c.get("actor") }, clock(c.req.raw, c.env)))
})

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const Lift = z
  .object({
    expectedRev: z.number().int(),
    basisCode: z.enum(BASIS_CODES),
    basisNote: text({ max: 1000, multiline: true }).refine((s) => s.length >= 10, { message: "too_short" }),
    confirm: z.object({ affirmativeBasis: z.boolean().optional(), notNonresponseOrDispute: z.boolean().optional() }).strict(),
    evidenceRef: text({ max: 300 }).optional(),
    adviserName: text({ max: 120 }).optional(),
    adviceDate: isoDate.optional(),
    familyContact: z
      .object({ note: text({ max: 500, multiline: true }), date: isoDate })
      .strict()
      .optional(),
    verificationNote: text({ max: 500, multiline: true }).optional(),
    materialAbsent: z.boolean().optional(),
  })
  .strict()

admin.post("/suppressions/:id/lift", zValidator("json", Lift, invalid), async (c) => {
  const result = await lift(opEnv(c), c.req.param("id"), c.req.valid("json"), c.get("actor"), clock(c.req.raw, c.env))
  if (typeof result === "object") return problem(c, 422, result.refused)
  return outcomeOf(c, result)
})

admin.get("/reports", async (c) => {
  const status = c.req.query("status")
  const cursor = parseCursor(c.req.query("cursor"))
  if (cursor === "invalid") return problem(c, 400, "invalid_input")
  return c.json(await listReports(c.env.DB, status === "closed" || status === "all" ? status : "open", cursor))
})

admin.get("/reports/:id/contact", async (c) => {
  const email = await readContact(c.env.DB, c.req.param("id"), c.get("actor"), clock(c.req.raw, c.env))
  return email ? c.json({ email }) : problem(c, 404, "not_found")
})

const Note = z.object({ note: text({ max: 500, multiline: true }).optional() }).strict()
for (const [path, to, needsNote] of [
  ["handle", "in_review", true],
  ["close", "closed", true],
  ["reopen", "open", false],
] as const) {
  admin.post(`/reports/:id/${path}`, zValidator("json", Note, invalid), async (c) => {
    const { note } = c.req.valid("json")
    // Handling is recorded in words: a reminder stops only when someone wrote what they did.
    if (needsNote && !note) return problem(c, 400, "note_required")
    const changed = await setReportStatus(c.env.DB, c.req.param("id"), to, c.get("actor"), note ?? null, clock(c.req.raw, c.env))
    return changed ? c.json({ ok: true }) : problem(c, 409, "changed_meanwhile")
  })
}

admin.get("/attention", async (c) => {
  const cursor = parseCursor(c.req.query("cursor"))
  if (cursor === "invalid") return problem(c, 400, "invalid_input")
  const { items, next } = await attention(c.env.DB, cursor)
  return c.json({ ops: items, next })
})
