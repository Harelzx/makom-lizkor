import type { CuratedInput } from "@/shared/curated"
import { sha256Hex, ulid } from "../lib/ids"

/**
 * A moderator's write of a curated record (phase 7): stored as a pending revision with its photos and sources, in one
 * batch, then published by the same approval as a contribution's (routes/admin.ts), so the ledger, hiding, restore and
 * replay cover it. A new place and its first revision are written together; an edit is a new revision of a curated
 * place at the rev the moderator saw. The Idempotency-Key's hash on the revision lets a retry find what it wrote.
 */

export type Stored =
  { kind: "stored" | "replay"; revisionId: string; created: boolean } | { kind: "conflict" | "contribution" | "mismatch" | "photo_unknown" }

/** Each photo by a key its upload gave this place (quarantine/<id>/), or one its published record already shows. */
async function photosKnown(db: D1Database, media: R2Bucket, input: CuratedInput) {
  const published = new Set(
    (
      await db
        .prepare(
          `SELECT rp.key, rp.thumb_key FROM places p JOIN revision_photos rp ON rp.revision_id = p.published_revision_id
           WHERE p.id = ? AND p.origin = 'curated'`,
        )
        .bind(input.id)
        .all<{ key: string; thumb_key: string }>()
    ).results.flatMap((r) => [r.key, r.thumb_key]),
  )
  for (const p of input.photos)
    for (const key of [p.key, p.thumb_key]) {
      if (published.has(key)) continue
      if (!key.startsWith(`quarantine/${input.id}/`) || !(await media.head(key))) return false
    }
  return true
}

export async function storeCurated(db: D1Database, media: R2Bucket, input: CuratedInput, key: string, now: Date): Promise<Stored> {
  const keyHash = await sha256Hex(`curated:${key}`)
  const bodyHash = await sha256Hex(JSON.stringify(input))
  const prior = await db
    .prepare("SELECT id, place_id, request_body_hash FROM revisions WHERE request_key_hash = ?")
    .bind(keyHash)
    .first<{ id: string; place_id: string; request_body_hash: string }>()
  if (prior)
    return prior.request_body_hash === bodyHash && prior.place_id === input.id
      ? { kind: "replay", revisionId: prior.id, created: input.expectedRev === 0 }
      : { kind: "mismatch" }

  const place = await db.prepare("SELECT origin FROM places WHERE id = ?").bind(input.id).first<{ origin: string }>()
  if (place && place.origin !== "curated") return { kind: "contribution" }
  if (!(await photosKnown(db, media, input))) return { kind: "photo_unknown" }

  const at = now.toISOString()
  const revisionId = `r_${ulid(now.getTime())}`
  const created = !place
  if (created && input.expectedRev !== 0) return { kind: "conflict" }
  // The edit's guard: a curated place at the rev the moderator saw, published or hidden, with no revision waiting.
  const editable = `EXISTS (SELECT 1 FROM places WHERE id = ?1 AND origin = 'curated' AND rev = ?2 AND status IN ('published', 'hidden'))
    AND NOT EXISTS (SELECT 1 FROM revisions WHERE place_id = ?1 AND state = 'pending')`
  const written = "EXISTS (SELECT 1 FROM revisions WHERE id = ?3)"
  const statements: D1PreparedStatement[] = []
  if (created)
    statements.push(
      db
        .prepare("INSERT INTO places (id, origin, status, rev, created_at, status_changed_at) VALUES (?1, 'curated', 'pending', 0, ?2, ?2)")
        .bind(input.id, at),
    )
  statements.push(
    db
      .prepare(
        `INSERT INTO revisions (id, place_id, n, state, kind, name_he, lat, lng, location_precision, place_he, story_he, curated,
           created_at, request_key_hash, request_body_hash)
         SELECT ?3, ?1, COALESCE((SELECT MAX(n) FROM revisions WHERE place_id = ?1), 0) + 1, 'pending', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
           ?12, ?13, ?14
         WHERE ${created ? "?2 = 0" : editable}`,
      )
      .bind(
        input.id,
        input.expectedRev,
        revisionId,
        input.kind,
        input.name_he,
        input.lat,
        input.lng,
        input.precision === "approx" ? "approximate" : "exact",
        input.place_he,
        input.summary_he,
        JSON.stringify(input.curated),
        at,
        keyHash,
        bodyHash,
      ),
  )
  input.photos.forEach((p, idx) =>
    statements.push(
      db
        .prepare(
          `INSERT INTO revision_photos (revision_id, idx, key, thumb_key, title, author, license, license_url, commons_url, subject_he)
           SELECT ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12 WHERE ${written}`,
        )
        .bind(
          input.id,
          input.expectedRev,
          revisionId,
          idx,
          p.key,
          p.thumb_key,
          p.title,
          p.author,
          p.license,
          p.license_url ?? null,
          p.commons_url ?? null,
          p.subject_he ?? null,
        ),
    ),
  )
  for (const s of input.sources)
    statements.push(
      db
        .prepare(
          `INSERT INTO place_sources (id, place_id, revision_id, field, photo_idx, source, license, url, retrieved_at, retrieved_approx)
           SELECT ?4, ?1, ?3, ?5, ?6, ?7, ?8, ?9, ?10, ?11 WHERE ${written}`,
        )
        .bind(
          input.id,
          input.expectedRev,
          revisionId,
          `s_${ulid(now.getTime())}`,
          s.field,
          s.photo_idx ?? null,
          s.source,
          s.license ?? null,
          s.url ?? null,
          s.retrieved_at ?? null,
          s.retrieved_approx ? 1 : 0,
        ),
    )
  try {
    await db.batch(statements)
  } catch (err) {
    // Two moderators creating the same place: the second's insert of the place fails, and nothing of it is written.
    if (created && /UNIQUE|constraint/i.test(String((err as Error).message))) return { kind: "conflict" }
    throw err
  }
  const stored = await db.prepare("SELECT 1 FROM revisions WHERE id = ?").bind(revisionId).first()
  return stored ? { kind: "stored", revisionId, created } : { kind: "conflict" }
}

