import type { Feed, PublicPlace, RevisionInput, SubmissionInput } from "@/shared/contract"
import { newToken, placeId, sameHash, sha256Hex, ulid } from "../lib/ids"
import { stripJpeg } from "../lib/jpeg"

// An approximation of a month; phase 5 replaces it with calendar months read from RETENTION (src/config.ts).
const MONTH_MS = 30 * 24 * 3600 * 1000

export type Inserted =
  /** `verifyToken`: the email verification link's secret, when an address was given; only its hash is stored. */
  | { kind: "created"; id: string; trackingToken: string; verifyToken?: string }
  | { kind: "replayed"; id: string; trackingToken: string }
  | { kind: "mismatch" }

const VERIFY_DAYS = 7

export async function insertSubmission(db: D1Database, input: SubmissionInput, key: string, now: Date): Promise<Inserted> {
  const keyHash = await sha256Hex(key)
  // The input after Zod, so the same request always gives the same fingerprint.
  const bodyHash = await sha256Hex(JSON.stringify(input))
  const id = placeId(now.getTime())
  const trackingToken = newToken()
  const at = now.toISOString()
  // On private property without the owner's permission, only a point rounded to about a kilometre is ever stored
  // (spec 4): the exact one never reaches the database, the moderators or a backup.
  const exact = !input.on_private_property || input.location_permission
  const precision = exact ? "exact" : "approximate"
  const round = (v: number) => Math.round(v * 100) / 100
  const stmts = [
    db
      .prepare(
        `INSERT INTO places (id, origin, status, rev, tracking_token_hash, submit_key_hash, submit_body_hash, created_at, status_changed_at)
         VALUES (?, 'contribution', 'pending', 1, ?, ?, ?, ?, ?)`,
      )
      .bind(id, await sha256Hex(trackingToken), keyHash, bodyHash, at, at),
    db
      .prepare(
        `INSERT INTO revisions (id, place_id, n, state, kind, name_he, lat, lng, location_precision, on_private_property, location_permission_at,
           access_note_he, place_he, in_memory_of, story_he, link_url, consent_version, created_at)
         VALUES (?, ?, 1, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        `r_${ulid(now.getTime())}`,
        id,
        input.kind,
        input.name_he,
        exact ? input.lat : round(input.lat),
        exact ? input.lng : round(input.lng),
        precision,
        input.on_private_property ? 1 : 0,
        input.on_private_property && input.location_permission ? at : null,
        input.on_private_property && input.location_permission ? (input.access_note_he ?? null) : null,
        input.place_he ?? null,
        input.in_memory_of ?? null,
        input.story_he ?? null,
        input.link_url ?? null,
        input.consent_version,
        at,
      ),
  ]
  // The submitter's name and email are personal data: they live with the contacts, under a fixed deletion ceiling.
  const verifyToken = input.email ? newToken() : undefined
  if (input.submitter_name || input.email) {
    const ceiling = new Date(now.getTime() + 12 * MONTH_MS).toISOString()
    const expires = new Date(now.getTime() + VERIFY_DAYS * 24 * 3600 * 1000).toISOString()
    stmts.push(
      db
        .prepare(
          `INSERT INTO contacts (id, place_id, name, email, email_verify_hash, email_verify_expires, consent_version, created_at, ceiling_at, purge_after)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          `c_${ulid(now.getTime())}`,
          id,
          input.submitter_name ?? null,
          input.email ?? null,
          verifyToken ? await sha256Hex(verifyToken) : null,
          verifyToken ? expires : null,
          input.consent_version,
          at,
          ceiling,
          ceiling,
        ),
    )
  }
  // One batch is one transaction: a place never exists without its first revision, and a used key adds nothing.
  try {
    await db.batch(stmts)
    return { kind: "created", id, trackingToken, verifyToken }
  } catch (err) {
    if (!String(err).includes("places.submit_key_hash")) throw err
  }
  // The key was used before: the same submission sent again (its answer was lost), or a different one reusing it.
  const prior = await db
    .prepare("SELECT id, submit_body_hash AS body FROM places WHERE submit_key_hash = ?")
    .bind(keyHash)
    .first<{ id: string; body: string }>()
  if (!prior || prior.body !== bodyHash) return { kind: "mismatch" }
  // Only the hash of the first token exists, so the retry gets a fresh one; the first never reached the browser.
  const fresh = newToken()
  await db
    .prepare("UPDATE places SET tracking_token_hash = ? WHERE id = ?")
    .bind(await sha256Hex(fresh), prior.id)
    .run()
  return { kind: "replayed", id: prior.id, trackingToken: fresh }
}

