import { ulid } from "../lib/ids"
import type { SendMail } from "../lib/mail"
import { sha256, unseal, type Manifest } from "../lib/sealed"
import { EXPORT_TABLES } from "./exports"
import { importExport, type ExportPayload } from "./import"
import { replayLedger } from "./replay"
import { tellModerators } from "./retention"

const DAY_MS = 86_400_000
/** A drill loads only an export this fresh (spec 7): an older one would keep its rows in the drill database's history. */
const DRILL_MAX_EXPORT_AGE_MS = 26 * 3600_000

export type DrillEnv = {
  db: D1Database
  exports: R2Bucket
  /** The ledger, replayed onto the restored copy as a restore would. */
  ledger: R2Bucket
  /** The drill database; without it (or the key) no drill runs. */
  drillDb?: D1Database
  /** The drill's private key (a JWK, a secret): one of the recipients every export is sealed to. */
  drillKey?: string
  env: Env
  sendMail: SendMail
}

class Failed extends Error {}
const fail = (code: string): never => {
  throw new Failed(code)
}
async function empty(db: D1Database) {
  await db.batch([...EXPORT_TABLES].reverse().map((t) => db.prepare(`DELETE FROM ${t}`)))
}

/**
 * The weekly restore drill (spec 8.4): the newest export, and only if it is under 26 hours old, is opened with the drill
 * key, checked against its manifest (the data's checksum, each table's checksum and count), imported through the
 * filtered import into the drill database, counted there, the ledger replayed onto it, and every photo copy it lists
 * is read and checked. The drill
 * database is emptied before and after, whatever happened. Checked against the manifest, a fixed point, never against
 * the live site. A failure is recorded by its code and told to the moderators once a day; a failed drill is tried
 * again the next day, a passed one a week later.
 */
export async function runDrill(d: DrillEnv, now: Date): Promise<string | null> {
  if (!d.drillDb || !d.drillKey) return null
  const db = d.db
  const recent = await db
    .prepare("SELECT 1 FROM drill_runs WHERE (ok = 1 AND started_at > ?1) OR started_at > ?2")
    .bind(new Date(now.getTime() - 7 * DAY_MS).toISOString(), new Date(now.getTime() - DAY_MS).toISOString())
    .first()
  if (recent) return null
  const id = `dr_${ulid(now.getTime())}`
  await db.prepare("INSERT INTO drill_runs (id, started_at) VALUES (?, ?)").bind(id, now.toISOString()).run()
  let failure: string | null = null
  let exportId: string | null = null
  try {
    const latest = await db
      .prepare("SELECT id, created_at FROM exports WHERE ok = 1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1")
      .first<{ id: string; created_at: string }>()
    if (!latest) fail("no_export")
    exportId = latest!.id
    if (Date.parse(latest!.created_at) < now.getTime() - DRILL_MAX_EXPORT_AGE_MS) fail("stale_export")
    const manifest = (await (await d.exports.get(`exports/${exportId}/manifest.json`))?.json()) as Manifest | undefined
    if (!manifest) fail("manifest_missing")
    const sealed = await d.exports.get(manifest!.data.key)
    if (!sealed) fail("data_missing")
    const data = new Uint8Array(await sealed!.arrayBuffer())
    if ((await sha256(data)) !== manifest!.data.sha256) fail("data_checksum")
    const plain = await unseal(data, manifest!.data, JSON.parse(d.drillKey) as JsonWebKey).catch((err: Error) =>
      fail(err.message === "not_a_recipient" ? "not_a_recipient" : "unseal"),
    )
    const payload = JSON.parse(
      await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"))).text(),
    ) as ExportPayload
    for (const [t, m] of Object.entries(manifest!.tables)) {
      const rows = payload.tables[t]
      if (!rows || rows.length !== m.rows || (await sha256(new TextEncoder().encode(JSON.stringify(rows)))) !== m.sha256)
        fail("table_checksum")
    }
    await empty(d.drillDb)
    const imported = await importExport(d.drillDb, payload, now)
    if (!imported.ok) fail(`import_${imported.reason}`)
    const counted = await d.drillDb.batch(EXPORT_TABLES.map((t) => d.drillDb!.prepare(`SELECT COUNT(*) AS n FROM ${t}`)))
    for (const [i, t] of EXPORT_TABLES.entries())
      if ((counted[i].results[0] as { n: number }).n !== (imported as { counts: Record<string, number> }).counts[t]) fail("row_counts")
    // Then the decisions since the export, as a restore replays them.
    await replayLedger(d.drillDb, d.ledger, now).catch(() => fail("replay"))
    for (const f of manifest!.files) {
      const copy = await d.exports.get(`photos/${f.sha256}`)
      if (!copy) fail("file_missing")
      if ((await sha256(new Uint8Array(await copy!.arrayBuffer()))) !== f.sha256) fail("file_checksum")
    }
  } catch (err) {
    failure = err instanceof Failed ? err.message : "error"
  } finally {
    await empty(d.drillDb).catch(() => (failure ??= "cleanup"))
  }
  await db
    .prepare("UPDATE drill_runs SET finished_at = ?2, ok = ?3, failure = ?4, export_id = ?5 WHERE id = ?1")
    .bind(id, new Date(Math.max(now.getTime(), Date.now())).toISOString(), failure ? 0 : 1, failure, exportId)
    .run()
  if (failure) {
    console.error(JSON.stringify({ level: "error", event: "drill_failed", failure }))
    const sent = await db.prepare("SELECT sent_at FROM job_alerts WHERE job = 'drill'").first<{ sent_at: string }>()
    if (!sent || sent.sent_at <= new Date(now.getTime() - DAY_MS).toISOString())
      await tellModerators(
        db,
        d.env,
        d.sendMail,
        "drill",
        "מקום לזכור: תרגיל השחזור נכשל",
        `תרגיל השחזור השבועי של "מקום לזכור" נכשל (${failure}). הגיבוי האחרון אולי לא ניתן לשחזור. כדאי לבדוק את היומנים (event: drill_failed).`,
        now,
      )
  }
  return id
}
