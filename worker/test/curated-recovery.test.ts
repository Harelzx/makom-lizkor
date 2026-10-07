import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import type { PublicCuratedPlace } from "@/shared/contract"
import { CuratedInput } from "@/shared/curated"
import { storeCurated } from "../db/curated"
import { checkDeletion, EXPORT_TABLES, runExport } from "../db/exports"
import { filterForImport, importExport, type ExportPayload } from "../db/import"
import { REAL } from "../lib/durations"
import { readFeed } from "../db/places"
import { readLedger, replayLedger } from "../db/replay"
import { runRetention } from "../db/retention"
import { unseal, type Manifest } from "../lib/sealed"
import { body, newId, sources, uploadPhoto } from "./curated-helpers"
import { decide, queued } from "./submission-helpers"

// A curated record's photos and sources through the paths a decision, the retention job and a restore take
// (adviser 20261007T044919Z-b055dc34: P7-RET-1, P7-REC-1):
// - an unapproved curated photo expires at the same deadline as a contribution's, is removed at once when its record is
//   refused, is left out of a restore past its days, and is what the deletion check counts while it lingers;
// - an approval replayed onto a copy taken while the record waited publishes exactly the photos it published, each at
//   its index with its credit and source, or hides the place until a moderator looks; a replayed erasure leaves no
//   photo row or source behind; a second replay changes nothing.

const DAY_MS = 86_400_000
let keys: CryptoKeyPair
let pub: string
beforeAll(async () => {
  await applyD1Migrations(env.IMPORT_TEST, env.TEST_MIGRATIONS)
  keys = (await crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"],
  )) as CryptoKeyPair
  pub = JSON.stringify([await crypto.subtle.exportKey("jwk", keys.publicKey)])
})
beforeEach(async () => {
  for (const t of [...EXPORT_TABLES].reverse()) await env.IMPORT_TEST.prepare(`DELETE FROM ${t}`).run()
})

