import { replayDecision, type LedgerEntry } from "../lib/ledger"
import { notesCeiling } from "./reports"
import { BLANK_COLUMNS } from "./retention"

const BLANK = Object.entries(BLANK_COLUMNS)
  .map(([c, v]) => `${c} = ${v === null ? "NULL" : v}`)
  .join(", ")

async function readLedger(ledger: R2Bucket) {
  const byPlace = new Map<string, LedgerEntry[]>()
  let cursor: string | undefined
  do {
    const page = await ledger.list({ prefix: "ledger/", cursor })
    for (const o of page.objects) {
      const entry = (await (await ledger.get(o.key))?.json()) as LedgerEntry | undefined
      if (entry) byPlace.set(entry.place, [...(byPlace.get(entry.place) ?? []), entry])
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return byPlace
}

/**
 * The ledger replayed onto a restored database (spec 8.2, 8.3: Route A from its point, Route B from the export, and the
 * drill), place by place from the chain step the restored row holds, by replayDecision's rules:
 * - a withdrawal or an erasure that took effect makes the place a tombstone, its content and contact gone, whatever
 *   else was recorded: it never comes back;
 * - committed decisions are applied in chain order (an approval onto the revision it decided, with the photo it
 *   published), and a removal with an intent and no commit is applied too;
 * - a gap in the chain, or an approval of a revision the restored copy doesn't have, hides the whole place until a
 *   moderator looks.
 * Content received after the restore point is not in the ledger, and stays lost. Safe to run twice: a second run finds
 * every place at the step the first left it.
 */
export async function replayLedger(db: D1Database, ledger: R2Bucket, now: Date) {
  const result = { places: 0, applied: 0, quarantined: [] as string[], erased: [] as string[], lost: [] as string[] }
  for (const [placeId, entries] of await readLedger(ledger)) {
    result.places++
    const row = await db
      .prepare("SELECT status, ledger_seq FROM places WHERE id = ?")
      .bind(placeId)
      .first<{ status: string; ledger_seq: number }>()
    const r = replayDecision(entries, row?.ledger_seq ?? 0)
    if (!row) {
      // Created after the restore point: its decisions are recorded, its content never was.
      if (!r.erased && r.apply.length) result.lost.push(placeId)
      continue
    }
    const lastSeq = Math.max(row.ledger_seq, ...r.apply.map((e) => e.seq_to))
    const statements: D1PreparedStatement[] = []
    result.applied += r.apply.length
    if (r.erased) {
      const status = entries.some((e) => e.kind === "withdraw" && (e.phase === "commit" || e.phase === "intent")) ? "withdrawn" : "erased"
      statements.push(
        db
          .prepare(
            `UPDATE places SET status = ?2, published_revision_id = NULL, submit_body_hash = NULL, ledger_seq = MAX(ledger_seq, ?3),
               erased_reason = CASE WHEN ?2 = 'erased' THEN COALESCE(erased_reason, 'restored') ELSE erased_reason END
             WHERE id = ?1`,
          )
          .bind(placeId, status, lastSeq),
        db
          .prepare(`UPDATE revisions SET ${BLANK}, state = CASE WHEN ?2 = 'withdrawn' THEN 'withdrawn' ELSE state END WHERE place_id = ?1`)
          .bind(placeId, status),
        db.prepare("DELETE FROM contacts WHERE place_id = ?").bind(placeId),
      )
      await db.batch(statements)
      result.erased.push(placeId)
      continue
    }
    let quarantine = r.quarantine
    for (const e of r.apply) {
      const revision = e.revision
        ? await db.prepare("SELECT id FROM revisions WHERE id = ? AND place_id = ?").bind(e.revision, placeId).first<{ id: string }>()
        : null
      if (e.kind === "approve") {
        if (!revision) {
          quarantine = true
          continue
        }
        const photo = e.media?.find((k) => k.startsWith(`public/${placeId}/`)) ?? null
        statements.push(
          db
            .prepare("UPDATE revisions SET state = 'superseded' WHERE place_id = ?1 AND state = 'approved' AND id != ?2")
            .bind(placeId, revision.id),
          db
            .prepare("UPDATE revisions SET state = 'approved', decided_at = ?2, photo_key = COALESCE(?3, photo_key) WHERE id = ?1")
            .bind(revision.id, e.at, photo),
          db
            .prepare("UPDATE places SET status = ?2, published_revision_id = ?3, status_changed_at = ?4 WHERE id = ?1")
            .bind(placeId, e.status ?? "published", revision.id, e.at),
        )
      } else if (e.kind === "reject" || e.kind === "return") {
        if (revision)
          statements.push(
            db
              .prepare(
                `UPDATE revisions SET state = ?2, decided_at = ?3,
                   photo_key = CASE WHEN ?2 = 'rejected' AND photo_key LIKE 'quarantine/%' THEN NULL ELSE photo_key END
                 WHERE id = ?1`,
              )
              .bind(revision.id, e.kind === "reject" ? "rejected" : "returned", e.at),
          )
        if (e.status)
          statements.push(db.prepare("UPDATE places SET status = ?2, status_changed_at = ?3 WHERE id = ?1").bind(placeId, e.status, e.at))
      } else if (e.kind === "suppress") {
        for (const [i, id] of (e.targets ?? []).entries())
          statements.push(
            db
              .prepare(
                `INSERT OR IGNORE INTO field_suppressions (id, place_id, field, kind, created_at, created_by, notes_ceiling_at, notes_purge_after)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'ledger', ?6, ?6)`,
              )
              .bind(
                id,
                placeId,
                e.fields?.[i] ?? "whole",
                e.actor === "automatic" ? "precautionary" : "manual",
                e.at,
                notesCeiling(new Date(e.at)),
              ),
          )
        const status = e.status ?? (e.fields?.includes("whole") ? "hidden" : null)
        if (status)
          statements.push(
            db.prepare("UPDATE places SET status = ?2 WHERE id = ?1 AND status IN ('published', 'hidden')").bind(placeId, status),
          )
      } else if (e.kind === "lift") {
        for (const id of e.targets ?? [])
          statements.push(
            db
              .prepare(
                `UPDATE field_suppressions SET lifted_at = ?2, lifted_by = 'ledger', basis_code = COALESCE(?3, 'restored'), basis_note = '',
                   notes_purge_after = MIN(notes_purge_after, strftime('%Y-%m-%dT%H:%M:%fZ', ?2, '+90 days'))
                 WHERE id = ?1 AND lifted_at IS NULL`,
              )
              .bind(id, e.at, e.basis ?? null),
          )
        if (e.status) statements.push(db.prepare("UPDATE places SET status = ?2 WHERE id = ?1").bind(placeId, e.status))
      }
      statements.push(db.prepare("UPDATE places SET rev = MAX(rev, ?2) WHERE id = ?1").bind(placeId, e.rev_to))
    }
    statements.push(db.prepare("UPDATE places SET ledger_seq = MAX(ledger_seq, ?2) WHERE id = ?1").bind(placeId, lastSeq))
    if (quarantine) {
      // Hidden whole, by a hide a moderator lifts after looking; one per place and step, so a second run adds none.
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO field_suppressions (id, place_id, field, kind, created_at, created_by, notes_ceiling_at, notes_purge_after)
             VALUES (?1, ?2, 'whole', 'precautionary', ?3, 'ledger', ?4, ?4)`,
          )
          .bind(`s_replay_${placeId}_${lastSeq}`, placeId, now.toISOString(), notesCeiling(now)),
        db.prepare("UPDATE places SET status = 'hidden' WHERE id = ? AND status = 'published'").bind(placeId),
      )
      result.quarantined.push(placeId)
    }
    await db.batch(statements)
  }
  // The feed's version moves on, so every browser fetches the restored places again.
  if (result.applied || result.quarantined.length || result.erased.length)
    await db.prepare("UPDATE feed_state SET n = n + 1, changed_at = ? WHERE id = 1").bind(now.toISOString()).run()
  return result
}
