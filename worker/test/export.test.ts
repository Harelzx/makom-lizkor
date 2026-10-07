import { env } from "cloudflare:workers"
import { beforeAll, describe, expect, it } from "vitest"
import { checkDeletion, EXPORT_TABLES } from "../db/exports"
import { runJobs } from "../jobs"
import { sha256Hex, ulid } from "../lib/ids"
import { sendMail } from "../lib/mail"
import { unseal, type Manifest } from "../lib/sealed"
import { call } from "./app"
import { decide, jpeg, queued, send, upload } from "./submission-helpers"

const DAY = 86_400_000
const deps = { sendMail, purge: async () => true }
let keys: CryptoKeyPair
let withKeys: Env

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"],
  )) as CryptoKeyPair
  withKeys = { ...env, EXPORT_PUBLIC_KEYS: JSON.stringify([await crypto.subtle.exportKey("jwk", keys.publicKey)]) }
})

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
const sha = async (bytes: ArrayBuffer | Uint8Array) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
const exportsAfter = (since: string) =>
  env.DB.prepare("SELECT id, ok, retention_run FROM exports WHERE created_at >= ? ORDER BY created_at")
    .bind(since)
    .all<{ id: string; ok: number; retention_run: string }>()
    .then((r) => r.results)
const manifestOf = async (id: string) => (await (await env.EXPORTS.get(`exports/${id}/manifest.json`))!.json()) as Manifest
const gunzip = async (bytes: Uint8Array) =>
  JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text()) as {
    tables: Record<string, Record<string, unknown>[]>
  }

async function publishedWithPhoto(name: string, fill = 0x55) {
  const { id, trackingToken } = await send(name)
  expect((await upload(id, trackingToken, jpeg(fill))).status).toBe(200)
  expect((await decide(id, await queued(id), "approve")).status).toBe(200)
  return id
}

describe("the nightly export (spec 8.1)", () => {
  it("follows a finished deletion run: encrypted, with a manifest of counts and checksums, and the photos it names copied", async () => {
    const id = await publishedWithPhoto("גן דמו בייצוא")
    await call("http://local/api/v1/tributes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID().replaceAll("-", "") },
      body: JSON.stringify({ placeId: id, deviceId: crypto.randomUUID().replaceAll("-", "") }),
    })
    const at = new Date(Date.now() + 1000 * DAY)
    await runJobs(withKeys, deps, undefined, at)
    const [row] = await exportsAfter(at.toISOString())
    expect(row).toMatchObject({ ok: 1 })
    const run = await env.DB.prepare("SELECT ok FROM retention_runs WHERE id = ?").bind(row.retention_run).first<{ ok: number }>()
    expect(run?.ok).toBe(1)

    const manifest = await manifestOf(row.id)
    expect(Object.keys(manifest.tables).sort()).toEqual([...EXPORT_TABLES].sort())
    // Only counts and checksums, nothing written by anyone.
    expect(JSON.stringify(manifest)).not.toContain("גן דמו")
    for (const t of EXPORT_TABLES) {
      const n = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())!.n
      expect(manifest.tables[t].rows).toBe(n)
    }

    const data = new Uint8Array(await (await env.EXPORTS.get(manifest.data.key))!.arrayBuffer())
    expect(await sha(data)).toBe(manifest.data.sha256)
    const payload = await gunzip(await unseal(data, manifest.data, (await crypto.subtle.exportKey("jwk", keys.privateKey)) as JsonWebKey))
    for (const t of EXPORT_TABLES) expect(await sha256Hex(JSON.stringify(payload.tables[t]))).toBe(manifest.tables[t].sha256)
    expect(payload.tables.places.some((p) => p.id === id)).toBe(true)
    // A tribute's device key is kept 8 days, never in a 35-day export; the day's abuse codes neither.
    expect(payload.tables.tribute_events).toBeUndefined()
    expect(payload.tables.reports.every((r) => r.reporter_key === null && r.explanation_hash === null)).toBe(true)

    const key = (await env.DB.prepare(
      "SELECT r.photo_key AS key FROM places p JOIN revisions r ON r.id = p.published_revision_id WHERE p.id = ?",
    )
      .bind(id)
      .first<{ key: string }>())!.key
    const original = await sha(await (await env.MEDIA.get(key))!.arrayBuffer())
    expect(manifest.files).toContainEqual(expect.objectContaining({ key, sha256: original }))
    expect(await sha(await (await env.EXPORTS.get(`photos/${original}`))!.arrayBuffer())).toBe(original)
  })

  it("is written once a day", async () => {
    const at = new Date(Date.now() + 1100 * DAY)
    await runJobs(withKeys, deps, undefined, at)
    await runJobs(withKeys, deps, undefined, new Date(at.getTime() + 3600_000))
    expect(await exportsAfter(at.toISOString())).toHaveLength(1)
    await runJobs(withKeys, deps, undefined, new Date(at.getTime() + DAY))
    expect(await exportsAfter(at.toISOString())).toHaveLength(2)
  })

  it("waits when the deletion run of its pass didn't finish: nothing that should be gone goes into a backup", async () => {
    const failing = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "prepare")
          return (sql: string) => {
            if (sql.startsWith("DELETE FROM contacts WHERE purge_after")) throw new Error("bad row")
            return target.prepare(sql)
          }
        const v = Reflect.get(target, prop)
        return typeof v === "function" ? v.bind(target) : v
      },
    })
    const at = new Date(Date.now() + 1200 * DAY)
    await runJobs({ ...withKeys, DB: failing }, deps, undefined, at)
    expect(await exportsAfter(at.toISOString())).toHaveLength(0)
  })

  it("isn't written without a key to encrypt it to", async () => {
    const at = new Date(Date.now() + 1300 * DAY)
    await runJobs({ ...withKeys, EXPORT_PUBLIC_KEYS: "" }, deps, undefined, at)
    expect(await exportsAfter(at.toISOString())).toHaveLength(0)
  })
})

