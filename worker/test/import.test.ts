import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import { EXPORT_TABLES, runExport } from "../db/exports"
import { importExport, type ExportPayload } from "../db/import"
import { readFeed } from "../db/places"
import { runRetention } from "../db/retention"
import { ulid } from "../lib/ids"
import { unseal, type Manifest } from "../lib/sealed"
import { approve } from "./helpers"
import { decide, queued, revise, rev, send } from "./submission-helpers"

const DAY = 86_400_000
// The export is taken at E; the restore runs at R, ten days later. Every rule below falls due in between, so the
// export holds it and only the import's filter can keep it out.
const R = new Date(Date.now() + 3000 * DAY)
const E = new Date(R.getTime() - 10 * DAY)
const iso = (t: Date, days: number, ms = 0) => new Date(t.getTime() + days * DAY + ms).toISOString()
let keys: CryptoKeyPair

beforeAll(async () => {
  await applyD1Migrations(env.IMPORT_TEST, env.TEST_MIGRATIONS)
  keys = (await crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"],
  )) as CryptoKeyPair
})
beforeEach(async () => {
  for (const t of [...EXPORT_TABLES].reverse()) await env.IMPORT_TEST.prepare(`DELETE FROM ${t}`).run()
})

/** The database as a restore writes it, with every value it is ever given recorded. */
function recording(db: D1Database) {
  const bound: unknown[] = []
  const proxy = new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare")
        return (sql: string) => {
          const statement = target.prepare(sql)
          return new Proxy(statement, {
            get(s, p) {
              if (p === "bind") return (...values: unknown[]) => (bound.push(...values), s.bind(...values))
              const v = Reflect.get(s, p)
              return typeof v === "function" ? v.bind(s) : v
            },
          })
        }
      const v = Reflect.get(target, prop)
      return typeof v === "function" ? v.bind(target) : v
    },
  })
  return { db: proxy, bound }
}

async function exported(): Promise<ExportPayload> {
  const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey)
  // One export a day: each test takes its own at the same moment.
  await env.DB.prepare("DELETE FROM exports").run()
  const id = (await runExport({ db: env.DB, media: env.MEDIA, exports: env.EXPORTS, keys: JSON.stringify([jwk]) }, "rr_test", E))!
  const manifest = (await (await env.EXPORTS.get(`exports/${id}/manifest.json`))!.json()) as Manifest
  const data = new Uint8Array(await (await env.EXPORTS.get(manifest.data.key))!.arrayBuffer())
  const plain = await unseal(data, manifest.data, (await crypto.subtle.exportKey("jwk", keys.privateKey)) as JsonWebKey)
  return JSON.parse(await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"))).text()) as ExportPayload
}

const contact = (placeId: string, name: string, purgeAfter: string) =>
  env.DB.prepare(
    `INSERT INTO contacts (id, place_id, name, email, consent_version, created_at, ceiling_at, purge_after)
     VALUES (?, ?, ?, 'demo@example.test', 'v', ?, ?, ?)`,
  )
    .bind(`c_${crypto.randomUUID()}`, placeId, name, iso(E, -60), iso(R, 300), purgeAfter)
    .run()

