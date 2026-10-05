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
