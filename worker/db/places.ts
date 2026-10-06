import { KINDS } from "@/data/taxonomy"
import type { Kind } from "@/types"
import type { Feed, PublicPlace, RevisionInput, SubmissionInput } from "@/shared/contract"
import { newToken, placeId, sameHash, sha256Hex, ulid } from "../lib/ids"
import { stripJpeg } from "../lib/jpeg"
import { runOp, type OpEnv } from "./ops"

// An approximation of a month; phase 5 replaces it with calendar months read from RETENTION (src/config.ts).
const MONTH_MS = 30 * 24 * 3600 * 1000

export type Inserted =
  /** `verifyToken`: the email verification link's secret, when an address was given; only its hash is stored. */
  | { kind: "created"; id: string; trackingToken: string; verifyToken?: string }
  | { kind: "replayed"; id: string; trackingToken: string }
  | { kind: "mismatch" }
  | { kind: "queue_full" }

const VERIFY_DAYS = 7

/**
 * The tracking token for a submission key: HMAC(secret, key). A re-sent submission gets the very token its first try
 * got, so two tabs re-sending at once, or a lost answer, never leave a device holding a token that stopped working.
 * Holding it still takes both the device's random key and the server's secret.
 */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message)))
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("")
}

export async function trackingTokenFor(secret: string, key: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`track:${key}`)))
  return btoa(String.fromCharCode(...mac.subarray(0, 16)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

export async function insertSubmission(
  db: D1Database,
  input: SubmissionInput,
  key: string,
  trackingToken: string,
  now: Date,
  /** The most revisions that may wait for a moderator: checked in the insert itself, so requests at once can't pass it together. */
  queueLimit: number,
  /** Keys the body's fingerprint: without it, a stored fingerprint can't be tested against a guessed name or email. */
  secret: string,
): Promise<Inserted> {
  const keyHash = await sha256Hex(key)
  // The input after Zod, so the same request always gives the same fingerprint; keyed, and erased with a withdrawal.
  // The sender's email and name are left out of it, so nothing derived from them outlives their own erasure.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- left out on purpose
  const { email, submitter_name, ...place } = input
  const bodyHash = await hmacHex(secret, `body:${JSON.stringify(place)}`)
  const id = placeId(now.getTime())
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
         SELECT ?, 'contribution', 'pending', 1, ?, ?, ?, ?, ?
         WHERE (SELECT COUNT(*) FROM revisions WHERE state = 'pending') < ?`,
      )
      .bind(id, await sha256Hex(trackingToken), keyHash, bodyHash, at, at, queueLimit),
    db
      .prepare(
        `INSERT INTO revisions (id, place_id, n, state, kind, name_he, lat, lng, location_precision, on_private_property, location_permission_at,
           access_note_he, place_he, in_memory_of, story_he, link_url, consent_version, created_at)
         SELECT ?, ?, 1, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM places WHERE id = ?)`,
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
        id,
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
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM places WHERE id = ?)`,
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
          id,
        ),
    )
  }
  // One batch is one transaction: a place never exists without its first revision, and a used key adds nothing.
  try {
    const [place] = await db.batch(stmts)
    if (place.meta.changes === 1) return { kind: "created", id, trackingToken, verifyToken }
  } catch (err) {
    if (!String(err).includes("places.submit_key_hash")) throw err
  }
  // The key was used before: the same submission sent again (its answer was lost), or a different one reusing it.
  const prior = await db
    .prepare("SELECT id, submit_body_hash AS body FROM places WHERE submit_key_hash = ?")
    .bind(keyHash)
    .first<{ id: string; body: string | null }>()
  // Nothing was inserted and the key is new: the queue was full when it arrived.
  if (!prior) return { kind: "queue_full" }
  // A withdrawn submission kept no fingerprint: its key alone answers a retry, with the same id and token.
  if (prior.body !== null && prior.body !== bodyHash) return { kind: "mismatch" }
  // The same key derives the same token: the answer the first try lost is given again, unchanged.
  return { kind: "replayed", id: prior.id, trackingToken }
}

