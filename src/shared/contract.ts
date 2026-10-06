import { z } from "zod"
import { CURATED_KINDS, PublicCurated } from "./curated"
import { cleanText } from "./text"

// No generated code: zod's probe for it (new Function) is an eval the site's policy refuses (spec 11), and the Worker's
// runtime refuses it too. The schemas here are small, so interpreting them costs nothing a visitor would notice.
z.config({ jitless: true })

/** Must match ADDABLE_KINDS in src/data/taxonomy.ts; a test keeps them equal. Communities are out of scope. */
export const SUBMITTABLE_KINDS = ["bench", "lookout", "grove", "garden", "plaque", "monument", "other"] as const

/**
 * The submission notices a form may record. Each is a key in NOTICES (src/data/legal.ts), with its own text; the last
 * is the one the add form shows now. A submission that names any other version is refused, so what is stored is
 * always a notice the site actually showed. A test keeps this list and the texts in step.
 *
 * Never remove a version, and add new ones at the end. A device may still retry a queued submission under an older
 * one (same body, same Idempotency-Key), and its consent record has to point to a text that exists. A wording change
 * is a new key in NOTICES, never an edit of an old one.
 */
export const SUBMISSION_NOTICES = [
  "notice.submission@2026-10-2",
  "notice.submission@2026-10-3",
  "notice.submission@2026-10-4",
  "notice.submission@2026-10-5",
  "notice.submission@2026-10-6",
  "notice.submission@2026-10-7",
  "notice.submission@2026-10-8",
  "notice.submission@2026-10-9",
  "notice.submission@2026-10-10",
  "notice.submission@2026-10-11",
  "notice.submission@2026-10-12",
  "notice.submission@2026-10-13",
] as const
export const CURRENT_SUBMISSION_NOTICE = SUBMISSION_NOTICES[SUBMISSION_NOTICES.length - 1]

export const text = ({ max, multiline = false }: { max: number; multiline?: boolean }) =>
  z
    .string()
    .transform((s, ctx) => {
      const clean = cleanText(s, { multiline })
      if (clean === null) ctx.addIssue({ code: "custom", message: "control_character" })
      return clean ?? ""
    })
    .pipe(z.string().min(1).max(max))

export const SubmissionInput = z
  .object({
    kind: z.enum(SUBMITTABLE_KINDS),
    name_he: text({ max: 80 }),
    lat: z.number().min(29.4).max(33.45),
    lng: z.number().min(34.2).max(35.95),
    place_he: text({ max: 80 }).optional(),
    in_memory_of: text({ max: 120 }).optional(),
    story_he: text({ max: 2000, multiline: true }).optional(),
    link_url: z
      .url({ protocol: /^https$/ })
      .max(300)
      .optional(),
    submitter_name: text({ max: 80 }).optional(),
    // Optional (spec 11). Only verified addresses hear anything private; it is never published.
    email: z.email().max(254).optional(),
    on_private_property: z.boolean().default(false),
    // On private property, the exact point is shown only with the owner's permission and a note on how to visit.
    location_permission: z.boolean().default(false),
    access_note_he: text({ max: 300 }).optional(),
    consent_version: z.enum(SUBMISSION_NOTICES),
  })
  .strict()
  .refine((s) => !s.location_permission || (s.on_private_property && !!s.access_note_he), { message: "access_note_required" })
export type SubmissionInput = z.infer<typeof SubmissionInput>

/** The sender's correction: the text fields again, whole, against the version they saw. The kind and point stay. */
export const RevisionInput = z
  .object({
    expectedRev: z.number().int(),
    name_he: text({ max: 80 }),
    place_he: text({ max: 80 }).optional(),
    in_memory_of: text({ max: 120 }).optional(),
    story_he: text({ max: 2000, multiline: true }).optional(),
    link_url: z
      .url({ protocol: /^https$/ })
      .max(300)
      .optional(),
    consent_version: z.enum(SUBMISSION_NOTICES),
  })
  .strict()
export type RevisionInput = z.infer<typeof RevisionInput>