/** The place, if `token` is its tracking capability; null for an unknown id and a wrong token alike. */
async function tracked(db: D1Database, id: string, token: string) {
  const row = await db
    .prepare("SELECT status, rev, tracking_token_hash AS h FROM places WHERE id = ?")
    .bind(id)
    .first<{ status: string; rev: number; h: string | null }>()
  if (!row) return null
  const hash = await sha256Hex(token)
  if (row.h && (await sameHash(row.h, hash))) return row
  // The tracking link sent to a verified email is a second capability for the same place, erased with the contact.
  const mailed = await db
    .prepare("SELECT email_token_hash AS h FROM contacts WHERE place_id = ? AND email_token_hash IS NOT NULL")
    .bind(id)
    .first<{ h: string }>()
  return mailed && (await sameHash(mailed.h, hash)) ? row : null
}

/**
 * The sender confirms their address from the link in the verification mail. The first confirmation mints the email's
 * own tracking token, so the mail that follows can carry a tracking link; a second click changes nothing.
 */
export async function verifyEmail(
  db: D1Database,
  token: string,
  now: Date,
): Promise<{ first: true; to: string; placeId: string; emailToken: string } | { first: false } | null> {
  const row = await db
    .prepare("SELECT id, place_id, email, email_verified_at, email_verify_expires FROM contacts WHERE email_verify_hash = ?")
    .bind(await sha256Hex(token))
    .first<{ id: string; place_id: string | null; email: string | null; email_verified_at: string | null; email_verify_expires: string }>()
  if (!row?.email || !row.place_id || row.email_verify_expires < now.toISOString()) return null
  if (row.email_verified_at) return { first: false }
  const emailToken = newToken()
  const done = await db
    .prepare("UPDATE contacts SET email_verified_at = ?, email_token_hash = ? WHERE id = ? AND email_verified_at IS NULL")
    .bind(now.toISOString(), await sha256Hex(emailToken), row.id)
    .run()
  // Two clicks at once: only the one that verified sends the tracking link.
  return done.meta.changes === 1 ? { first: true, to: row.email, placeId: row.place_id, emailToken } : { first: false }
}

/** The verified address to tell about a decision, with the place's current name; null when there is none to tell. */
export async function verifiedContact(db: D1Database, placeId: string) {
  return db
    .prepare(
      `SELECT c.email AS email, (SELECT name_he FROM revisions WHERE place_id = c.place_id ORDER BY n DESC LIMIT 1) AS name_he
       FROM contacts c WHERE c.place_id = ? AND c.email IS NOT NULL AND c.email_verified_at IS NOT NULL`,
    )
    .bind(placeId)
    .first<{ email: string; name_he: string | null }>()
}