/** Whether `token` opens this place: checked before a request's body is even read. */
export const canTrack = async (db: D1Database, id: string, token: string) => !!(await tracked(db, id, token))

/** The place, if `token` is its tracking capability; null for an unknown id and a wrong token alike. */
async function tracked(db: D1Database, id: string, token: string) {
  // The same work whatever the answer: the token is hashed and both capabilities are read every time, so how long it
  // takes doesn't tell an existing id from a wrong token. The tracking link sent to a verified email is the second
  // capability for the same place, erased with the contact.
  const hash = await sha256Hex(token)
  const [places, contacts] = await db.batch([
    db.prepare("SELECT status, rev, tracking_token_hash AS h FROM places WHERE id = ?").bind(id),
    db.prepare("SELECT email_token_hash AS h FROM contacts WHERE place_id = ? AND email_token_hash IS NOT NULL").bind(id),
  ])
  const row = places.results[0] as { status: string; rev: number; h: string | null } | undefined
  const mailed = contacts.results[0] as { h: string } | undefined
  // A missing hash is compared as a dummy of the same length, so the comparison takes its usual time too.
  const none = "0".repeat(hash.length)
  const byLink = await sameHash(row?.h ?? none, hash)
  const byMail = await sameHash(mailed?.h ?? none, hash)
  return row && ((row.h && byLink) || byMail) ? row : null
}

/**
 * The sender confirms their address from the link in the verification mail. The first confirmation mints the email's
 * own tracking token, so the mail that follows can carry a tracking link; a second click changes nothing.
 */
export async function verifyEmail(
  db: D1Database,
  token: string,
  now: Date,
  secret: string,
): Promise<{
  first: boolean
  /** The tracking mail: sent by an earlier click, out of tries, or due (`mail` says what to send, when this click may). */
  mailState: "earlier" | "stopped" | "due"
  mail?: { to: string; placeId: string; emailToken: string; contactId: string }
} | null> {
  const row = await db
    .prepare(
      `SELECT id, place_id, email, email_verified_at, email_verify_expires, tracking_mail_sent_at, tracking_mail_attempts
       FROM contacts WHERE email_verify_hash = ?`,
    )
    .bind(await sha256Hex(token))
    .first<{
      id: string
      place_id: string | null
      email: string | null
      email_verified_at: string | null
      email_verify_expires: string
      tracking_mail_sent_at: string | null
      tracking_mail_attempts: number
    }>()
  if (!row?.email || !row.place_id || row.email_verify_expires < now.toISOString()) return null
  // The address's own tracking token, derived from the contact with the server's secret: a mail sent again carries the
  // very link the first one would have, so no working link is ever replaced.
  const emailToken = await hmacHex(secret, `email:${row.id}`)
  let first = false
  if (!row.email_verified_at) {
    const done = await db
      .prepare("UPDATE contacts SET email_verified_at = ?, email_token_hash = ? WHERE id = ? AND email_verified_at IS NULL")
      .bind(now.toISOString(), await sha256Hex(emailToken), row.id)
      .run()
    // Two clicks at once: only the one that verified counts as first.
    first = done.meta.changes === 1
  }
  // The tracking mail is due until one has gone out, and is tried five times at most.
  const due = !row.tracking_mail_sent_at && row.tracking_mail_attempts < MAIL_TRIES
  return {
    first,
    mailState: row.tracking_mail_sent_at ? "earlier" : due ? "due" : "stopped",
    ...(due && (first || row.email_verified_at) ? { mail: { to: row.email, placeId: row.place_id, emailToken, contactId: row.id } } : {}),
  }
}

export const MAIL_TRIES = 5
/** The least time between two tries of the tracking mail. */
const MAIL_GAP_MS = 2 * 60_000

/**
 * Records one try of the tracking mail, and says which try it is (1 to five), or null when no try is allowed now: one
 * went out, all five were used, or the last was less than two minutes ago. Counted and timed in the update itself, so
 * clicks at once can't pass the limit or send twice.
 */