describe("an export's 35 days (spec 7, 8.4)", () => {
  it("are its last: the export goes, and with it every photo copy no later export lists", async () => {
    const kept = await publishedWithPhoto("גן דמו שנשאר בגיבוי", 0x31)
    const gone = await publishedWithPhoto("גן דמו שנמשך מהגיבוי", 0x32)
    const photoOf = async (id: string) =>
      (await env.DB.prepare("SELECT r.photo_key AS key FROM places p JOIN revisions r ON r.id = p.published_revision_id WHERE p.id = ?")
        .bind(id)
        .first<{ key: string }>())!.key
    const keptHash = await sha(await (await env.MEDIA.get(await photoOf(kept)))!.arrayBuffer())
    const goneHash = await sha(await (await env.MEDIA.get(await photoOf(gone)))!.arrayBuffer())
    const t0 = new Date(Date.now() + 1400 * DAY)
    await runJobs(withKeys, deps, undefined, t0)
    const [first] = await exportsAfter(t0.toISOString())
    // Withdrawn after the first export: the next one no longer lists its photo.
    await env.DB.prepare("UPDATE places SET status = 'withdrawn' WHERE id = ?").bind(gone).run()
    await env.MEDIA.delete(await photoOf(gone)).catch(() => undefined)
    for (const prefix of ["public/", "held/", "quarantine/"])
      for (const o of (await env.MEDIA.list({ prefix: `${prefix}${gone}/` })).objects) await env.MEDIA.delete(o.key)
    await runJobs(withKeys, deps, undefined, new Date(t0.getTime() + DAY))
    expect(await env.EXPORTS.head(`photos/${goneHash}`)).not.toBeNull()
    expect(keptHash).not.toBe(goneHash)

    await runJobs(withKeys, deps, undefined, new Date(t0.getTime() + 35.5 * DAY))
    expect((await env.EXPORTS.list({ prefix: `exports/${first.id}/` })).objects).toHaveLength(0)
    expect(await env.DB.prepare("SELECT deleted_at FROM exports WHERE id = ?").bind(first.id).first<string>("deleted_at")).not.toBeNull()
    expect(await env.EXPORTS.head(`photos/${goneHash}`)).toBeNull()
    expect(await env.EXPORTS.head(`photos/${keptHash}`)).not.toBeNull()
  })

  it("are checked every night from the bucket's own listing and the database, and a breach is told to the moderators", async () => {
    const at = new Date(Date.now() + 1600 * DAY)
    await runJobs(withKeys, deps, undefined, at)
    expect(await checkDeletion({ db: env.DB, exports: env.EXPORTS, keys: withKeys.EXPORT_PUBLIC_KEYS }, at)).toEqual({})
    // A copy the pruning missed, a contact the deletion missed, a photo copy nothing lists any more.
    await env.EXPORTS.put(`exports/ex_${ulid(at.getTime() - 37 * DAY)}/data.bin`, "sealed")
    const { id } = await send("ספסל דמו לבדיקה הלילית")
    await env.DB.prepare(
      `INSERT INTO contacts (id, place_id, name, consent_version, created_at, ceiling_at, purge_after) VALUES (?, ?, 'שם דמו', 'v', ?, ?, ?)`,
    )
      .bind(
        `c_${crypto.randomUUID()}`,
        id,
        new Date(at.getTime() - 100 * DAY).toISOString(),
        new Date(at.getTime() - 2 * DAY).toISOString(),
        new Date(at.getTime() - 2 * DAY).toISOString(),
      )
      .run()
    await env.EXPORTS.put("photos/0000000000000000000000000000000000000000000000000000000000000000", "jpeg")
    const later = new Date(at.getTime() + 40 * DAY)
    const found = await checkDeletion({ db: env.DB, exports: env.EXPORTS, keys: withKeys.EXPORT_PUBLIC_KEYS }, later)
    // The planted copy, and both files of the export 40 days back; with no manifest younger than 35 days, every photo
    // copy is listed by none.
    const copies = (await env.EXPORTS.list({ prefix: "photos/" })).objects.length
    expect(found).toEqual({ contacts: 1, export_files: 3, photo_copies: copies, no_recent_export: 1 })
    await env.DB.prepare("DELETE FROM dev_outbox WHERE subject LIKE '%בדיקת המחיקה%'").run()
    // The pass's own deletion and pruning fix what they can; what is left is told once a day, codes and counts only.
    const failing = new Proxy(env.EXPORTS, {
      get(target, prop) {
        if (prop === "delete")
          return async () => {
            throw new Error("refused")
          }
        const v = Reflect.get(target, prop)
        return typeof v === "function" ? v.bind(target) : v
      },
    })
    await runJobs({ ...withKeys, EXPORTS: failing }, deps, undefined, later)
    await runJobs({ ...withKeys, EXPORTS: failing }, deps, undefined, new Date(later.getTime() + 3600_000))
    const told = (
      await env.DB.prepare("SELECT to_address, body FROM dev_outbox WHERE subject LIKE '%בדיקת המחיקה%'").all<{
        to_address: string
        body: string
      }>()
    ).results
    expect(told.map((m) => m.to_address)).toEqual(["dev@example.test"])
    expect(told[0].body).toContain("export_files")
    expect(told[0].body).not.toContain("ספסל")
  })

  it("also counts anemones' records, audit rows, waiting photos and unverified addresses past their dates", async () => {
    const at = new Date(Date.now() + 1700 * DAY)
    await runJobs(withKeys, deps, undefined, at)
    await send("ספסל דמו שהכתובת שלו לא אומתה", { email: "stale-unverified-demo@example.test" })
    const { id, trackingToken } = await send("ספסל דמו שתמונתו ממתינה")
    expect((await upload(id, trackingToken, jpeg(0x51))).status).toBe(200)
    await env.DB.prepare(
      "INSERT INTO tribute_events (idempotency_key, request_nonce, place_id, day, device_key, received_at) VALUES (?, 'n', ?, '2020-01-01', 'd', ?)",
    )
      .bind(`t_${id}`, id, new Date(at.getTime() - 10 * DAY).toISOString())
      .run()
    await env.DB.prepare("INSERT INTO audit_log (id, at, actor, action, entity_id) VALUES (?, ?, 'automatic', 'erase', ?)")
      .bind(`a_${id}`, new Date(at.getTime() - 800 * DAY).toISOString(), id)
      .run()
    const found = await checkDeletion({ db: env.DB, exports: env.EXPORTS, keys: withKeys.EXPORT_PUBLIC_KEYS }, at)
    expect(found).toMatchObject({ tributes: 1, audit: 1, unapproved_photos: 1, unverified_emails: 1 })
  })
})