export const PublicContribution = z.object({
  id: z.string(),
  kind: z.enum(SUBMITTABLE_KINDS),
  name_he: z.string(),
  lat: z.number(),
  lng: z.number(),
  precision: z.enum(["exact", "approx"]),
  place_he: z.string(),
  summary_he: z.string(),
  in_memory_of: z.string().optional(),
  link_url: z.string().optional(),
  /** How to visit a place on private property shown exactly, with its owner's permission. */
  access_note: z.string().optional(),
  /** Approved with its place; served by the Worker from public/. */
  photo: z.object({ url: z.string(), alt: z.string(), credit: z.string().optional() }).optional(),
})
export type PublicContribution = z.infer<typeof PublicContribution>

/** One of the operator's own places (phase 7): any kind, with its links, sources of coordinates and photos. */
export const PublicCuratedPlace = z.object({
  id: z.string(),
  kind: z.enum(CURATED_KINDS),
  name_he: z.string(),
  lat: z.number(),
  lng: z.number(),
  precision: z.enum(["exact", "approx"]),
  place_he: z.string(),
  summary_he: z.string(),
  curated: PublicCurated,
})
export type PublicCuratedPlace = z.infer<typeof PublicCuratedPlace>

// Curated first: a curated monument would also read as a contribution, without its own fields.
export const PublicPlace = z.union([PublicCuratedPlace, PublicContribution])
export type PublicPlace = z.infer<typeof PublicPlace>
export const isCurated = (p: PublicPlace): p is PublicCuratedPlace => "curated" in p && p.curated !== undefined

/** One anemone on its way to the shared count (spec 4): the place, and this device's random id, kept on the device. */
export const TributeInput = z.object({ placeId: z.string().min(1).max(64), deviceId: z.string().regex(/^[0-9a-f]{32}$/) }).strict()
export type TributeInput = z.infer<typeof TributeInput>
/** What the server did with it: counted now or before, or why not. The visitor's own flowers stay either way. */
export type TributeResult =
  | { counted: true; reason?: "replayed"; day: string }
  | { counted: false; reason: "already_today"; day: string }
  | { counted: false; reason: "not_published" }
/** The shared counts of published places, by id. */
export type TributeTotals = { totals: Record<string, number> }

/** What a removal or correction request may name on a place (spec 3.1, field_suppressions); "whole" is the place itself. */
export const ELEMENTS = ["name_he", "in_memory_of", "story_he", "photo", "whole"] as const
export type Element = (typeof ELEMENTS)[number]
export const REQUESTER_TYPES = ["family", "rights_holder", "other"] as const

/** The report notices a form may record, as for submissions: never removed, new ones at the end. */
export const REPORT_NOTICES = ["notice.report@2026-10-1", "notice.report@2026-10-2", "notice.report@2026-10-3"] as const
export const CURRENT_REPORT_NOTICE = REPORT_NOTICES[REPORT_NOTICES.length - 1]

/**
 * A request to remove or correct something on a place (spec 6, 10). Only what the form asks: no name, the email
 * optional. Whether it is complete enough for the automatic path is decided on the server; an incomplete one is still
 * accepted and reviewed by a person.
 */
export const ReportInput = z
  .object({
    placeId: z.string().min(1).max(64),
    elements: z
      .array(z.enum(ELEMENTS))
      .min(1)
      .max(ELEMENTS.length)
      .refine((e) => new Set(e).size === e.length, { message: "duplicate_element" }),
    requesterType: z.enum(REQUESTER_TYPES),
    relationship: text({ max: 200 }).optional(),
    explanation: text({ max: 2000, multiline: true }),
    email: z.email().max(254).optional(),
    noticeVersion: z.enum(REPORT_NOTICES),
  })
  .strict()
export type ReportInput = z.infer<typeof ReportInput>

/** hidden_for_review: the element is hidden as a precaution until a person decides; received: a person will review it. */
export const ReportResult = z.object({ ticket: z.string().min(1), outcome: z.enum(["hidden_for_review", "received"]) })
export type ReportResult = z.infer<typeof ReportResult>

export const Feed = z.object({ v: z.string(), places: z.array(PublicPlace) })
export type Feed = z.infer<typeof Feed>

/** Feed versions are "epoch.n"; the epoch moves only on a restore, so it compares first. */
export function parseVersion(v: string): { epoch: number; n: number } | null {
  const m = /^(\d+)\.(\d+)$/.exec(v)
  return m ? { epoch: +m[1], n: +m[2] } : null
}
export function isNewer(a: string, b: string): boolean {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) return false
  return x.epoch > y.epoch || (x.epoch === y.epoch && x.n > y.n)
}
