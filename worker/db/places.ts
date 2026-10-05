import type { SubmissionInput } from "@/shared/contract"
import { newToken, placeId, sameHash, sha256Hex, ulid } from "../lib/ids"

// An approximation of a month; phase 5 replaces it with calendar months read from RETENTION (src/config.ts).
const MONTH_MS = 30 * 24 * 3600 * 1000

export async function insertSubmission(db: D1Database, input: SubmissionInput, now: Date) {
  const id = placeId(now.getTime())
  const trackingToken = newToken()
  const at = now.toISOString()
  const precision = input.on_private_property ? "approximate" : "exact"
  const stmts = [
    db
      .prepare(
        "INSERT INTO places (id, origin, status, rev, tracking_token_hash, created_at, status_changed_at) VALUES (?, 'contribution', 'pending', 1, ?, ?, ?)",
      )
      .bind(id, await sha256Hex(trackingToken), at, at),
    db
      .prepare(
        `INSERT INTO revisions (id, place_id, n, state, kind, name_he, lat, lng, location_precision, on_private_property, place_he, in_memory_of, story_he, link_url, consent_version, created_at)
         VALUES (?, ?, 1, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        `r_${ulid(now.getTime())}`,
        id,
        input.kind,
        input.name_he,
        input.lat,
        input.lng,
        precision,
        input.on_private_property ? 1 : 0,
        input.place_he ?? null,
        input.in_memory_of ?? null,
        input.story_he ?? null,
        input.link_url ?? null,
        input.consent_version,
        at,
      ),
  ]
  // The submitter's name is personal data: it lives with the contacts, under a fixed deletion ceiling.
  if (input.submitter_name) {
    const ceiling = new Date(now.getTime() + 12 * MONTH_MS).toISOString()
    stmts.push(
      db
        .prepare(
          "INSERT INTO contacts (id, place_id, name, consent_version, created_at, ceiling_at, purge_after) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(`c_${ulid(now.getTime())}`, id, input.submitter_name, input.consent_version, at, ceiling, ceiling),
    )
  }
  // One batch is one transaction: a place never exists without its first revision.
  await db.batch(stmts)
  return { id, trackingToken }
}

export async function submissionStatus(db: D1Database, id: string, token: string) {
  const row = await db
    .prepare("SELECT status, tracking_token_hash AS h FROM places WHERE id = ?")
    .bind(id)
    .first<{ status: string; h: string | null }>()
  if (!row?.h || !(await sameHash(row.h, await sha256Hex(token)))) return null
  return { status: row.status }
}

export async function listQueue(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.rev, r.id AS revisionId, r.kind, r.name_he, r.place_he, r.in_memory_of, r.story_he, p.created_at
       FROM places p JOIN revisions r ON r.place_id = p.id AND r.state = 'pending'
       WHERE p.status = 'pending' ORDER BY p.created_at`,
    )
    .all()
  return results
}

/**
 * A compare-and-set on the place's rev: two moderators deciding at once can't both win. Every later statement
 * checks the transition id this request wrote, so the revision, the feed version and the audit row move only
 * if this transition actually happened.
 */
export async function transition(
  db: D1Database,
  t: { placeId: string; revisionId: string; action: "approve" | "reject"; expectedRev: number; actor: string },
  now: Date,
): Promise<"ok" | "conflict"> {
  const tid = `t_${ulid(now.getTime())}`
  const at = now.toISOString()
  const happened = "EXISTS (SELECT 1 FROM places WHERE id = ?1 AND last_transition_id = ?2)"
  const status = t.action === "approve" ? "published" : "rejected"
  const state = t.action === "approve" ? "approved" : "rejected"
  const [placeUpdate] = await db.batch([
    db
      .prepare(
        `UPDATE places SET status = ?3, rev = rev + 1, last_transition_id = ?2, status_changed_at = ?4,
           published_revision_id = CASE WHEN ?3 = 'published' THEN ?5 ELSE published_revision_id END
         WHERE id = ?1 AND rev = ?6 AND status = 'pending'
           AND EXISTS (SELECT 1 FROM revisions WHERE id = ?5 AND place_id = ?1 AND state = 'pending')`,
      )
      .bind(t.placeId, tid, status, at, t.revisionId, t.expectedRev),
    db
      .prepare(`UPDATE revisions SET state = ?3, decided_at = ?4 WHERE id = ?5 AND ${happened}`)
      .bind(t.placeId, tid, state, at, t.revisionId),
    db
      .prepare(`UPDATE feed_state SET n = n + 1, changed_at = ?3 WHERE id = 1 AND ?4 = 'published' AND ${happened}`)
      .bind(t.placeId, tid, at, status),
    db
      .prepare(`INSERT INTO audit_log (id, at, actor, action, entity_id, fields) SELECT ?3, ?4, ?5, ?6, ?1, 'status' WHERE ${happened}`)
      .bind(t.placeId, tid, `a_${ulid(now.getTime())}`, at, t.actor, t.action),
  ])
  return placeUpdate.meta.changes === 1 ? "ok" : "conflict"
}
