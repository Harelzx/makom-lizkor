import { durations } from "../lib/durations"
import { zValidator } from "@hono/zod-validator"
import { Hono, type Context } from "hono"
import { z } from "zod"
import { ELEMENTS, text } from "@/shared/contract"
import { attention, BASIS_CODES, lift, listReports, parseCursor, placeView, readContact, setReportStatus, suppress } from "../db/moderation"
import { runOp } from "../db/ops"
import { photosBefore, preparePhoto } from "../db/photos"
import { curatedKeyStatements, prepareCuratedPhotos, revisionKeys, storeCurated } from "../db/curated"
import { CURATED_ID, CuratedInput, curatedSourceProblems } from "@/shared/curated"
import { ulid } from "../lib/ids"
import { listQueue, transitionStatements, verifiedContact } from "../db/places"
import { decisionMail } from "../lib/messages"
import type { AppEnv } from "../index"
import { moderator } from "../lib/access"
import { clock } from "../lib/clock"
import { PRIVATE, problem } from "../lib/http"
import { machineMay, syntheticRev } from "../lib/synthetic"
import { opEnv } from "../lib/purge"
import { commissioningAllowed, commissioningStatus, manualRecovery, manualSnapshot } from "../db/commissioning"
import { opsSummary } from "../lib/ops-summary"

type AdminEnv = { Bindings: Env; Variables: AppEnv["Variables"] & { actor: string; machine: boolean; machineRev: number | null } }
type AdminContext = Context<AdminEnv>
export const admin = new Hono<AdminEnv>()

admin.use("*", async (c, next) => {
  // Every admin answer, errors included, stays out of shared caches.
  c.header("Cache-Control", PRIVATE["Cache-Control"])
  // The admin authenticates by cookie, so a change must come from our own pages.
  if (c.req.method !== "GET" && c.req.header("Sec-Fetch-Site") !== "same-origin") return problem(c, 403, "cross_site")
  const who = await moderator(c.req.raw, c.env)
  if (!who.ok) return problem(c, who.status, who.status === 401 ? "sign_in" : "not_allowed")
  c.set("actor", who.email)
  c.set("machine", who.machine)
  // Staging's synthetic machine moderator: only its few routes, only on synthetic places, each change made against the
  // rev that was found synthetic (H1).
  if (who.machine) {
    const may = await machineMay(c.env.DB, c.req.method, c.req.path.replace(/^\/api\/admin/, ""), () => c.req.json())
    if (!may.ok) return problem(c, 403, "not_allowed")
    c.set("machineRev", may.rev)
  }
  await next()
})

// The existing human administrator's view; machine scopes and the diagnostic-agent boundary stay unchanged.
admin.get("/summary", async (c) => c.json(await opsSummary(c.env, c.get("errorRates"), clock(c.req.raw, c.env)), 200, PRIVATE))

// A dated private commissioning screen, behind the same human Access verification as every moderator action.
const commissioningPage = (receipt: object) =>
  `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>בדיקת השקה מבוקרת</title><body><main><h1>בדיקת השקה מבוקרת</h1><p>גיבוי חד-פעמי של מקומות הדמה בלבד. השחזור כותב רק למסד הניסוי ומנקה אותו. התזמון הרגיל אינו משתנה.</p><form method="post"><button name="action" value="snapshot">יצירת גיבוי ידני</button><button name="action" value="recovery">בדיקת שחזור אחרי הסרה</button></form><pre dir="ltr">${JSON.stringify(receipt, null, 2).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</pre></main></body></html>`

admin.on(["GET", "POST"], "/commissioning", async (c) => {
  const now = new Date()
  const origin = new URL(c.req.url).origin
  if (!commissioningAllowed(c.env, c.get("actor"), c.get("machine"), origin, now)) return problem(c, 404, "not_found")
  c.header("Content-Security-Policy", "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
  c.header("Referrer-Policy", "no-referrer")
  if (c.req.method === "GET") return c.html(commissioningPage(await commissioningStatus(c.env.EXPORTS)))
  if (c.req.header("Origin") !== origin) return problem(c, 403, "cross_site")
  if (c.req.header("Content-Type") !== "application/x-www-form-urlencoded" || Number(c.req.header("Content-Length") ?? Infinity) > 100)
    return problem(c, 400, "invalid_input")
  const encoded = await c.req.text()
  if (new TextEncoder().encode(encoded).byteLength > 100) return problem(c, 400, "invalid_input")
  const body = new URLSearchParams(encoded)
  if ([...body.keys()].length !== 1 || !["snapshot", "recovery"].includes(body.get("action") ?? "")) return problem(c, 400, "invalid_input")
  if (!c.env.DRILL_DB || !c.env.DRILL_PRIVATE_KEY) return problem(c, 409, "bindings")
  const env = {
    db: c.env.DB,
    target: c.env.DRILL_DB,
    media: c.env.MEDIA,
    exports: c.env.EXPORTS,
    ledger: c.env.LEDGER,
    keys: c.env.EXPORT_PUBLIC_KEYS ?? "",
    drillKey: c.env.DRILL_PRIVATE_KEY,
  }
  try {
    const receipt = body.get("action") === "snapshot" ? await manualSnapshot(env, now) : await manualRecovery(env, now)
    return c.html(commissioningPage(receipt))
  } catch (e) {
    const code = e instanceof Error && /^[a-z_]+$/.test(e.message) ? e.message : "operation_failed"
    return c.html(commissioningPage({ ok: false, failure: code }), 409)
  }
})

admin.get("/queue", async (c) => {
  const items = await listQueue(c.env.DB)
  if (!c.get("machine")) return c.json({ items })
  // Each listed at the rev it was read at, and that rev found synthetic: a correction since leaves it out.
  const revs = await Promise.all(items.map((i) => syntheticRev(c.env.DB, String(i.id))))
  return c.json({ items: items.filter((i, n) => revs[n] !== null && revs[n] === i.rev) })
})

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
  async (c) => decide(c, c.req.param("id"), c.req.valid("json")),
)

