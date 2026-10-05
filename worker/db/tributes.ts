import { sha256Hex, ulid } from "../lib/ids"

/** `day`: the Jerusalem day the server counts this device's anemone on (for a replay, the day it was counted). */
export type Counted =
  | { counted: true; reason?: "replayed"; day: string }
  | { counted: false; reason: "already_today"; day: string }
  | { counted: false; reason: "not_published" }

/** The device as the server keeps it: HMAC(secret, deviceId|day). Without the device's own id, days can't be linked. */
async function deviceKey(secret: string, deviceId: string, day: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${deviceId}|${day}`)))
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * One anemone (spec 4). The event is inserted only for a published place and only once per key and per device, place
 * and day; the total moves only if this request's nonce is the one stored, so a retry or a race never counts twice.
 * Both statements are one batch, which is one transaction.
 */
export async function leaveTribute(
  db: D1Database,
  secret: string,
  t: { key: string; placeId: string; deviceId: string },
  day: string,
  now: Date,
): Promise<Counted | "key_reused"> {
  const keyHash = await sha256Hex(t.key)
  const nonce = ulid(now.getTime())
  const mine = "EXISTS (SELECT 1 FROM tribute_events WHERE idempotency_key = ?1 AND request_nonce = ?2)"
  const [inserted] = await db.batch([
    db
      .prepare(
        `INSERT INTO tribute_events (idempotency_key, request_nonce, place_id, day, device_key, received_at)
         SELECT ?1, ?2, id, ?3, ?4, ?5 FROM places WHERE id = ?6 AND status = 'published'
         ON CONFLICT DO NOTHING`,
      )
      .bind(keyHash, nonce, day, await deviceKey(secret, t.deviceId, day), now.toISOString(), t.placeId),
    db
      .prepare(
        `INSERT INTO tribute_totals (place_id, total) SELECT ?3, 1 WHERE ${mine}
         ON CONFLICT (place_id) DO UPDATE SET total = total + 1`,
      )
      .bind(keyHash, nonce, t.placeId),
  ])
  if (inserted.meta.changes === 1) return { counted: true, day }
  // Nothing inserted: this anemone was counted before (its answer was lost), the device already left one today, or
  // there is no published place by that id.
  const prior = await db
    .prepare("SELECT place_id, day FROM tribute_events WHERE idempotency_key = ?")
    .bind(keyHash)
    .first<{ place_id: string; day: string }>()
  if (prior) return prior.place_id === t.placeId ? { counted: true, reason: "replayed", day: prior.day } : "key_reused"
  const live = await db.prepare("SELECT 1 FROM places WHERE id = ? AND status = 'published'").bind(t.placeId).first()
  return live ? { counted: false, reason: "already_today", day } : { counted: false, reason: "not_published" }
}

/** The public counts: published places only, so a place taken down takes its count with it. */
export async function tributeTotals(db: D1Database): Promise<Record<string, number>> {
  const { results } = await db
    .prepare(
      "SELECT t.place_id, t.total FROM tribute_totals t JOIN places p ON p.id = t.place_id WHERE p.status = 'published' AND t.total > 0",
    )
    .all<{ place_id: string; total: number }>()
  return Object.fromEntries(results.map((r) => [r.place_id, r.total]))
}
