import { ulid } from "../lib/ids"
import { ogState } from "../lib/og"
import { log } from "../lib/log"

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
): Promise<{ key: string | null; fresh: boolean; source: string | null }> {
  const rev = await db.prepare("SELECT photo_key FROM revisions WHERE id = ?").bind(revisionId).first<{ photo_key: string | null }>()
  const source = rev?.photo_key ?? null
  if (!source || source.startsWith("public/")) return { key: source, fresh: false, source }
  const object = await media.get(source)
  if (!object) return { key: null, fresh: false, source }
  const published = `public/${placeId}/${revisionId}-${ulid()}.jpg`
  await media.put(published, await object.arrayBuffer(), { httpMetadata: { contentType: "image/jpeg" } })
  return { key: published, fresh: true, source }
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
  // A curated revision's photos and thumbnails still waiting in quarantine: a refusal retires them with it (P7-RET-1).
  const { results } = await db
    .prepare(
      `SELECT key AS k FROM revision_photos WHERE revision_id = ?1 AND key LIKE 'quarantine/%'
       UNION SELECT thumb_key FROM revision_photos WHERE revision_id = ?1 AND thumb_key LIKE 'quarantine/%'`,
    )
    .bind(revisionId)
    .all<{ k: string }>()
  return {
    source: row?.source?.startsWith("quarantine/") ? row.source : null,
    published: row?.published ?? null,
    quarantined: results.map((r) => r.k),
  }
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
           WHERE r.state IN ('pending', 'returned', 'approved') AND p.status NOT IN ('withdrawn', 'erased')
             AND (r.photo_key = ?1 OR EXISTS (SELECT 1 FROM revision_photos rp WHERE rp.revision_id = r.id AND ?1 IN (rp.key, rp.thumb_key)))`,
        )
        .bind(key)
        .first()
      if (!named) obsolete.push(key)
    }
    // A photo hidden while it was published sits in held/ under the same name: it goes with its public key.
    await deleteKeys(media, [...obsolete, ...obsolete.filter((k) => k.startsWith("public/")).map((k) => k.replace(/^public\//, "held/"))])
    return true
  } catch (err) {
    log("error", "photo_cleanup", { error: (err as Error).name })
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
  for (const prefix of [`quarantine/${placeId}/`, `public/${placeId}/`, `held/${placeId}/`, `og/${placeId}/`]) {
    await deleteKeys(media, await keysUnder(media, prefix))
  }
}

/**
 * The files no live revision names any more: what a lost race, a failed cleanup or a late write left behind (L2,
 * F4-R10). Scheduled in every pass. A file goes only when all of these hold:
 * - neither it nor its twin (the same photo in public/ or held/, which a hide or a restoration moves between) is named
 *   by a revision that is open (pending, returned) or published, of a place not withdrawn or erased;
 * - it was written more than an hour ago: an upload writes its file and names it in the same request;
 * - for a place that can still have live photos, no operation on it is unfinished: an approval copies its photo before
 *   the decision names it, and a decision whose file step failed still owes it (the job finishes it, then the sweep may
 *   look). A move between public/ and held/ only ever writes the twin of a named photo, which is kept anyway, so a photo
 *   watch (standing while a place has a photo) holds nothing back. A withdrawn or erased place has nothing live:
 *   whatever lands for it is exactly what must go.
 * Returns how many files it removed.
 */
export async function sweepPhotos(db: D1Database, media: R2Bucket, now: Date) {
  const [named, busy, gone] = await db.batch([
    // A curated revision's photos and thumbnails are named like a contribution's photo (phase 7).
    db.prepare(
      `SELECT r.photo_key AS k FROM revisions r JOIN places p ON p.id = r.place_id
       WHERE r.photo_key IS NOT NULL AND r.state IN ('pending', 'returned', 'approved') AND p.status NOT IN ('withdrawn', 'erased')
       UNION ALL
       SELECT k FROM (SELECT rp.key AS k, r.state, p.status FROM revision_photos rp JOIN revisions r ON r.id = rp.revision_id JOIN places p ON p.id = r.place_id
                      UNION ALL
                      SELECT rp.thumb_key, r.state, p.status FROM revision_photos rp JOIN revisions r ON r.id = rp.revision_id JOIN places p ON p.id = r.place_id)
       WHERE state IN ('pending', 'returned', 'approved') AND status NOT IN ('withdrawn', 'erased')`,
    ),
    db.prepare("SELECT place_id AS k FROM visibility_ops WHERE state = 'pending' OR media IN ('pending', 'failed')"),
    db.prepare("SELECT id AS k FROM places WHERE status IN ('withdrawn', 'erased')"),
  ])
  const keys = (r: D1Result) => new Set((r.results as { k: string }[]).map((x) => x.k))
  const live = keys(named)
  const inFlight = keys(busy)
  const ended = keys(gone)
  const twin = (key: string) =>
    key.startsWith("public/") ? key.replace(/^public\//, "held/") : key.startsWith("held/") ? key.replace(/^held\//, "public/") : key
  const settled = now.getTime() - 3600 * 1000
  let removed = 0
  for (const prefix of ["quarantine/", "public/", "held/"]) {
    let cursor: string | undefined
    do {
      const page = await media.list({ prefix, cursor })
      const stray = page.objects
        .filter((o) => {
          const place = o.key.split("/")[1]
          if (live.has(o.key) || live.has(twin(o.key)) || o.uploaded.getTime() >= settled) return false
          return ended.has(place) || !inFlight.has(place)
        })
        .map((o) => o.key)
      await deleteKeys(media, stray)
      removed += stray.length
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
  }
  // Share images (L4): every one that isn't its place's current image, once an hour old (a render under way writes
  // its file before its last check), a withdrawn or erased place's all of them.
  const current = new Map<string, string | null>()
  let cursor: string | undefined
  do {
    const page = await media.list({ prefix: "og/", cursor })
    const stale: string[] = []
    for (const o of page.objects) {
      if (o.uploaded.getTime() >= settled) continue
      const [, place, file] = o.key.split("/")
      if (!current.has(place)) current.set(place, (await ogState(db, place))?.hash ?? null)
      if (file !== `${current.get(place)}.png`) stale.push(o.key)
    }
    await deleteKeys(media, stale)
    removed += stale.length
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return removed
}