/**
 * A moderator's decision on a revision, recorded before it happens (no decision the ledger can't hold, spec 8.2). An
 * approval publishes the photos in the same step as the place, so their copies are made first; one that never lands is
 * removed again. A curated revision's photos and thumbnails go the same way as a contribution's one photo.
 */
async function decide(c: AdminContext, placeId: string, body: z.infer<typeof Transition>) {
  // Whether this decides a correction of a place already published: the mail says so.
  const status = await c.env.DB.prepare("SELECT status FROM places WHERE id = ?").bind(placeId).first<string>("status")
  const correction = status === "published" || status === "hidden"
  // The files this decision may make obsolete, as they are before it.
  const before = await photosBefore(c.env.DB, placeId, body.revisionId)
  const publishedBefore = await revisionKeys(
    c.env.DB,
    await c.env.DB.prepare("SELECT published_revision_id FROM places WHERE id = ?")
      .bind(placeId)
      .first<string | null>("published_revision_id"),
  )
  const now = clock(c.req.raw, c.env)
  let photo: { key: string | null; fresh: boolean; source: string | null } | undefined
  let curated: Awaited<ReturnType<typeof prepareCuratedPhotos>> | undefined
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
        if (body.action === "reject") return { retire: [before.source, ...before.quarantined].filter((k): k is string => !!k) }
        if (body.action !== "approve") return
        photo = await preparePhoto(c.env.DB, c.env.MEDIA, placeId, body.revisionId)
        curated = await prepareCuratedPhotos(c.env.DB, c.env.MEDIA, placeId, body.revisionId)
        // A correction approved while the photo is hidden keeps it hidden: the hide applies to whatever is published.
        const photoHidden = await c.env.DB.prepare(
          "SELECT 1 FROM field_suppressions WHERE place_id = ? AND lifted_at IS NULL AND field IN ('photo', 'whole')",
        )
          .bind(placeId)
          .first()
        const fresh = [...(photo.fresh && photo.key ? [photo.key] : []), ...curated.prepared]
        const kept = new Set([photo.key, ...curated.keys.flatMap((k) => [k.key, k.thumb_key])])
        return {
          // Which file each photo index was published from, and as: a replay onto a copy taken while the record
          // waited publishes exactly these, or hides the place (P7-REC-1). Keys only, like the rest of the ledger.
          ...(curated.keys.length ? { photos: curated.keys } : {}),
          prepared: fresh,
          toHeld: photoHidden ? fresh : [],
          media: [...(photo.key ? [photo.key] : []), ...curated.keys.flatMap((k) => [k.key, k.thumb_key])],
          source: photo.source,
          retire: [
            before.source,
            before.published !== photo.key ? before.published : null,
            ...curated.originals,
            ...publishedBefore.filter((k) => !kept.has(k)),
          ].filter((k): k is string => !!k),
        }
      },
      statements: (tid) => [
        ...transitionStatements(c.env.DB, { placeId, ...body, actor: c.get("actor"), photoKey: photo?.key }, tid, now, durations(c.env)),
        ...(curated ? curatedKeyStatements(c.env.DB, placeId, body.revisionId, curated.keys, tid) : []),
      ],
    },
    now,
  )
  if (outcome === "ledger_unwritten") return problem(c, 503, "ledger_unavailable", {}, { "Retry-After": "30" })
  if (outcome === "prepare_failed") return problem(c, 503, "media_unavailable", {}, { "Retry-After": "30" })
  if (outcome !== "ok") return problem(c, 409, "changed_meanwhile")
  // A verified address hears about the decision; a mail that can't go now never undoes the decision.
  const contact = await verifiedContact(c.env.DB, placeId)
  if (contact)
    await c
      .get("sendMail")(c.env, decisionMail(contact.email, body.action, contact.name_he ?? "", body.note, correction, status === "hidden"))
      .catch(() => false)
  return c.json({ ok: true })
}