export async function submissionStatus(db: D1Database, id: string, token: string) {
  const row = await tracked(db, id, token)
  if (!row) return null
  // The name the sender sees: the published one while a place is live (a correction may be waiting or refused),
  // otherwise the newest revision's. A withdrawn place has none left. A returned revision brings the moderator's note.
  const [latest, published] = await db.batch([
    db
      .prepare(
        "SELECT name_he, place_he, in_memory_of, story_he, link_url, state, decision_note FROM revisions WHERE place_id = ? ORDER BY n DESC LIMIT 1",
      )
      .bind(id),
    db.prepare("SELECT r.name_he FROM places p JOIN revisions r ON r.id = p.published_revision_id WHERE p.id = ?").bind(id),
  ])
  const last = latest.results[0] as
    | {
        name_he: string | null
        place_he: string | null
        in_memory_of: string | null
        story_he: string | null
        link_url: string | null
        state: string
        decision_note: string | null
      }
    | undefined
  const live = (published.results[0] as { name_he: string } | undefined)?.name_he
  return {
    status: row.status,
    rev: row.rev,
    name_he: (row.status === "published" ? live : last?.name_he) ?? null,
    revision_state: last?.state,
    ...(last?.state === "returned" && last.decision_note ? { note: last.decision_note } : {}),
    // What a correction starts from: the newest text the sender wrote.
    ...(last?.name_he
      ? {
          draft: {
            name_he: last.name_he,
            place_he: last.place_he,
            in_memory_of: last.in_memory_of,
            story_he: last.story_he,
            link_url: last.link_url,
          },
        }
      : {}),
  }
}

/**
 * The sender takes the place back, from any state: its content, its photo and the sender's name go at once, and a
 * tombstone with the status stays (spec 3.3). The same compare-and-set as a moderator's decision; a published place
 * also leaves the feed. Sending it again is harmless.
 */
export async function withdraw(db: D1Database, id: string, token: string, now: Date): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await tracked(db, id, token)
    if (!row) return false
    if (row.status === "withdrawn" || row.status === "erased") return true
    const tid = `t_${ulid(now.getTime())}`
    const at = now.toISOString()
    const happened = "EXISTS (SELECT 1 FROM places WHERE id = ?1 AND last_transition_id = ?2)"
    const [placeUpdate] = await db.batch([
      db
        .prepare(
          `UPDATE places SET status = 'withdrawn', rev = rev + 1, last_transition_id = ?2, status_changed_at = ?3, published_revision_id = NULL
           WHERE id = ?1 AND rev = ?4`,
        )
        .bind(id, tid, at, row.rev),
      db
        .prepare(
          `UPDATE revisions SET state = 'withdrawn', kind = NULL, name_he = NULL, lat = NULL, lng = NULL, location_precision = NULL,
             on_private_property = 0, location_permission_at = NULL, access_note_he = NULL, place_he = NULL, in_memory_of = NULL,
             story_he = NULL, link_url = NULL, decision_note = NULL, decided_at = ?3
           WHERE place_id = ?1 AND ${happened}`,
        )
        .bind(id, tid, at),
      db.prepare(`DELETE FROM contacts WHERE place_id = ?1 AND ${happened}`).bind(id, tid),
      db
        .prepare(`UPDATE feed_state SET n = n + 1, changed_at = ?3 WHERE id = 1 AND ?4 = 'published' AND ${happened}`)
        .bind(id, tid, at, row.status),
      db
        .prepare(
          `INSERT INTO audit_log (id, at, actor, action, entity_id, fields) SELECT ?3, ?4, 'submitter', 'withdraw', ?1, 'status' WHERE ${happened}`,
        )
        .bind(id, tid, `a_${ulid(now.getTime())}`, at),
    ])
    if (placeUpdate.meta.changes === 1) return true
    // A moderator decided at the same moment: read the place again and withdraw what it is now.
  }
  return false
}