export async function claimTrackingMail(db: D1Database, contactId: string, now: Date): Promise<number | null> {
  const row = await db
    .prepare(
      `UPDATE contacts SET tracking_mail_attempts = tracking_mail_attempts + 1, tracking_mail_tried_at = ?3
       WHERE id = ?1 AND tracking_mail_sent_at IS NULL AND tracking_mail_attempts < ?2
         AND (tracking_mail_tried_at IS NULL OR tracking_mail_tried_at <= ?4)
       RETURNING tracking_mail_attempts AS n`,
    )
    .bind(contactId, MAIL_TRIES, now.toISOString(), new Date(now.getTime() - MAIL_GAP_MS).toISOString())
    .first<{ n: number }>()
  return row?.n ?? null
}
export async function trackingMailSent(db: D1Database, contactId: string, now: Date) {
  await db.prepare("UPDATE contacts SET tracking_mail_sent_at = ? WHERE id = ?").bind(now.toISOString(), contactId).run()
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
 *
 * done: withdrawn now or before · missing: no place for this link · busy: the place kept changing under three tries in a
 * row, so the holder of a valid link is told to try again rather than that the link is wrong.
 */
export async function withdraw(env: OpEnv, id: string, token: string, now: Date): Promise<"done" | "missing" | "busy"> {
  const db = env.db
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await tracked(db, id, token)
    if (!row) return "missing"
    if (row.status === "withdrawn" || row.status === "erased") return "done"
    const at = now.toISOString()
    const happened = "EXISTS (SELECT 1 FROM places WHERE id = ?1 AND last_transition_id = ?2)"
    // The sender's own removal: it goes ahead even if the ledger can't record it now, and is repaired later (spec 8.2).
    const { outcome } = await runOp(
      env,
      {
        placeId: id,
        kind: "withdraw",
        actor: "submitter",
        expectedRev: row.rev,
        removal: true,
        public: row.status === "published" || row.status === "hidden",
        onIntentFailure: "proceed",
        statements: (tid) => [
          db
            .prepare(
              `UPDATE places SET status = 'withdrawn', rev = rev + 1, last_transition_id = ?2, status_changed_at = ?3, published_revision_id = NULL,
                 submit_body_hash = NULL
               WHERE id = ?1 AND rev = ?4`,
            )
            .bind(id, tid, at, row.rev),
          db
            .prepare(
              `UPDATE revisions SET state = 'withdrawn', kind = NULL, name_he = NULL, lat = NULL, lng = NULL, location_precision = NULL,
                 on_private_property = 0, location_permission_at = NULL, access_note_he = NULL, place_he = NULL, in_memory_of = NULL,
                 story_he = NULL, link_url = NULL, decision_note = NULL, photo_key = NULL, photo_alt = NULL, photo_credit = NULL, decided_at = ?3
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
        ],
      },
      now,
    )
    if (outcome === "ok") return "done"
    // A moderator decided at the same moment: read the place again and withdraw what it is now.
  }
  return "busy"
}

/** Everything a moderator approves is on screen: every field the feed would publish. */
export async function listQueue(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.rev, r.id AS revisionId, r.kind, r.name_he, r.lat, r.lng, r.location_precision, r.place_he, r.in_memory_of, r.story_he,
         r.link_url, p.created_at, p.status IN ('published', 'hidden') AS correction, p.status = 'hidden' AS hidden,
         CASE WHEN r.photo_key IS NOT NULL THEN '/api/admin/media/' || r.photo_key END AS photo_url, r.photo_alt, r.photo_credit,
         r.access_note_he, r.on_private_property, r.location_permission_at IS NOT NULL AS location_permission
       FROM places p JOIN revisions r ON r.place_id = p.id AND r.state = 'pending'
       WHERE p.status IN ('pending', 'published', 'hidden') ORDER BY r.created_at`,
    )
    .all()
  return results
}

/**
 * A compare-and-set on the place's rev: two moderators deciding at once can't both win. Every later statement
 * checks the transition id this request wrote, so the revisions, the feed version and the audit row move only
 * if this transition actually happened.
 *
 * The revision decided is a first submission (the place is pending) or a correction of a published or hidden place.
 * A hidden place stays hidden whatever is decided: its correction may be the basis for restoring it (content_corrected),
 * but only a moderator's documented lift shows it again. A correction never takes a published place down: rejecting or returning it leaves the published revision live, and approving it
 * swaps the published revision and retires the old one.
 */
export function transitionStatements(
  db: D1Database,
  t: {
    placeId: string
    revisionId: string
    action: "approve" | "reject" | "return"
    expectedRev: number
    actor: string
    note?: string
    /** For an approval: the key its photo will be served from (preparePhoto), set in the same step. */
    photoKey?: string | null
  },
  tid: string,
  now: Date,
): D1PreparedStatement[] {
  const at = now.toISOString()
  const happened = "EXISTS (SELECT 1 FROM places WHERE id = ?1 AND last_transition_id = ?2)"
  const state = { approve: "approved", reject: "rejected", return: "returned" }[t.action]
  return [
    db
      .prepare(
        `UPDATE places SET rev = rev + 1, last_transition_id = ?2, status_changed_at = ?4,
           status = CASE WHEN status = 'hidden' THEN 'hidden'
                         WHEN ?3 = 'approve' THEN 'published'
                         WHEN status = 'pending' THEN (CASE ?3 WHEN 'reject' THEN 'rejected' ELSE 'returned' END)
                         ELSE status END,
           published_revision_id = CASE WHEN ?3 = 'approve' THEN ?5 ELSE published_revision_id END
         WHERE id = ?1 AND rev = ?6 AND status IN ('pending', 'published', 'hidden')
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
      .prepare(
        `UPDATE revisions SET state = ?3, decided_at = ?4, decision_note = ?6,
           photo_key = CASE WHEN ?7 = 1 THEN ?8 WHEN ?3 = 'rejected' AND photo_key LIKE 'quarantine/%' THEN NULL ELSE photo_key END,
           photo_alt = CASE WHEN (?7 = 1 AND ?8 IS NULL) OR (?3 = 'rejected' AND photo_key LIKE 'quarantine/%') THEN NULL ELSE photo_alt END,
           photo_credit = CASE WHEN (?7 = 1 AND ?8 IS NULL) OR (?3 = 'rejected' AND photo_key LIKE 'quarantine/%') THEN NULL ELSE photo_credit END
         WHERE id = ?5 AND ${happened}`,
      )
      .bind(t.placeId, tid, state, at, t.revisionId, t.note ?? null, t.action === "approve" ? 1 : 0, t.photoKey ?? null),
    db
      .prepare(`UPDATE feed_state SET n = n + 1, changed_at = ?3 WHERE id = 1 AND ?4 = 'approve' AND ${happened}`)
      .bind(t.placeId, tid, at, t.action),
    db
      .prepare(`INSERT INTO audit_log (id, at, actor, action, entity_id, fields) SELECT ?3, ?4, ?5, ?6, ?1, 'status' WHERE ${happened}`)
      .bind(t.placeId, tid, `a_${ulid(now.getTime())}`, at, t.actor, t.action),
  ]
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
  /** As for a new submission: a correction adds work for the moderators, so it waits for room in the queue. */
  queueLimit: number,
): Promise<"ok" | "conflict" | "not_found" | "queue_full"> {
  const place = await tracked(db, id, token)
  if (!place) return "not_found"
  // The photo a correction carries over: the published one while the place is live (a refused correction's photo is
  // gone), otherwise the newest revision's.
  const photo = await db
    .prepare(
      place.status === "published" || place.status === "hidden"
        ? "SELECT r.photo_key, r.photo_alt, r.photo_credit FROM places p JOIN revisions r ON r.id = p.published_revision_id WHERE p.id = ?"
        : "SELECT photo_key, photo_alt, photo_credit FROM revisions WHERE place_id = ? ORDER BY n DESC LIMIT 1",
    )
    .bind(id)
    .first<{ photo_key: string | null; photo_alt: string | null; photo_credit: string | null }>()
  const tid = `t_${ulid(now.getTime())}`
  const at = now.toISOString()
  const happened = "EXISTS (SELECT 1 FROM places WHERE id = ?1 AND last_transition_id = ?2)"
  const [placeUpdate] = await db.batch([
    db
      .prepare(
        `UPDATE places SET rev = rev + 1, last_transition_id = ?2, status_changed_at = ?3,
           status = CASE WHEN status = 'returned' THEN 'pending' ELSE status END
         WHERE id = ?1 AND rev = ?4 AND status IN ('returned', 'published', 'hidden')
           AND NOT EXISTS (SELECT 1 FROM revisions WHERE place_id = ?1 AND state = 'pending')
           AND (SELECT COUNT(*) FROM revisions WHERE state = 'pending') < ?5`,
      )
      .bind(id, tid, at, expectedRev, queueLimit),
    db.prepare(`UPDATE revisions SET state = 'superseded' WHERE place_id = ?1 AND state = 'returned' AND ${happened}`).bind(id, tid),
    db
      .prepare(
        `INSERT INTO revisions (id, place_id, n, state, kind, name_he, lat, lng, location_precision, on_private_property,
           location_permission_at, access_note_he, place_he, in_memory_of, story_he, link_url, consent_version, created_at,
           photo_key, photo_alt, photo_credit)
         SELECT ?3, ?1, last.n + 1, 'pending', last.kind, ?4, last.lat, last.lng, last.location_precision, last.on_private_property,
           last.location_permission_at, last.access_note_he, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13
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
        photo?.photo_key ?? null,
        photo?.photo_alt ?? null,
        photo?.photo_credit ?? null,
      ),
    db
      .prepare(
        `INSERT INTO audit_log (id, at, actor, action, entity_id, fields) SELECT ?3, ?4, 'submitter', 'revise', ?1, 'revision' WHERE ${happened}`,
      )
      .bind(id, tid, `a_${ulid(now.getTime())}`, at),
  ])
  if (placeUpdate.meta.changes === 1) return "ok"
  // Full only if nothing else stood in the way: a stale view or a correction already waiting is a conflict either way.
  const open = await db
    .prepare(
      `SELECT 1 FROM places WHERE id = ?1 AND rev = ?2 AND status IN ('returned', 'published', 'hidden')
         AND NOT EXISTS (SELECT 1 FROM revisions WHERE place_id = ?1 AND state = 'pending')`,
    )
    .bind(id, expectedRev)
    .first()
  return open && (await pendingCount(db)) >= queueLimit ? "queue_full" : "conflict"
}

// Each place carries the elements hidden now (the union of its active suppressions), applied in toPublic, so the feed,
// the share page and anything else built from this projection hide exactly the same things.
const PUBLIC_COLUMNS = `p.id, r.kind, r.name_he, r.lat, r.lng, r.location_precision, r.place_he, r.story_he, r.in_memory_of,
  r.link_url, r.photo_key, r.photo_alt, r.photo_credit, r.access_note_he,
  (SELECT GROUP_CONCAT(s.field) FROM field_suppressions s WHERE s.place_id = p.id AND s.lifted_at IS NULL) AS hidden_fields`

/** One batch, so the version and the places come from the same moment. Only public fields leave the database. */
export async function readFeed(db: D1Database, epoch: string): Promise<Feed> {
  const [state, rows] = await db.batch([
    db.prepare("SELECT n FROM feed_state WHERE id = 1"),
    db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM places p JOIN revisions r ON r.id = p.published_revision_id WHERE p.status = 'published'`),
  ])
  const n = (state.results[0] as { n: number }).n
  return { v: `${epoch}.${n}`, places: (rows.results as Record<string, string | number | null>[]).map(toPublic) }
}

/**
 * One contribution as the public sees it, for its share page: published (its public fields, as in the feed), gone
 * (it was taken back, erased or hidden: the page says so, and nothing of it), or none (never public: unknown, pending,
 * returned or refused, so the page doesn't even say it existed).
 */
export async function publicPlace(
  db: D1Database,
  id: string,
): Promise<{ kind: "published"; place: PublicPlace } | { kind: "gone" | "none" }> {
  const row = await db
    .prepare(`SELECT p.status, ${PUBLIC_COLUMNS} FROM places p LEFT JOIN revisions r ON r.id = p.published_revision_id WHERE p.id = ?`)
    .bind(id)
    .first<Record<string, string | number | null>>()
  if (row?.status === "published" && row.name_he) return { kind: "published", place: toPublic(row) }
  // Hidden reads as gone, like a withdrawal: the page says it was taken down, and nothing of it.
  return row && (row.status === "withdrawn" || row.status === "erased" || row.status === "hidden") ? { kind: "gone" } : { kind: "none" }
}

/** A hidden name reads as the place's kind and community, with nothing personal (spec 3.3). */
export function hiddenName(kind: string, community: string | null): string {
  const label = KINDS[kind as Kind]?.label ?? KINDS.other.label
  return community ? `${label} · ${community}` : label
}

function toPublic(r: Record<string, string | number | null>): PublicPlace {
  const hidden = new Set(String(r.hidden_fields ?? "").split(","))
  const personal = hidden.has("name_he") || hidden.has("in_memory_of")
  return {
    id: r.id as string,
    kind: r.kind as PublicPlace["kind"],
    name_he: hidden.has("name_he") ? hiddenName(r.kind as string, r.place_he as string | null) : (r.name_he as string),
    lat: r.lat as number,
    lng: r.lng as number,
    precision: r.location_precision === "approximate" ? "approx" : "exact",
    place_he: (r.place_he as string | null) ?? "",
    summary_he: hidden.has("story_he") ? "" : ((r.story_he as string | null) ?? ""),
    in_memory_of: hidden.has("in_memory_of") ? undefined : ((r.in_memory_of as string | null) ?? undefined),
    // A link and a photo's description can repeat a hidden name or dedication: with either hidden, the link is left out
    // and the photo is described by the same neutral words as the place.
    link_url: personal ? undefined : ((r.link_url as string | null) ?? undefined),
    ...(r.access_note_he ? { access_note: r.access_note_he as string } : {}),
    // Only a photo that reached public/ (approved with its place) and isn't hidden is ever named in the feed.
    ...(!hidden.has("photo") && typeof r.photo_key === "string" && r.photo_key.startsWith("public/")
      ? {
          photo: {
            url: `/media/${r.photo_key}`,
            alt: personal ? hiddenName(r.kind as string, r.place_he as string | null) : (r.photo_alt as string),
            credit: (r.photo_credit as string | null) ?? undefined,
          },
        }
      : {}),
  }
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
  // The rev moves with the photo: a moderator's decision made on what they saw before conflicts instead of approving
  // a picture nobody looked at.
  // Only while the revision is still open: a withdrawal or a decision that came while the file was being written wins.
  const [attached] = await db.batch([
    db
      .prepare("UPDATE revisions SET photo_key = ?, photo_alt = ?, photo_credit = ? WHERE id = ? AND state IN ('pending', 'returned')")
      .bind(key, alt, credit ?? null, rev.id),
    db
      .prepare("UPDATE places SET rev = rev + 1 WHERE id = ? AND EXISTS (SELECT 1 FROM revisions WHERE id = ? AND photo_key = ?)")
      .bind(id, rev.id, key),
  ])
  if (attached.meta.changes !== 1) {
    await media.delete(key).catch(() => undefined)
    return "closed"
  }
  // A replaced photo that was never approved goes at once; if it can't now, the photo is still attached, and the old
  // file (named by no revision any more) is left for the sweep.
  if (rev.photo_key?.startsWith("quarantine/")) await media.delete(rev.photo_key).catch(() => undefined)
  return "ok"
}

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
 * nothing names is left to the sweep. Never throws: a file that can't go now is left for the sweep too.
 */
export async function retirePhotos(db: D1Database, media: R2Bucket, keys: (string | null | undefined)[]) {
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
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "photo_cleanup", error: (err as Error).name }))
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
 * approval copies its photo before it records it. Run by the nightly job (phase 5); safe to run at any time.
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
