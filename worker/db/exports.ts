import { RETENTION } from "@/config"
import { durations, MONTH_DAYS, REAL, type Durations } from "../lib/durations"
import { ulid, ulidTime } from "../lib/ids"
import type { SendMail } from "../lib/mail"
import { tellModerators, uploadedAt } from "./retention"
import { gzip, publicKeys, seal, sha256, type Manifest } from "../lib/sealed"
import { log } from "../lib/log"

/**
 * What a backup holds, table by table (spec 8.1). Content and moderation, so a restore loses at most what came after
 * it: places, revisions, contact details, requests, hides, operations under way, the feed's version, the anemones'
 * totals and the audit trail. Not kept: anemone events (a device key, promised gone in 8 days, never in a 35-day
 * backup), the day's abuse codes on requests, and what only runs the jobs (alerts sent, photo watches, deletion runs).
 */
export const EXPORT_TABLES = [
  "places",
  "revisions",
  // A curated revision's photos and every revision's sources (phase 7), after the revisions they belong to.
  "revision_photos",
  "place_sources",
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
/** A new export once the last good one is this many hours old: nightly, in this deployment's hours. */
const EXPORT_EVERY_HOURS = 23

/** `durations`: this deployment's retention day and hour (worker/lib/durations.ts); left out (the tests), real. */
export type ExportEnv = { db: D1Database; media: R2Bucket; exports: R2Bucket; keys: string; durations?: Durations }

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
    .bind(new Date(now.getTime() - EXPORT_EVERY_HOURS * (env.durations ?? REAL).hour).toISOString())
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

  const files = await backUpPhotos(env.media, env.exports, tables)
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
 * The photos the captured database shows or holds (spec 8.1): each published or hidden place's published photo, from
 * public/ or, while a hide covers it, held/. Chosen from the rows just exported, never from the bucket's listing, so a
 * file a deletion left behind (a withdrawal whose cleanup failed, a photo a correction replaced) is never listed again
 * and its copy ends with the last manifest that rightly listed it. Copied under its sha256 unless already there. Not
 * quarantine/: an unapproved photo isn't restored (spec 8.3), and its sender can send it again.
 */
async function backUpPhotos(media: R2Bucket, exports: R2Bucket, tables: Record<string, Record<string, unknown>[]>) {
  const published = new Set(
    (tables.places ?? []).filter((p) => p.status === "published" || p.status === "hidden").map((p) => p.published_revision_id),
  )
  const keys = new Set([
    ...(tables.revisions ?? [])
      .filter((r) => published.has(r.id) && typeof r.photo_key === "string" && r.photo_key.startsWith("public/"))
      .map((r) => r.photo_key as string),
    // A curated place's photos and thumbnails (phase 7).
    ...(tables.revision_photos ?? [])
      .filter((p) => published.has(p.revision_id))
      .flatMap((p) => [p.key, p.thumb_key])
      .filter((k): k is string => typeof k === "string" && k.startsWith("public/")),
  ])
  const files: Manifest["files"] = []
  for (const key of keys)
    for (const name of [key, key.replace(/^public\//, "held/")]) {
      const object = await media.get(name)
      if (!object) continue
      const bytes = new Uint8Array(await object.arrayBuffer())
      const hash = await sha256(bytes)
      const copy = `photos/${hash}`
      if (!(await exports.head(copy)))
        await exports.put(copy, bytes, { httpMetadata: { contentType: object.httpMetadata?.contentType ?? "image/jpeg" } })
      files.push({ key: name, sha256: hash, size: bytes.length })
      break
    }
  return files
}

/** How long an export and the photo copies only it lists are kept (spec 7): the job deletes them at this age. */
export const EXPORT_KEEP_DAYS = 35

/** Each export's age from its id, and its manifest's photos, read from the bucket's own listing. */
async function listExports(exports: R2Bucket) {
  const objects: { key: string; id: string; at: number }[] = []
  let cursor: string | undefined
  do {
    const page = await exports.list({ prefix: "exports/", cursor })
    for (const o of page.objects) {
      const id = o.key.split("/")[1] ?? ""
      objects.push({ key: o.key, id, at: ulidTime(id.replace(/^ex_/, "")) })
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return objects
}
async function listPhotos(exports: R2Bucket) {
  const photos: { key: string; hash: string; uploaded: number }[] = []
  let cursor: string | undefined
  do {
    const page = await exports.list({ prefix: "photos/", cursor })
    for (const o of page.objects) photos.push({ key: o.key, hash: o.key.slice("photos/".length), uploaded: o.uploaded.getTime() })
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return photos
}
/** The photos still listed by a manifest younger than the cutoff. */
async function listedPhotos(exports: R2Bucket, objects: { key: string; at: number }[], cutoff: number) {
  const listed = new Set<string>()
  for (const o of objects)
    if (o.key.endsWith("/manifest.json") && o.at > cutoff) {
      const manifest = (await (await exports.get(o.key))?.json()) as Manifest | undefined
      for (const f of manifest?.files ?? []) listed.add(f.sha256)
    }
  return listed
}

/**
 * The 35-day end (spec 7): every export of that age is deleted, whatever its row says (an unfinished one too), and then
 * every photo copy that no younger manifest lists, once it is a day old (an export under way may not have written its
 * manifest yet). Each file on its own: a deletion the bucket refuses (a copy still under its lock, L-RET-LOCK-1) or
 * that fails is counted in the log and tried again at the next pass, and never stops the files after it, so one young
 * file can't hold back every expired one. An export is recorded deleted only once all its files are. The nightly check
 * reports whatever is still there.
 */
export async function pruneExports(env: { db: D1Database; exports: R2Bucket; durations?: Durations }, now: Date) {
  const { day } = env.durations ?? REAL
  const cutoff = now.getTime() - EXPORT_KEEP_DAYS * day
  const refused = { exports: 0, photos: 0 }
  const remove = async (key: string) => {
    try {
      await env.exports.delete(key)
      return true
    } catch {
      return false
    }
  }
  const objects = await listExports(env.exports)
  const old = objects.filter((o) => !(o.at > cutoff))
  const unfinished = new Set<string>()
  for (const o of old)
    if (!(await remove(o.key))) {
      refused.exports++
      unfinished.add(o.id)
    }
  for (const id of new Set(old.map((o) => o.id)))
    if (!unfinished.has(id))
      await env.db.prepare("UPDATE exports SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL").bind(now.toISOString(), id).run()
  const listed = await listedPhotos(env.exports, objects, cutoff)
  for (const p of await listPhotos(env.exports))
    if (!listed.has(p.hash) && p.uploaded <= now.getTime() - day && !(await remove(p.key))) refused.photos++
  if (refused.exports || refused.photos) log("warn", "export_prune_refused", { counts: refused })
}

/**
 * The nightly deletion check (spec 8.4), from the database and the bucket's own listing: what a deletion date has
 * passed by more than a day, and still holds. Counts by kind, nothing else.
 * - contacts, requests' text, hides' notes, moderators' notes past their dates; addresses never verified past their
 *   link's expiry; submissions past their 30 days;
 *   anemones' records, audit rows and unapproved photos past theirs;
 * - export files older than 35 days, and photo copies no current manifest lists;
 * - no export in the last 26 hours, or no key to make one with.
 */
export async function checkDeletion(
  env: { db: D1Database; exports: R2Bucket; keys: string; durations?: Durations },
  now: Date,
): Promise<Record<string, number>> {
  const { day, hour } = env.durations ?? REAL
  const db = env.db
  const late = new Date(now.getTime() - day).toISOString()
  const before = (days: number) => new Date(now.getTime() - days * day - day).toISOString()
  const counts = await db.batch([
    db.prepare("SELECT COUNT(*) AS n FROM contacts WHERE purge_after <= ?").bind(late),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM reports WHERE purge_after <= ?1 AND (relationship IS NOT NULL OR explanation IS NOT NULL
           OR email IS NOT NULL OR explanation_hash IS NOT NULL OR reporter_key IS NOT NULL OR handling_note IS NOT NULL)`,
      )
      .bind(late),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM field_suppressions WHERE notes_purge_after <= ?1
           AND (reason IS NOT NULL OR basis_detail IS NOT NULL OR basis_note != '')`,
      )
      .bind(late),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM revisions WHERE decision_note IS NOT NULL
           AND (decided_at <= ?1 OR (state IN ('approved', 'rejected', 'superseded') AND decided_at <= ?2))`,
      )
      .bind(before(RETENTION.contactMaxMonths * MONTH_DAYS), before(RETENTION.contactAfterCloseDays)),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM places
         WHERE (status = 'returned' AND status_changed_at <= ?1) OR (status = 'rejected' AND status_changed_at <= ?2)`,
      )
      .bind(before(RETENTION.returnedDays), before(RETENTION.rejectedTextDays)),
    db.prepare("SELECT COUNT(*) AS n FROM exports WHERE ok = 1 AND created_at > ?").bind(new Date(now.getTime() - 26 * hour).toISOString()),
    db.prepare("SELECT MIN(started_at) AS at FROM retention_runs"),
    db.prepare("SELECT COUNT(*) AS n FROM tribute_events WHERE received_at <= ?").bind(before(RETENTION.tributeDays)),
    db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE at <= ?").bind(before(RETENTION.auditMonths * MONTH_DAYS)),
    db.prepare("SELECT photo_key AS k FROM revisions WHERE photo_key LIKE 'quarantine/%' AND state IN ('pending', 'returned')"),
    db
      .prepare("SELECT COUNT(*) AS n FROM contacts WHERE email IS NOT NULL AND email_verified_at IS NULL AND email_verify_expires <= ?")
      .bind(late),
    // A curated revision's waiting photos and thumbnails count too (P7-RET-1).
    db.prepare(
      `SELECT rp.key AS k FROM revision_photos rp JOIN revisions r ON r.id = rp.revision_id
       WHERE rp.key LIKE 'quarantine/%' AND r.state IN ('pending', 'returned')
       UNION ALL
       SELECT rp.thumb_key FROM revision_photos rp JOIN revisions r ON r.id = rp.revision_id
       WHERE rp.thumb_key LIKE 'quarantine/%' AND r.state IN ('pending', 'returned')`,
    ),
  ])
  const n = (i: number) => (counts[i].results[0] as { n: number }).n
  const found: Record<string, number> = {
    contacts: n(0),
    reports: n(1),
    suppression_notes: n(2),
    decision_notes: n(3),
    submissions: n(4),
    tributes: n(7),
    audit: n(8),
    unverified_emails: n(10),
    unapproved_photos: [...(counts[9].results as { k: string }[]), ...(counts[11].results as { k: string }[])].filter(
      (r) => uploadedAt(r.k) <= now.getTime() - RETENTION.rejectedPhotoDays * day,
    ).length,
  }
  const cutoff = now.getTime() - EXPORT_KEEP_DAYS * day
  const objects = await listExports(env.exports)
  found.export_files = objects.filter((o) => !(o.at > cutoff - day)).length
  const listed = await listedPhotos(env.exports, objects, cutoff)
  found.photo_copies = (await listPhotos(env.exports)).filter((p) => !listed.has(p.hash) && p.uploaded <= now.getTime() - 2 * day).length
  const running = (counts[6].results[0] as { at: string | null }).at
  if (!publicKeys(env.keys).length) found.no_export_key = 1
  else if (running && running <= new Date(now.getTime() - 26 * hour).toISOString() && n(5) === 0) found.no_recent_export = 1
  return Object.fromEntries(Object.entries(found).filter(([, v]) => v > 0))
}

/** A breach found by the nightly check, told to the moderators once a day while it lasts: kinds and counts only. */
export async function alertDeletion(db: D1Database, env: Env, sendMail: SendMail, found: Record<string, number>, now: Date) {
  if (!Object.keys(found).length) return false
  const { day } = durations(env)
  const sent = await db.prepare("SELECT sent_at FROM job_alerts WHERE job = 'deletion_check'").first<{ sent_at: string }>()
  if (sent && sent.sent_at > new Date(now.getTime() - day).toISOString()) return false
  const text = [
    'בדיקת המחיקה הלילית של "מקום לזכור" מצאה מידע שמועד המחיקה שלו עבר, או גיבוי שלא נוצר:',
    ...Object.entries(found).map(([k, v]) => `${k}: ${v}`),
    "כדאי לבדוק את היומנים (event: job_failed).",
  ].join("\n")
  return tellModerators(db, env, sendMail, "deletion_check", "מקום לזכור: בדיקת המחיקה מצאה חריגה", text, now)
}
