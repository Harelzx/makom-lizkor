import { ulid } from "../lib/ids"
import { gzip, publicKeys, seal, sha256, type Manifest } from "../lib/sealed"

/**
 * What a backup holds, table by table (spec 8.1). Content and moderation, so a restore loses at most what came after
 * it: places, revisions, contact details, requests, hides, operations under way, the feed's version, the anemones'
 * totals and the audit trail. Not kept: anemone events (a device key, promised gone in 8 days, never in a 35-day
 * backup), the day's abuse codes on requests, and what only runs the jobs (alerts sent, photo watches, deletion runs).
 */
export const EXPORT_TABLES = [
  "places",
  "revisions",
  "contacts",
  "reports",
  "field_suppressions",
  "visibility_ops",
  "feed_state",
  "tribute_totals",
  "audit_log",
] as const
export type ExportTable = (typeof EXPORT_TABLES)[number]
// Columns left out (as null): the abuse codes exist only for the day's counts.
const LEFT_OUT: Partial<Record<ExportTable, string[]>> = { reports: ["reporter_key", "explanation_hash"] }
/** One export a day: the job runs every 15 minutes, and the next export is due a little under a day after the last. */
const EXPORT_EVERY_MS = 23 * 3600_000

export type ExportEnv = { db: D1Database; media: R2Bucket; exports: R2Bucket; keys: string }

/**
 * The nightly export, called only after the deletion run of the same pass finished (spec 7: deletion before export).
 * Every table from one moment (a single batch is one transaction), compressed and sealed to the configured keys; the
 * live photos copied by their sha256 first, so the manifest lists only copies that are there. The row is written
 * before anything is copied and marked ok only once the manifest is written; a failed one's files go at 35 days too.
 */
export async function runExport(env: ExportEnv, retentionRun: string, now: Date): Promise<string | null> {
  const recipients = publicKeys(env.keys)
  if (!recipients.length) return null
  const db = env.db
  const at = now.toISOString()
  const recent = await db
    .prepare("SELECT 1 FROM exports WHERE ok = 1 AND created_at > ?")
    .bind(new Date(now.getTime() - EXPORT_EVERY_MS).toISOString())
    .first()
  if (recent) return null
  const id = `ex_${ulid(now.getTime())}`
  await db.prepare("INSERT INTO exports (id, created_at, retention_run) VALUES (?, ?, ?)").bind(id, at, retentionRun).run()

  const [schema, ...results] = await db.batch([
    db.prepare("SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1"),
    ...EXPORT_TABLES.map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY rowid`)),
  ])
  const tables: Record<string, Record<string, unknown>[]> = {}
  const counts: Manifest["tables"] = {}
  for (const [i, t] of EXPORT_TABLES.entries()) {
    const rows = (results[i].results as Record<string, unknown>[]).map((r) => {
      for (const c of LEFT_OUT[t] ?? []) r[c] = null
      return r
    })
    tables[t] = rows
    counts[t] = { rows: rows.length, sha256: await sha256(new TextEncoder().encode(JSON.stringify(rows))) }
  }
  const name = (schema.results[0] as { name: string } | undefined)?.name ?? null

  const files = await backUpPhotos(env.media, env.exports)
  const plain = new TextEncoder().encode(JSON.stringify({ format: 1, id, created_at: at, schema: name, tables }))
  const sealed = await seal(await gzip(plain), recipients)
  const dataKey = `exports/${id}/data.bin`
  await env.exports.put(dataKey, sealed.ciphertext)
  const manifest: Manifest = {
    format: 1,
    id,
    created_at: at,
    retention_run: retentionRun,
    schema: name,
    tables: counts,
    data: {
      key: dataKey,
      sha256: await sha256(sealed.ciphertext),
      size: sealed.ciphertext.length,
      iv: sealed.iv,
      recipients: sealed.recipients,
    },
    files,
  }
  await env.exports.put(`exports/${id}/manifest.json`, JSON.stringify(manifest), { httpMetadata: { contentType: "application/json" } })
  await db.prepare("UPDATE exports SET ok = 1 WHERE id = ?").bind(id).run()
  return id
}

/**
 * Every published or held photo, copied into the export bucket under its sha256 unless a copy is already there. Not
 * quarantine/: an unapproved photo isn't restored (spec 8.3), and its sender can send it again.
 */
async function backUpPhotos(media: R2Bucket, exports: R2Bucket) {
  const files: Manifest["files"] = []
  for (const prefix of ["public/", "held/"]) {
    let cursor: string | undefined
    do {
      const page = await media.list({ prefix, cursor })
      for (const o of page.objects) {
        const object = await media.get(o.key)
        if (!object) continue
        const bytes = new Uint8Array(await object.arrayBuffer())
        const hash = await sha256(bytes)
        const copy = `photos/${hash}`
        if (!(await exports.head(copy))) await exports.put(copy, bytes, { httpMetadata: { contentType: "image/jpeg" } })
        files.push({ key: o.key, sha256: hash, size: bytes.length })
      }
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
  }
  return files
}