// L-RET-EVIDENCE-1 (a89): on staging's two-hour day the export runs every 23 staged hours (115 minutes) and an export
// lives 35 staged days (70 hours), its photo copies with it unless a later export lists them.
describe("on staging's scale (L-RET A2)", () => {
  const MIN = 60_000
  const HOUR = 3_600_000
  const staged = () => ({ ...withKeys, ENVIRONMENT: "staging", RETENTION_DAY_SECONDS: "7200" }) as Env

  it("writes the next export once 115 minutes have passed, not before", async () => {
    const at = new Date(Date.now() + 1900 * DAY)
    await runJobs(staged(), deps, undefined, at)
    expect(await exportsAfter(at.toISOString())).toHaveLength(1)
    await runJobs(staged(), deps, undefined, new Date(at.getTime() + 110 * MIN))
    expect(await exportsAfter(at.toISOString())).toHaveLength(1)
    await runJobs(staged(), deps, undefined, new Date(at.getTime() + 116 * MIN))
    expect(await exportsAfter(at.toISOString())).toHaveLength(2)
  })

  it("prunes an export after 70 hours, and the photo copies no later export lists, keeping the ones still listed", async () => {
    const kept = await publishedWithPhoto("גן דמו שנשאר בגיבוי המקוצר", 0x61)
    const gone = await publishedWithPhoto("גן דמו שנמשך מהגיבוי המקוצר", 0x62)
    const photoOf = async (id: string) =>
      (await env.DB.prepare("SELECT r.photo_key AS key FROM places p JOIN revisions r ON r.id = p.published_revision_id WHERE p.id = ?")
        .bind(id)
        .first<{ key: string }>())!.key
    const keptHash = await sha(await (await env.MEDIA.get(await photoOf(kept)))!.arrayBuffer())
    const goneHash = await sha(await (await env.MEDIA.get(await photoOf(gone)))!.arrayBuffer())
    const t0 = new Date(Date.now() + 2000 * DAY)
    await runJobs(staged(), deps, undefined, t0)
    const [first] = await exportsAfter(t0.toISOString())
    await env.DB.prepare("UPDATE places SET status = 'withdrawn' WHERE id = ?").bind(gone).run()
    for (const prefix of ["public/", "held/", "quarantine/"])
      for (const o of (await env.MEDIA.list({ prefix: `${prefix}${gone}/` })).objects) await env.MEDIA.delete(o.key)
    await runJobs(staged(), deps, undefined, new Date(t0.getTime() + 2 * HOUR))
    expect(await exportsAfter(t0.toISOString())).toHaveLength(2)

    // At 69 hours the first export and its photo copies are still there; at 71 they are gone.
    await runJobs(staged(), deps, undefined, new Date(t0.getTime() + 69 * HOUR))
    expect((await env.EXPORTS.list({ prefix: `exports/${first.id}/` })).objects.length).toBeGreaterThan(0)
    expect(await env.EXPORTS.head(`photos/${goneHash}`)).not.toBeNull()
    await runJobs(staged(), deps, undefined, new Date(t0.getTime() + 71 * HOUR))
    expect((await env.EXPORTS.list({ prefix: `exports/${first.id}/` })).objects).toHaveLength(0)
    expect(await env.DB.prepare("SELECT deleted_at FROM exports WHERE id = ?").bind(first.id).first<string>("deleted_at")).not.toBeNull()
    expect(await env.EXPORTS.head(`photos/${goneHash}`)).toBeNull()
    expect(await env.EXPORTS.head(`photos/${keptHash}`)).not.toBeNull()
  })
})
