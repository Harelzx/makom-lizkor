import { z } from "zod"

/**
 * Curated records (spec 3, 9; phase 7): the operator's own places, kept in D1 beside contributions. What only they
 * carry is here, shared by the Worker (storing and projecting them) and the client (reading them from the feed).
 */

export const CURATED_KINDS = [
  "community",
  "monument",
  "lookout",
  "grove",
  "garden",
  "plaque",
  "shelter",
  "site",
  "museum",
  "bench",
  "other",
] as const

const link = z.object({ label_he: z.string().min(1).max(200), url: z.url({ protocol: /^https$/ }).max(500) }).strict()

/** A community's return after the attack (spec: the community pages), with its own sources. */
export const Revival = z
  .object({
    status: z.enum(["full", "partial", "not-yet", "unknown"]),
    date: z.string().max(40).nullable().optional(),
    note_he: z.string().max(2000).optional(),
    milestones_he: z.array(z.string().max(500)).max(40),
    revival_he: z.string().max(4000),
    sources: z.array(link).max(40),
    confidence: z.enum(["high", "medium", "low"]),
  })
  .strict()

/** Stored as revisions.curated; photos are rows of their own (revision_photos), served and hidden by key. */
export const CuratedFields = z
  .object({
    established: z.number().int().min(1800).max(2100).nullable().optional(),
    links: z.array(link).max(20),
    // Where the coordinates came from, as recorded: manual stays manual (a50), never relabelled a survey.
    coord_source: z.enum(["osm", "wikidata", "manual"]),
    coord_source_url: z
      .url({ protocol: /^https$/ })
      .max(500)
      .optional(),
    region: z.enum(["envelope", "country"]),
    revival: Revival.optional(),
  })
  .strict()
export type CuratedFields = z.infer<typeof CuratedFields>

/** A photo's credit (TASL), as stored with it and shown under it. */
export const CuratedPhotoMeta = z
  .object({
    title: z.string().min(1).max(300),
    author: z.string().min(1).max(300),
    license: z.string().min(1).max(100),
    license_url: z
      .url({ protocol: /^https$/ })
      .max(500)
      .optional(),
    commons_url: z
      .url({ protocol: /^https$/ })
      .max(500)
      .optional(),
    subject_he: z.string().max(300).optional(),
  })
  .strict()
export type CuratedPhotoMeta = z.infer<typeof CuratedPhotoMeta>

/** One row of place_sources: where a field came from and under what licence (spec 9). */
export const PlaceSource = z
  .object({
    field: z.enum(["coords", "text", "photo", "revival"]),
    photo_idx: z.number().int().min(0).optional(),
    source: z.enum(["osm", "wikidata", "commons", "manual", "survey", "operator", "web", "contributor"]),
    license: z.string().max(100).optional(),
    url: z
      .url({ protocol: /^https$/ })
      .max(500)
      .optional(),
    retrieved_at: z.string().max(40).optional(),
    // A date taken from the repository, not one seen when the source was read (a50).
    retrieved_approx: z.boolean(),
  })
  .strict()
  .refine((s) => (s.field === "photo") === (s.photo_idx !== undefined), { message: "photo_idx belongs to photo sources only" })
export type PlaceSource = z.infer<typeof PlaceSource>

/**
 * What a curated revision still lacks before it may be published (spec 3: "publishing one requires place_sources"):
 * a source for its coordinates, its text, each photo by index and a community's return. Empty when it may be.
 * The importer and the moderators' route both ask this one question.
 */
export function curatedSourceProblems(fields: CuratedFields, photos: readonly unknown[], sources: readonly PlaceSource[]): string[] {
  const has = (field: PlaceSource["field"], idx?: number) =>
    sources.some((s) => s.field === field && (idx === undefined || s.photo_idx === idx))
  const problems: string[] = []
  if (!has("coords")) problems.push("coords")
  if (!has("text")) problems.push("text")
  photos.forEach((_, i) => !has("photo", i) && problems.push(`photo:${i}`))
  if (fields.revival && !has("revival")) problems.push("revival")
  for (const s of sources) if (s.field === "photo" && s.photo_idx! >= photos.length) problems.push(`photo:${s.photo_idx}:no_photo`)
  return problems
}

/** A curated place as the public sees it: its own fields, and each photo through the media route with its credit. */
export const PublicCurated = CuratedFields.extend({
  photos: z.array(CuratedPhotoMeta.extend({ url: z.string(), thumb_url: z.string() }).strict()),
}).strict()
export type PublicCurated = z.infer<typeof PublicCurated>

/** A curated place's id: the slug it has always had in links (#/place/<id>, /place/<id>). */
export const CURATED_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

/**
 * A moderator's create or edit of a curated record (POST /api/admin/places): the whole record as it should be
 * published, each photo by the key its upload got (quarantine/, or public/ for one the published record already shows),
 * and the sources. expectedRev is 0 for a new place.
 */
export const CuratedInput = z
  .object({
    id: z.string().regex(CURATED_ID),
    expectedRev: z.number().int().min(0),
    kind: z.enum(CURATED_KINDS),
    name_he: z.string().min(1).max(200),
    lat: z.number().min(29.4).max(33.4),
    lng: z.number().min(34.2).max(35.9),
    precision: z.enum(["exact", "approx"]),
    place_he: z.string().max(200),
    summary_he: z.string().min(20).max(4000),
    curated: CuratedFields,
    photos: z.array(CuratedPhotoMeta.extend({ key: z.string().max(200), thumb_key: z.string().max(200) }).strict()).max(12),
    sources: z.array(PlaceSource).min(1).max(80),
  })
  .strict()
export type CuratedInput = z.infer<typeof CuratedInput>
