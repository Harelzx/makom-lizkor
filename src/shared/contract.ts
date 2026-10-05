import { z } from "zod"
import { cleanText } from "./text"

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
export const SUBMISSION_NOTICES = ["notice.submission@2026-10-2", "notice.submission@2026-10-3", "notice.submission@2026-10-4"] as const
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
    on_private_property: z.boolean().default(false),
    consent_version: z.enum(SUBMISSION_NOTICES),
  })
  .strict()
export type SubmissionInput = z.infer<typeof SubmissionInput>

export const PublicPlace = z.object({
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
})
export type PublicPlace = z.infer<typeof PublicPlace>

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