describe("a restore through the filtered import (spec 7, Route B)", () => {
  it("never writes what fell due after the export, and leaves the deletion job nothing to do", async () => {
    // Returned 31 days before the restore: due. Returned 29 days before: kept.
    const due = await send("ספסל דמו שהוחזר ונמחק בייבוא")
    expect((await decide(due.id, await queued(due.id), "return", "הערה שעבר מועדה")).status).toBe(200)
    await env.DB.prepare("UPDATE places SET status_changed_at = ? WHERE id = ?").bind(iso(R, -31), due.id).run()
    await contact(due.id, "שם דמו של הצעה שנמחקה", iso(R, 200))
    const kept = await send("ספסל דמו שהוחזר ונשמר")
    expect((await decide(kept.id, await queued(kept.id), "return", "הערה שנשמרת")).status).toBe(200)
    await env.DB.prepare("UPDATE places SET status_changed_at = ? WHERE id = ?").bind(iso(R, -29), kept.id).run()
    await env.DB.prepare("UPDATE revisions SET decided_at = ? WHERE place_id = ?").bind(iso(R, -29), kept.id).run()
    await contact(kept.id, "שם דמו שנשמר", iso(R, 200))
    const refused = await send("ספסל דמו שנדחה ונמחק בייבוא")
    expect((await decide(refused.id, await queued(refused.id), "reject")).status).toBe(200)
    await env.DB.prepare("UPDATE places SET status_changed_at = ? WHERE id = ?").bind(iso(R, -31), refused.id).run()

    // A published place: its returned correction expired; its contact, a hide's note and a request fell due.
    const live = await send("גן דמו שפורסם ושוחזר")
    await approve(live.id)
    expect((await revise(live.id, live.trackingToken, await rev(live.id, live.trackingToken), "תיקון דמו שפג בייבוא")).status).toBe(200)
    expect((await decide(live.id, await queued(live.id), "return", "הערה על תיקון שפג")).status).toBe(200)
    await env.DB.prepare("UPDATE revisions SET decided_at = ? WHERE place_id = ? AND state = 'returned'").bind(iso(R, -31), live.id).run()
    await contact(live.id, "שם דמו שמועדו עבר", iso(R, 0, -3600_000))
    await env.DB.prepare(
      `INSERT INTO field_suppressions (id, place_id, field, kind, revision_n, created_at, created_by, reason, notes_ceiling_at, notes_purge_after)
       VALUES (?, ?, 'story_he', 'manual', 1, ?, 'dev@example.test', 'נימוק שעבר מועדו', ?, ?)`,
    )
      .bind(`s_${crypto.randomUUID()}`, live.id, iso(E, -5), iso(R, 300), iso(R, 0, -3600_000))
      .run()
    await env.DB.prepare(
      `INSERT INTO reports (id, place_id, origin, elements, requester_type, relationship, explanation, email, notice_version,
         submit_key_hash, body_hash, explanation_hash, reporter_key, complete, outcome, status, received_at, ceiling_at, purge_after)
       VALUES (?, ?, 'contribution', '["story_he"]', 'family', 'קרבה דמו', 'הסבר שעבר מועדו', 'reporter@example.test', 'v', ?, 'h', NULL, NULL,
         1, 'received', 'closed', ?, ?, ?)`,
    )
      .bind(`r_${crypto.randomUUID()}`, live.id, crypto.randomUUID(), iso(E, -20), iso(R, 300), iso(R, 0, -3600_000))
      .run()
    // An approval's note, 91 days after it was written.
    const noted = await send("ספסל דמו עם הערת אישור ישנה")
    await approve(noted.id)
    await env.DB.prepare("UPDATE revisions SET decision_note = 'הערת אישור שעבר מועדה', decided_at = ? WHERE place_id = ?")
      .bind(iso(R, -91), noted.id)
      .run()

    // An audit row and a waiting photo past their dates by the restore (24 months; 29 days from the upload).
    await env.DB.prepare("INSERT INTO audit_log (id, at, actor, action, entity_id) VALUES (?, ?, 'automatic', 'erase', ?)")
      .bind(`a_old_${live.id}`, iso(R, -721), live.id)
      .run()
    const waiting = await send("ספסל דמו שתמונתו חיכתה")
    await env.DB.prepare("UPDATE revisions SET photo_key = ?, photo_alt = 'תיאור תמונה שחיכתה', photo_credit = 'צלם' WHERE place_id = ?")
      .bind(`quarantine/${waiting.id}/r_x-${ulid(R.getTime() - 30 * DAY)}.jpg`, waiting.id)
      .run()
    const payload = await exported()
    // The export holds every one of them: the filter is what keeps them out.
    const all = JSON.stringify(payload.tables)
    for (const text of ["שם דמו של הצעה שנמחקה", "תיקון דמו שפג בייבוא", "שם דמו שמועדו עבר", "נימוק שעבר מועדו", "הסבר שעבר מועדו"])
      expect(all).toContain(text)

    const target = recording(env.IMPORT_TEST)
    expect(await importExport(target.db, payload, R)).toMatchObject({ ok: true })
    const written = JSON.stringify(target.bound)
    for (const text of [
      "ספסל דמו שהוחזר ונמחק בייבוא",
      "הערה שעבר מועדה",
      "שם דמו של הצעה שנמחקה",
      "ספסל דמו שנדחה ונמחק בייבוא",
      "תיקון דמו שפג בייבוא",
      "הערה על תיקון שפג",
      "שם דמו שמועדו עבר",
      "נימוק שעבר מועדו",
      "הסבר שעבר מועדו",
      "reporter@example.test",
      "הערת אישור שעבר מועדה",
      `a_old_${live.id}`,
      "תיאור תמונה שחיכתה",
    ])
      expect(written).not.toContain(text)
    // What was not due arrives whole.
    for (const text of ["ספסל דמו שהוחזר ונשמר", "הערה שנשמרת", "שם דמו שנשמר", "גן דמו שפורסם ושוחזר"]) expect(written).toContain(text)

    const statuses = async (db: D1Database) =>
      Object.fromEntries(
        (
          await db
            .prepare("SELECT id, status FROM places WHERE id IN (?, ?, ?, ?, ?)")
            .bind(due.id, kept.id, refused.id, live.id, noted.id)
            .all()
        ).results.map((p) => [p.id, p.status]),
      )
    expect(await statuses(env.IMPORT_TEST)).toEqual({
      [due.id]: "erased",
      [kept.id]: "returned",
      [refused.id]: "erased",
      [live.id]: "published",
      [noted.id]: "published",
    })
    // The deletion job, run on the restored database at that moment, finds nothing it would delete.
    const run = await runRetention({ db: env.IMPORT_TEST, media: env.MEDIA, ledger: env.LEDGER, purge: async () => true }, R)
    // Every part of it, whatever parts the job has.
    expect(run.ok).toBe(true)
    expect(Object.entries(run.counts).filter(([, n]) => n !== 0)).toEqual([])
    // And the public map is the same as the one the export was taken from.
    expect((await readFeed(env.IMPORT_TEST, "0")).places).toEqual((await readFeed(env.DB, "0")).places)
  })

  it("goes only into an empty database of the export's own schema", async () => {
    const payload = await exported()
    expect(await importExport(env.IMPORT_TEST, { ...payload, schema: "0001_places.sql" }, R)).toEqual({ ok: false, reason: "schema" })
    expect(await importExport(env.IMPORT_TEST, payload, R)).toMatchObject({ ok: true })
    expect(await importExport(env.IMPORT_TEST, payload, R)).toEqual({ ok: false, reason: "not_empty" })
  })

  it("refuses a column the database doesn't have, before writing anything", async () => {
    const payload = await exported()
    payload.tables.places[0] = { ...payload.tables.places[0], "status = 'published' --": 1 }
    expect(await importExport(env.IMPORT_TEST, payload, R)).toEqual({ ok: false, reason: "columns" })
    expect(await env.IMPORT_TEST.prepare("SELECT COUNT(*) AS n FROM places").first<number>("n")).toBe(0)
  })
})