/** Everything a moderator approves is on screen: every field the feed would publish. */
export async function listQueue(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.rev, r.id AS revisionId, r.kind, r.name_he, r.lat, r.lng, r.location_precision, r.place_he, r.in_memory_of, r.story_he,
         r.link_url, p.created_at, p.status = 'published' AS correction,
         CASE WHEN r.photo_key IS NOT NULL THEN '/api/admin/media/' || r.photo_key END AS photo_url, r.photo_alt, r.photo_credit
       FROM places p JOIN revisions r ON r.place_id = p.id AND r.state = 'pending'
       WHERE p.status IN ('pending', 'published') ORDER BY r.created_at`,
    )
    .all()
  return results
}

/**
 * A compare-and-set on the place's rev: two moderators deciding at once can't both win. Every later statement
 * checks the transition id this request wrote, so the revisions, the feed version and the audit row move only
 * if this transition actually happened.
 *
 * The revision decided is a first submission (the place is pending) or a correction of a published place. A correction
 * never takes a published place down: rejecting or returning it leaves the published revision live, and approving it
 * swaps the published revision and retires the old one.
 */
export async function transition(
  db: D1Database,
  t: { placeId: string; revisionId: string; action: "approve" | "reject" | "return"; expectedRev: number; actor: string; note?: string },
  now: Date,
): Promise<"ok" | "conflict"> {
  const tid = `t_${ulid(now.getTime())}`
  const at = now.toISOString()
  const happened = "EXISTS (SELECT 1 FROM places WHERE id = ?1 AND last_transition_id = ?2)"
  const state = { approve: "approved", reject: "rejected", return: "returned" }[t.action]
  const [placeUpdate] = await db.batch([
    db
      .prepare(
        `UPDATE places SET rev = rev + 1, last_transition_id = ?2, status_changed_at = ?4,
           status = CASE WHEN ?3 = 'approve' THEN 'published'
                         WHEN status = 'pending' THEN (CASE ?3 WHEN 'reject' THEN 'rejected' ELSE 'returned' END)
                         ELSE status END,
           published_revision_id = CASE WHEN ?3 = 'approve' THEN ?5 ELSE published_revision_id END
         WHERE id = ?1 AND rev = ?6 AND status IN ('pending', 'published')
           AND EXISTS (SELECT 1 FROM revisions WHERE id = ?5 AND place_id = ?1 AND state = 'pending')`,
      )
      .bind(t.placeId, tid, t.action, at, t.revisionId, t.expectedRev),
    // An approved correction retires the revision that was published until now.
    db
      .prepare(
        `UPDATE revisions SET state = 'superseded' WHERE place_id = ?1 AND state = 'approved' AND ?3 = 'approve' AND id != ?4 AND ${happened}`,
      )
      .bind(t.placeId, tid, t.action, t.revisionId),
    db
      .prepare(`UPDATE revisions SET state = ?3, decided_at = ?4, decision_note = ?6 WHERE id = ?5 AND ${happened}`)
      .bind(t.placeId, tid, state, at, t.revisionId, t.note ?? null),
    db
      .prepare(`UPDATE feed_state SET n = n + 1, changed_at = ?3 WHERE id = 1 AND ?4 = 'approve' AND ${happened}`)
      .bind(t.placeId, tid, at, t.action),
    db
      .prepare(`INSERT INTO audit_log (id, at, actor, action, entity_id, fields) SELECT ?3, ?4, ?5, ?6, ?1, 'status' WHERE ${happened}`)
      .bind(t.placeId, tid, `a_${ulid(now.getTime())}`, at, t.actor, t.action),
  ])
  return placeUpdate.meta.changes === 1 ? "ok" : "conflict"
}

/**
 * The sender's correction: a new revision, from a place returned to them or one already published. Moderators never
 * edit what a contributor wrote, so this is the only way text changes. The kind and the point stay as they were.
 * The compare-and-set on `expectedRev` turns a retry or a stale view into a conflict, never a second revision.
 */
export async function revise(
  db: D1Database,
  id: string,
  token: string,
  r: Omit<RevisionInput, "expectedRev">,
  expectedRev: number,
  now: Date,
): Promise<"ok" | "conflict" | "not_found"> {
  if (!(await tracked(db, id, token))) return "not_found"
  const tid = `t_${ulid(now.getTime())}`
  const at = now.toISOString()
  const happened = "EXISTS (SELECT 1 FROM places WHERE id = ?1 AND last_transition_id = ?2)"
  const [placeUpdate] = await db.batch([
    db
      .prepare(
        `UPDATE places SET rev = rev + 1, last_transition_id = ?2, status_changed_at = ?3,
           status = CASE WHEN status = 'returned' THEN 'pending' ELSE status END
         WHERE id = ?1 AND rev = ?4 AND status IN ('returned', 'published')
           AND NOT EXISTS (SELECT 1 FROM revisions WHERE place_id = ?1 AND state = 'pending')`,
      )
      .bind(id, tid, at, expectedRev),
    db.prepare(`UPDATE revisions SET state = 'superseded' WHERE place_id = ?1 AND state = 'returned' AND ${happened}`).bind(id, tid),
    db
      .prepare(
        `INSERT INTO revisions (id, place_id, n, state, kind, name_he, lat, lng, location_precision, on_private_property,
           location_permission_at, access_note_he, place_he, in_memory_of, story_he, link_url, consent_version, created_at,
           photo_key, photo_alt, photo_credit)
         SELECT ?3, ?1, last.n + 1, 'pending', last.kind, ?4, last.lat, last.lng, last.location_precision, last.on_private_property,
           last.location_permission_at, last.access_note_he, ?5, ?6, ?7, ?8, ?9, ?10, last.photo_key, last.photo_alt, last.photo_credit
         FROM (SELECT * FROM revisions WHERE place_id = ?1 ORDER BY n DESC LIMIT 1) AS last
         WHERE ${happened}`,
      )
      .bind(
        id,
        tid,
        `r_${ulid(now.getTime())}`,
        r.name_he,
        r.place_he ?? null,
        r.in_memory_of ?? null,
        r.story_he ?? null,
        r.link_url ?? null,
        r.consent_version,
        at,
      ),
    db
      .prepare(
        `INSERT INTO audit_log (id, at, actor, action, entity_id, fields) SELECT ?3, ?4, 'submitter', 'revise', ?1, 'revision' WHERE ${happened}`,
      )
      .bind(id, tid, `a_${ulid(now.getTime())}`, at),
  ])
  return placeUpdate.meta.changes === 1 ? "ok" : "conflict"
}

/** One batch, so the version and the places come from the same moment. Only public fields leave the database. */
export async function readFeed(db: D1Database, epoch: string): Promise<Feed> {
  const [state, rows] = await db.batch([
    db.prepare("SELECT n FROM feed_state WHERE id = 1"),
    db.prepare(
      `SELECT p.id, r.kind, r.name_he, r.lat, r.lng, r.location_precision, r.place_he, r.story_he, r.in_memory_of, r.link_url,
         r.photo_key, r.photo_alt, r.photo_credit, r.access_note_he
       FROM places p JOIN revisions r ON r.id = p.published_revision_id WHERE p.status = 'published'`,
    ),
  ])
  const n = (state.results[0] as { n: number }).n
  const places = (rows.results as Record<string, string | number | null>[]).map((r): PublicPlace => ({
    id: r.id as string,
    kind: r.kind as PublicPlace["kind"],
    name_he: r.name_he as string,
    lat: r.lat as number,
    lng: r.lng as number,
    precision: r.location_precision === "approximate" ? "approx" : "exact",
    place_he: (r.place_he as string | null) ?? "",
    summary_he: (r.story_he as string | null) ?? "",
    in_memory_of: (r.in_memory_of as string | null) ?? undefined,
    link_url: (r.link_url as string | null) ?? undefined,
    ...(r.access_note_he ? { access_note: r.access_note_he as string } : {}),
    // Only a photo that reached public/ (approved with its place) is ever named in the feed.
    ...(typeof r.photo_key === "string" && r.photo_key.startsWith("public/")
      ? { photo: { url: `/media/${r.photo_key}`, alt: r.photo_alt as string, credit: (r.photo_credit as string | null) ?? undefined } }
      : {}),
  }))
  return { v: `${epoch}.${n}`, places }
}

/** Whether this key already made a submission: its retry is answered from what is stored. */
export async function submissionKnown(db: D1Database, key: string) {
  return !!(await db
    .prepare("SELECT 1 FROM places WHERE submit_key_hash = ?")
    .bind(await sha256Hex(key))
    .first())
}

/** Revisions waiting for a moderator: first submissions and corrections alike. */
export async function pendingCount(db: D1Database) {
  return (await db.prepare("SELECT COUNT(*) AS n FROM revisions WHERE state = 'pending'").first<number>("n")) ?? 0
}

const MAX_PHOTO = 4 * 1024 * 1024

/**
 * The sender's photo for their newest revision that is still open (pending, or returned for a change). It waits in
 * quarantine/ until a moderator approves the place; the metadata a camera writes is stripped first.
 */
export async function attachPhoto(
  db: D1Database,
  media: R2Bucket,
  id: string,
  token: string,
  bytes: Uint8Array,
  alt: string,
  credit: string | undefined,
): Promise<"ok" | "not_found" | "too_large" | "not_jpeg" | "closed"> {
  if (!(await tracked(db, id, token))) return "not_found"
  if (bytes.length > MAX_PHOTO) return "too_large"
  const clean = stripJpeg(bytes)
  if (!clean) return "not_jpeg"
  const rev = await db
    .prepare("SELECT id, photo_key FROM revisions WHERE place_id = ? AND state IN ('pending', 'returned') ORDER BY n DESC LIMIT 1")
    .bind(id)
    .first<{ id: string; photo_key: string | null }>()
  if (!rev) return "closed"
  const key = `quarantine/${id}/${rev.id}-${ulid()}.jpg`
  await media.put(key, clean, { httpMetadata: { contentType: "image/jpeg" } })
  await db
    .prepare("UPDATE revisions SET photo_key = ?, photo_alt = ?, photo_credit = ? WHERE id = ?")
    .bind(key, alt, credit ?? null, rev.id)
    .run()
  // A replaced photo that was never approved goes at once.
  if (rev.photo_key?.startsWith("quarantine/")) await media.delete(rev.photo_key)
  return "ok"
}

/**
 * The files follow a moderator's decision. Approving moves the revision's photo from quarantine/ to public/ and removes
 * the photos of revisions it retires; rejecting deletes the photo at once (spec 3.3). A returned revision keeps its photo
 * for the sender's correction. Runs after the decision is stored, so a failure here leaves files for the sweep, never a
 * decision half made.
 */
export async function photosAfterDecision(db: D1Database, media: R2Bucket, placeId: string, revisionId: string, action: string) {
  const rev = await db.prepare("SELECT photo_key FROM revisions WHERE id = ?").bind(revisionId).first<{ photo_key: string | null }>()
  if (action === "reject" && rev?.photo_key?.startsWith("quarantine/")) {
    await media.delete(rev.photo_key)
    await db.prepare("UPDATE revisions SET photo_key = NULL, photo_alt = NULL, photo_credit = NULL WHERE id = ?").bind(revisionId).run()
    return
  }
  if (action !== "approve") return
  let live = rev?.photo_key ?? null
  if (live?.startsWith("quarantine/")) {
    const object = await media.get(live)
    if (object) {
      const published = `public/${placeId}/${revisionId}.jpg`
      await media.put(published, await object.arrayBuffer(), { httpMetadata: { contentType: "image/jpeg" } })
      await db.prepare("UPDATE revisions SET photo_key = ? WHERE id = ?").bind(published, revisionId).run()
      await media.delete(live)
      live = published
    }
  }
  // Whatever else this place holds in public/ belonged to revisions that are no longer published.
  const others = (await media.list({ prefix: `public/${placeId}/` })).objects.map((o) => o.key).filter((k) => k !== live)
  if (others.length) await media.delete(others)
}

/** Every file of a place, in quarantine and public alike: a withdrawal erases them all at once. */
export async function erasePhotos(media: R2Bucket, placeId: string) {
  for (const prefix of [`quarantine/${placeId}/`, `public/${placeId}/`]) {
    const keys = (await media.list({ prefix })).objects.map((o) => o.key)
    if (keys.length) await media.delete(keys)
  }
}