async function exportNow(): Promise<ExportPayload> {
  await env.DB.prepare("DELETE FROM exports").run()
  const id = (await runExport({ db: env.DB, media: env.MEDIA, exports: env.EXPORTS, keys: pub }, "rr_test", new Date()))!
  const manifest = (await (await env.EXPORTS.get(`exports/${id}/manifest.json`))!.json()) as Manifest
  const data = new Uint8Array(await (await env.EXPORTS.get(manifest.data.key))!.arrayBuffer())
  const plain = await unseal(data, manifest.data, (await crypto.subtle.exportKey("jwk", keys.privateKey)) as JsonWebKey)
  return JSON.parse(await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"))).text()) as ExportPayload
}
const opEnv = { db: env.DB, media: env.MEDIA, ledger: env.LEDGER, purge: async () => true }
const curatedIn = async (db: D1Database, id: string) =>
  (await readFeed(db, "0")).places.find((p) => p.id === id) as PublicCuratedPlace | undefined
const photoRows = (db: D1Database, id: string) =>
  db
    .prepare(
      `SELECT rp.idx, rp.key, rp.thumb_key, rp.title FROM revision_photos rp JOIN revisions r ON r.id = rp.revision_id
       WHERE r.place_id = ? ORDER BY r.n, rp.idx`,
    )
    .bind(id)
    .all<{ idx: number; key: string; thumb_key: string; title: string }>()
    .then((r) => r.results)
const sourceRows = (db: D1Database, id: string) =>
  db
    .prepare("SELECT field, photo_idx FROM place_sources WHERE place_id = ? ORDER BY field, photo_idx")
    .bind(id)
    .all()
    .then((r) => r.results)
const hides = (db: D1Database, id: string) =>
  db
    .prepare("SELECT field, kind FROM field_suppressions WHERE place_id = ? AND lifted_at IS NULL")
    .bind(id)
    .all()
    .then((r) => r.results)
const filesOf = async (id: string) => (await env.MEDIA.list()).objects.map((o) => o.key).filter((k) => k.includes(id))

/** A curated record stored as a moderator's draft (pending), with `n` photos each of its own bytes and credit. */
async function draft(id: string, n = 2) {
  const photos = []
  for (let i = 0; i < n; i++) {
    const p = await uploadPhoto(id, 0x30 + i * 0x10)
    photos.push({ key: p.key, thumb_key: p.thumb_key, title: `צילום דמו ${i + 1}`, author: `צלם ${i + 1}`, license: "CC0" })
  }
  const photoSources = photos.map((_, i) => ({ field: "photo", photo_idx: i, source: "commons", license: "CC0", retrieved_approx: false }))
  const input = CuratedInput.parse(body(id, { photos, sources: [...sources, ...photoSources] }))
  expect(await storeCurated(env.DB, env.MEDIA, input, crypto.randomUUID(), new Date())).toMatchObject({ kind: "stored" })
  return photos
}

describe("a curated draft's unapproved photos (P7-RET-1)", () => {
  it("expire at the deadline: the rows, their sources and the files go, the place's rev moves on, and the check counts them until then", async () => {
    const id = newId()
    await draft(id, 2)
    expect(await filesOf(id)).toHaveLength(4)
    const rev = await env.DB.prepare("SELECT rev FROM places WHERE id = ?").bind(id).first<number>("rev")
    const later = new Date(Date.now() + 30 * DAY_MS)
    const check = () => checkDeletion({ db: env.DB, exports: env.EXPORTS, keys: pub }, new Date(Date.now() + 32 * DAY_MS))
    expect((await check()).unapproved_photos).toBeGreaterThanOrEqual(2)

    // Not yet: a day before the job's deadline nothing moves.
    await runRetention(opEnv, new Date(Date.now() + 27 * DAY_MS))
    expect(await photoRows(env.DB, id)).toHaveLength(2)

    await runRetention(opEnv, later)
    expect(await photoRows(env.DB, id)).toEqual([])
    expect((await sourceRows(env.DB, id)).filter((s) => s.field === "photo")).toEqual([])
    expect(await env.DB.prepare("SELECT rev FROM places WHERE id = ?").bind(id).first<number>("rev")).toBe(rev! + 2)
    expect(await filesOf(id)).toEqual([])
    // The check names only what it finds: nothing left.
    expect((await check()).unapproved_photos).toBeUndefined()
  })

  it("go at once when the record is refused, before any sweep", async () => {
    const id = newId()
    await draft(id, 2)
    expect((await decide(id, await queued(id), "reject")).status).toBe(200)
    expect(await filesOf(id)).toEqual([])
  })

  it("are left out of what a restore writes once past their days, with their sources", async () => {
    const id = newId()
    await draft(id, 1)
    const payload = await exportNow()
    const now = filterForImport(payload.tables, new Date(), REAL)
    const revIds = new Set(payload.tables.revisions.filter((r) => r.place_id === id).map((r) => r.id))
    expect(now.revision_photos.filter((p) => revIds.has(p.revision_id))).toHaveLength(1)
    const late = filterForImport(payload.tables, new Date(Date.now() + 30 * DAY_MS), REAL)
    expect(late.revision_photos.filter((p) => revIds.has(p.revision_id))).toEqual([])
    expect(late.place_sources.filter((s) => s.place_id === id && s.field === "photo")).toEqual([])
    expect(late.place_sources.filter((s) => s.place_id === id && s.field !== "photo")).toHaveLength(2)
  })

  it("never take a published photo with them, nor a waiting one an approval published first", async () => {
    const id = newId()
    await draft(id, 1)
    expect((await decide(id, await queued(id), "approve")).status).toBe(200)
    const published = await photoRows(env.DB, id)
    expect(published[0].key).toMatch(/^public\//)
    await runRetention(opEnv, new Date(Date.now() + 30 * DAY_MS))
    expect(await photoRows(env.DB, id)).toEqual(published)
    expect((await curatedIn(env.DB, id))!.curated.photos).toHaveLength(1)
  })
})

describe("a curated approval replayed onto a copy taken while the record waited (P7-REC-1)", () => {
  it("publishes exactly its photos, each at its index with its credit, through Route B and again in place, and a second replay changes nothing", async () => {
    const id = newId()
    await draft(id, 2)
    const payload = await exportNow()
    expect((await decide(id, await queued(id), "approve")).status).toBe(200)
    const live = (await curatedIn(env.DB, id))!
    expect(live.curated.photos.map((p) => p.title)).toEqual(["צילום דמו 1", "צילום דמו 2"])

    // Route B: the import applies the ledger in memory; the replay after it finds nothing left to do.
    expect(await importExport(env.IMPORT_TEST, payload, new Date(), await readLedger(env.LEDGER))).toMatchObject({ ok: true })
    expect(await curatedIn(env.IMPORT_TEST, id)).toEqual(live)
    expect(await photoRows(env.IMPORT_TEST, id)).toEqual(await photoRows(env.DB, id))
    expect(await sourceRows(env.IMPORT_TEST, id)).toEqual(await sourceRows(env.DB, id))
    const again = await replayLedger(env.IMPORT_TEST, env.LEDGER, new Date(), payload.created_at)
    expect(again.quarantined).not.toContain(id)
    expect(await curatedIn(env.IMPORT_TEST, id)).toEqual(live)
  })

  it("does the same for a copy restored in place (Route A), the ledger replayed onto it", async () => {
    const id = newId()
    await draft(id, 2)
    const payload = await exportNow()
    expect((await decide(id, await queued(id), "approve")).status).toBe(200)
    const live = (await curatedIn(env.DB, id))!
    // The copy as it was at its point, nothing replayed yet.
    expect(await importExport(env.IMPORT_TEST, payload, new Date(), new Map())).toMatchObject({ ok: true })
    expect(await curatedIn(env.IMPORT_TEST, id)).toBeUndefined()
    const first = await replayLedger(env.IMPORT_TEST, env.LEDGER, new Date(), payload.created_at)
    expect(first.quarantined).not.toContain(id)
    expect(await curatedIn(env.IMPORT_TEST, id)).toEqual(live)
    expect(await photoRows(env.IMPORT_TEST, id)).toEqual(await photoRows(env.DB, id))
    const before = await photoRows(env.IMPORT_TEST, id)
    await replayLedger(env.IMPORT_TEST, env.LEDGER, new Date(), payload.created_at)
    expect(await photoRows(env.IMPORT_TEST, id)).toEqual(before)
  })

  it("hides the place until a moderator looks when the copy's photos aren't the ones the approval published", async () => {
    const id = newId()
    await draft(id, 2)
    const payload = await exportNow()
    expect((await decide(id, await queued(id), "approve")).status).toBe(200)
    // The copy names another file at index 1 than the one the approval copied: which credit goes with what is unknown.
    for (const row of payload.tables.revision_photos)
      if ((row.key as string).includes(id) && row.idx === 1) row.key = `quarantine/${id}/01AAAAAAAAAAAAAAAAAAAAAAAA.webp`
    expect(await importExport(env.IMPORT_TEST, payload, new Date(), new Map())).toMatchObject({ ok: true })
    const replayed = await replayLedger(env.IMPORT_TEST, env.LEDGER, new Date(), payload.created_at)
    expect(replayed.quarantined).toContain(id)
    expect(await hides(env.IMPORT_TEST, id)).toEqual([{ field: "whole", kind: "precautionary" }])
    expect(await curatedIn(env.IMPORT_TEST, id)).toBeUndefined()
  })
})

describe("a curated erasure replayed onto a copy that still holds the record (P7-REC-1)", () => {
  it("leaves no photo row or source in place, and a second replay changes nothing", async () => {
    const id = newId()
    await draft(id, 2)
    expect((await decide(id, await queued(id), "reject")).status).toBe(200)
    // The copy is taken while the refused record is within its days; the erasure comes after it.
    const payload = await exportNow()
    await env.DB.prepare("UPDATE places SET status_changed_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - 31 * DAY_MS).toISOString(), id)
      .run()
    await runRetention(opEnv, new Date())
    expect(await env.DB.prepare("SELECT status FROM places WHERE id = ?").bind(id).first<string>("status")).toBe("erased")

    expect(await importExport(env.IMPORT_TEST, payload, new Date(), new Map())).toMatchObject({ ok: true })
    expect(await photoRows(env.IMPORT_TEST, id)).toHaveLength(2)
    const replayed = await replayLedger(env.IMPORT_TEST, env.LEDGER, new Date(), payload.created_at)
    expect(replayed.erased).toContain(id)
    expect(await photoRows(env.IMPORT_TEST, id)).toEqual([])
    expect(await sourceRows(env.IMPORT_TEST, id)).toEqual([])
    await replayLedger(env.IMPORT_TEST, env.LEDGER, new Date(), payload.created_at)
    expect(await photoRows(env.IMPORT_TEST, id)).toEqual([])
  })
})