/**
 * One of the operator's own places, created or edited by a moderator (spec 3, the API table; phase 7): the whole
 * record with a source for each field, stored as a revision and published by the same decision as an approval. A
 * contribution is never edited here. Each write carries an Idempotency-Key: a retry after a lost answer gets the same
 * answer, and the key with another body is refused.
 */
admin.post(
  "/places",
  zValidator("json", CuratedInput, (r, c) => (r.success ? undefined : problem(c, 400, "invalid_input"))),
  async (c) => {
    const key = c.req.header("Idempotency-Key") ?? ""
    if (!/^[A-Za-z0-9_-]{22,64}$/.test(key)) return problem(c, 400, "idempotency_key_required")
    const input = c.req.valid("json")
    const missing = curatedSourceProblems(input.curated, input.photos, input.sources)
    if (missing.length) return problem(c, 422, "sources_missing", { missing })
    const stored = await storeCurated(c.env.DB, c.env.MEDIA, input, key, clock(c.req.raw, c.env))
    if (stored.kind !== "stored" && stored.kind !== "replay") {
      if (stored.kind === "contribution") return problem(c, 403, "not_curated")
      if (stored.kind === "mismatch") return problem(c, 409, "idempotency_key_reused")
      if (stored.kind === "photo_unknown") return problem(c, 422, "photo_unknown")
      return problem(c, 409, "changed_meanwhile")
    }
    const place = await c.env.DB.prepare("SELECT rev, published_revision_id FROM places WHERE id = ?")
      .bind(input.id)
      .first<{ rev: number; published_revision_id: string | null }>()
    // A retry of a write already published answers as it did; one whose publication didn't land publishes it now.
    if (place?.published_revision_id !== stored.revisionId) {
      const decided = await decide(c, input.id, { action: "approve", revisionId: stored.revisionId, expectedRev: place!.rev })
      if (!decided.ok) return decided
    }
    const rev = await c.env.DB.prepare("SELECT rev FROM places WHERE id = ?").bind(input.id).first<number>("rev")
    return c.json({ id: input.id, rev }, stored.created ? 201 : 200)
  },
)

const PHOTO_MAX = 4 * 1024 * 1024
/** A curated photo's file and thumbnail, waiting in quarantine/ until the record naming them is published. */
admin.post("/curated-photos", async (c) => {
  const form = await c.req.formData().catch(() => null)
  const placeId = form?.get("place_id")
  const file = form?.get("file")
  const thumb = form?.get("thumb")
  if (typeof placeId !== "string" || !CURATED_ID.test(placeId) || !(file instanceof File) || !(thumb instanceof File))
    return problem(c, 400, "invalid_input")
  const kinds = await Promise.all(
    [file, thumb].map(async (f) => (f.size > PHOTO_MAX ? null : imageType(new Uint8Array(await f.arrayBuffer())))),
  )
  if (kinds.some((k) => !k)) return problem(c, 415, "not_a_picture")
  const name = `quarantine/${placeId}/${ulid()}`
  const [main, small] = [`${name}.${kinds[0]!.ext}`, `${name}.thumb.${kinds[1]!.ext}`]
  await c.env.MEDIA.put(main, await file.arrayBuffer(), { httpMetadata: { contentType: kinds[0]!.type } })
  await c.env.MEDIA.put(small, await thumb.arrayBuffer(), { httpMetadata: { contentType: kinds[1]!.type } })
  return c.json({ key: main, thumb_key: small }, 201)
})

/** WebP or JPEG by its first bytes; nothing else is stored as a picture. */
function imageType(b: Uint8Array): { type: string; ext: string } | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to))
  if (b.length > 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { type: "image/webp", ext: "webp" }
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: "image/jpeg", ext: "jpg" }
  return null
}

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
  if (!view) return problem(c, 404, "not_found")
  // The machine's view only when the place, read again, is still the synthetic one it was checked at: nothing changed
  // while the view was read.
  if (c.get("machine")) {
    const now = await syntheticRev(c.env.DB, c.req.param("id"))
    if (now === null || now !== c.get("machineRev") || view.rev !== now) return problem(c, 409, "changed_meanwhile")
  }
  return c.json(view)
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
    const changed = await setReportStatus(
      c.env.DB,
      c.req.param("id"),
      to,
      c.get("actor"),
      note ?? null,
      clock(c.req.raw, c.env),
      durations(c.env),
    )
    return changed ? c.json({ ok: true }) : problem(c, 409, "changed_meanwhile")
  })
}

admin.get("/attention", async (c) => {
  const cursor = parseCursor(c.req.query("cursor"))
  if (cursor === "invalid") return problem(c, 400, "invalid_input")
  const { items, next } = await attention(c.env.DB, cursor)
  return c.json({ ops: items, next })
})