/**
 * Before the approval of a curated revision: each photo and thumbnail still in quarantine/ copied to public/ under a
 * key of its own, so the decision publishes the place and its photos in one step. A kept photo (already public/)
 * stays. Returns the keys the approval sets, the copies it made (removed again if it never lands) and the quarantined
 * originals it makes obsolete.
 */
export async function prepareCuratedPhotos(db: D1Database, media: R2Bucket, placeId: string, revisionId: string) {
  const { results } = await db
    .prepare("SELECT idx, key, thumb_key FROM revision_photos WHERE revision_id = ? ORDER BY idx")
    .bind(revisionId)
    .all<{ idx: number; key: string; thumb_key: string }>()
  const keys: { idx: number; key: string; thumb_key: string }[] = []
  const prepared: string[] = []
  const originals: string[] = []
  const publish = async (from: string) => {
    if (from.startsWith("public/")) return from
    const object = await media.get(from)
    if (!object) throw new Error("photo_missing")
    const ext = from.endsWith(".jpg") ? "jpg" : "webp"
    const to = `public/${placeId}/${revisionId}-${ulid()}${from.includes(".thumb.") ? ".thumb" : ""}.${ext}`
    await media.put(to, await object.arrayBuffer(), { httpMetadata: { contentType: ext === "jpg" ? "image/jpeg" : "image/webp" } })
    prepared.push(to)
    originals.push(from)
    return to
  }
  for (const r of results) keys.push({ idx: r.idx, key: await publish(r.key), thumb_key: await publish(r.thumb_key) })
  return { keys, prepared, originals }
}

/** The approval's statement that names the published copies, in the same step as the place (ops.ts statements). */
export function curatedKeyStatements(
  db: D1Database,
  placeId: string,
  revisionId: string,
  keys: { idx: number; key: string; thumb_key: string }[],
  tid: string,
) {
  return keys.map((k) =>
    db
      .prepare(
        `UPDATE revision_photos SET key = ?4, thumb_key = ?5
         WHERE revision_id = ?3 AND idx = ?6 AND EXISTS (SELECT 1 FROM places WHERE id = ?1 AND last_transition_id = ?2)`,
      )
      .bind(placeId, tid, revisionId, k.key, k.thumb_key, k.idx),
  )
}

/** Every file key a revision names: a contribution's photo, or a curated revision's photos and thumbnails. */
export async function revisionKeys(db: D1Database, revisionId: string | null): Promise<string[]> {
  if (!revisionId) return []
  const [one, many] = await db.batch([
    db.prepare("SELECT photo_key AS k FROM revisions WHERE id = ? AND photo_key IS NOT NULL").bind(revisionId),
    db
      .prepare(
        "SELECT key AS k FROM revision_photos WHERE revision_id = ?1 UNION ALL SELECT thumb_key FROM revision_photos WHERE revision_id = ?1",
      )
      .bind(revisionId),
  ])
  return [...(one.results as { k: string }[]), ...(many.results as { k: string }[])].map((r) => r.k)
}
