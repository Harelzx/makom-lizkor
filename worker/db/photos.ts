import { ulid } from "../lib/ids"

/**
 * A place's photo files after upload: copied to public/ for an approval, retired when a decision makes them obsolete,
 * erased with a withdrawal, and swept when nothing names them. Where a published photo sits (public/ or held/) is
 * placePhoto's, in ops.ts.
 */

/**
 * Before an approval: the revision's photo copied from quarantine/ to public/, so the decision can publish the place and
 * its photo in one step (the feed never names a photo that isn't there). Returns the key the approved revision will
 * hold: the new public one, the public one a correction inherited, or null when the photo was lost (published without
 * it rather than with a key that serves nothing). A copy that fails throws, and nothing is decided.
 *
 * `fresh` says the copy was made by this attempt, under a key of its own: if the decision then loses (another moderator
 * decided first), only that copy goes, never the one the winning approval published.
 */
export async function preparePhoto(
  db: D1Database,
  media: R2Bucket,
  placeId: string,
  revisionId: string,
): Promise<{ key: string | null; fresh: boolean }> {
  const rev = await db.prepare("SELECT photo_key FROM revisions WHERE id = ?").bind(revisionId).first<{ photo_key: string | null }>()
  const key = rev?.photo_key ?? null
  if (!key || key.startsWith("public/")) return { key, fresh: false }
  const object = await media.get(key)
  if (!object) return { key: null, fresh: false }
  const published = `public/${placeId}/${revisionId}-${ulid()}.jpg`
  await media.put(published, await object.arrayBuffer(), { httpMetadata: { contentType: "image/jpeg" } })
  return { key: published, fresh: true }
}

/**
 * The files a decision on a revision may make obsolete, read before it is made: the revision's own photo while it
 * waits in quarantine, and the photo of the revision published until now.
 */
export async function photosBefore(db: D1Database, placeId: string, revisionId: string) {
  const row = await db
    .prepare(
      `SELECT r.photo_key AS source, pub.photo_key AS published
       FROM revisions r JOIN places p ON p.id = r.place_id LEFT JOIN revisions pub ON pub.id = p.published_revision_id
       WHERE r.id = ? AND p.id = ?`,
    )
    .bind(revisionId, placeId)
    .first<{ source: string | null; published: string | null }>()
  return { source: row?.source?.startsWith("quarantine/") ? row.source : null, published: row?.published ?? null }
}

/**
 * After a decision is stored, exactly the files it made obsolete, and only if no open or published revision names
 * them now: an approval retires the quarantined original it copied and the photo published until now (unless the
 * revision kept it); a rejection, the refused photo (spec 3.3). A returned revision keeps its photo. Anything else a
 * place has (a newer correction's photo, another approval's copy in flight) is not this decision's to remove; what
 * nothing names is left to the sweep. Never throws: false when a file couldn't go now, for a caller that retries.
 */
export async function retirePhotos(db: D1Database, media: R2Bucket, keys: (string | null | undefined)[]): Promise<boolean> {
  try {
    const obsolete: string[] = []
    for (const key of new Set(keys)) {
      if (!key) continue
      const named = await db
        .prepare(
          `SELECT 1 FROM revisions r JOIN places p ON p.id = r.place_id
           WHERE r.photo_key = ? AND r.state IN ('pending', 'returned', 'approved') AND p.status NOT IN ('withdrawn', 'erased')`,
        )
        .bind(key)
        .first()
      if (!named) obsolete.push(key)
    }
    // A photo hidden while it was published sits in held/ under the same name: it goes with its public key.
    await deleteKeys(media, [...obsolete, ...obsolete.filter((k) => k.startsWith("public/")).map((k) => k.replace(/^public\//, "held/"))])
    return true
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "photo_cleanup", error: (err as Error).name }))
    return false
  }
}

/** R2 deletes at most 1000 keys per call (Workers API reference), so a long list goes in parts. */
async function deleteKeys(media: R2Bucket, keys: string[]) {
  for (let i = 0; i < keys.length; i += 1000) await media.delete(keys.slice(i, i + 1000))
}

/** Every key under a prefix, page after page: R2 cuts a long listing short and says where to go on. */
async function keysUnder(media: R2Bucket, prefix: string): Promise<string[]> {
  const keys: string[] = []
  let cursor: string | undefined
  do {
    const page = await media.list({ prefix, cursor })
    keys.push(...page.objects.map((o) => o.key))
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return keys
}

/** Whether any file of a place is still stored, in quarantine, public or held. */
export async function photosRemain(media: R2Bucket, placeId: string): Promise<boolean> {
  for (const prefix of [`quarantine/${placeId}/`, `public/${placeId}/`, `held/${placeId}/`])
    if ((await media.list({ prefix, limit: 1 })).objects.length) return true
  return false
}

/** Every file of a place, in quarantine, public and held alike: a withdrawal erases them all at once. */
export async function erasePhotos(media: R2Bucket, placeId: string) {
  for (const prefix of [`quarantine/${placeId}/`, `public/${placeId}/`, `held/${placeId}/`]) {
    await deleteKeys(media, await keysUnder(media, prefix))
  }
}

/**
 * The files no live revision names any more: what a lost race or a failed cleanup left behind. Kept: every photo an
 * open revision (pending or returned) or a published one points to. A file younger than an hour is left alone, since an
 * approval copies its photo before it records it.
 *
 * Not scheduled yet, and not safe to schedule as it is (Phase 5, L2): it doesn't cover held/, where it must keep the
 * held twin of every key it keeps; and an age alone doesn't show that a writer has finished (an approval's copy made
 * before its key is recorded, an upload, a late move). Phase 5 sets the rule and schedules it.
 */
export async function sweepPhotos(db: D1Database, media: R2Bucket, now: Date) {
  const { results } = await db
    .prepare(
      `SELECT r.photo_key FROM revisions r JOIN places p ON p.id = r.place_id
       WHERE r.photo_key IS NOT NULL AND r.state IN ('pending', 'returned', 'approved') AND p.status NOT IN ('withdrawn', 'erased')`,
    )
    .all<{ photo_key: string }>()
  const named = new Set(results.map((r) => r.photo_key))
  const settled = now.getTime() - 3600 * 1000
  for (const prefix of ["quarantine/", "public/"]) {
    let cursor: string | undefined
    do {
      const page = await media.list({ prefix, cursor })
      await deleteKeys(
        media,
        page.objects.filter((o) => !named.has(o.key) && o.uploaded.getTime() < settled).map((o) => o.key),
      )
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
  }
}
