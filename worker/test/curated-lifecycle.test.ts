import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import type { PublicCuratedPlace } from "@/shared/contract"
import { EXPORT_TABLES, runExport } from "../db/exports"
import { filterForImport, importExport, type ExportPayload } from "../db/import"
import { REAL } from "../lib/durations"
import { readFeed } from "../db/places"
import { readLedger, replayLedger, restorePhotos } from "../db/replay"
import { runRetention } from "../db/retention"
import { storeCurated } from "../db/curated"
import { CuratedInput } from "@/shared/curated"
import { unseal, type Manifest } from "../lib/sealed"
import { body, newId, post, sources, uploadPhoto, viewRev } from "./curated-helpers"
import { admin } from "./helpers"
import { decide, queued } from "./submission-helpers"

// A curated record through the existing lifecycle (adviser a50, P7-REC-1, P7-MEDIA-1): exported and restored with
// each revision's sources and each photo's own source, its photos backed up and put back by key, a hide made after
// the export kept by the replay, and an erased record holding no curated content, photo or source.

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

let manifest: Manifest
async function exportNow(): Promise<ExportPayload> {
  await env.DB.prepare("DELETE FROM exports").run()
  const pub = JSON.stringify([await crypto.subtle.exportKey("jwk", keys.publicKey)])
  const id = (await runExport({ db: env.DB, media: env.MEDIA, exports: env.EXPORTS, keys: pub }, "rr_test", new Date()))!
  manifest = (await (await env.EXPORTS.get(`exports/${id}/manifest.json`))!.json()) as Manifest
  const data = new Uint8Array(await (await env.EXPORTS.get(manifest.data.key))!.arrayBuffer())
  const plain = await unseal(data, manifest.data, (await crypto.subtle.exportKey("jwk", keys.privateKey)) as JsonWebKey)
  return JSON.parse(await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"))).text()) as ExportPayload
}
async function restoreB(payload: ExportPayload) {
  expect(await importExport(env.IMPORT_TEST, payload, new Date(), await readLedger(env.LEDGER))).toMatchObject({ ok: true })
  await replayLedger(env.IMPORT_TEST, env.LEDGER, new Date(), payload.created_at)
}
const curated = async (db: D1Database, id: string) =>
  (await readFeed(db, "0")).places.find((p) => p.id === id) as PublicCuratedPlace | undefined
const sourcesOf = (db: D1Database, id: string) =>
  db
    .prepare(
      `SELECT s.field, s.photo_idx, s.source, s.license, s.retrieved_approx FROM place_sources s
       JOIN places p ON p.id = s.place_id AND s.revision_id = p.published_revision_id WHERE p.id = ? ORDER BY s.field, s.photo_idx`,
    )
    .bind(id)
    .all()
    .then((r) => r.results)

async function withPhoto(id: string) {
  const photo = await uploadPhoto(id, 0x71)
  const res = await post(
    body(id, {
      photos: [{ key: photo.key, thumb_key: photo.thumb_key, title: "צילום דמו", author: "צלם דמו", license: "CC BY 4.0" }],
      sources: [...sources, { field: "photo", photo_idx: 0, source: "commons", license: "CC BY 4.0", retrieved_approx: false }],
    }),
  )
  expect(res.status).toBe(201)
  return (await curated(env.DB, id))!
}

describe("a curated record through backup and restore", () => {
  it("comes back with its fields, its revision's sources, each photo's source and its photo files", async () => {
    const id = newId()
    const live = await withPhoto(id)
    const liveSources = await sourcesOf(env.DB, id)
    expect(liveSources).toHaveLength(3)
    const payload = await exportNow()
    // The photo bucket is lost too: the files come back from the export's copies.
    const files = live.curated.photos.flatMap((p) => [p.url, p.thumb_url]).map((u) => u.replace(/^\/media\//, ""))
    for (const f of files) await env.MEDIA.delete(f)
    await restoreB(payload)
    expect(await restorePhotos(env.IMPORT_TEST, env.MEDIA, env.EXPORTS, manifest)).toMatchObject({ missing: 0, damaged: 0 })
    expect(await curated(env.IMPORT_TEST, id)).toEqual(live)
    expect(await sourcesOf(env.IMPORT_TEST, id)).toEqual(liveSources)
    for (const f of files) expect((await env.MEDIA.head(f))?.httpMetadata?.contentType, f).toBe("image/webp")
  })

  it("keeps a photo hide made after the export", async () => {
    const id = newId()
    await withPhoto(id)
    const payload = await exportNow()
    const hidden = await admin("/api/admin/suppressions", {
      method: "POST",
      body: JSON.stringify({ placeId: id, fields: ["photo"], expectedRev: await viewRev(id), reason: "בקשת בעל זכויות בדמו" }),
    })
    expect(hidden.status).toBe(200)
    await restoreB(payload)
    expect((await curated(env.IMPORT_TEST, id))!.curated.photos).toEqual([])
    expect((await curated(env.DB, id))!.curated.photos).toEqual([])
  })
})

describe("an erased curated record", () => {
  it("holds no curated content, photo row, source or file, in the database or in what a restore would write", async () => {
    // A draft whose publication never landed (the route stores, then approves), refused by a moderator and past its days.
    const id = newId()
    const photo = await uploadPhoto(id, 0x81)
    const input = CuratedInput.parse(
      body(id, {
        photos: [{ key: photo.key, thumb_key: photo.thumb_key, title: "צילום דמו", author: "צלם דמו", license: "CC0" }],
        sources: [...sources, { field: "photo", photo_idx: 0, source: "commons", license: "CC0", retrieved_approx: false }],
      }),
    )
    expect(await storeCurated(env.DB, env.MEDIA, input, crypto.randomUUID(), new Date())).toMatchObject({ kind: "stored" })
    expect((await decide(id, await queued(id), "reject")).status).toBe(200)
    const due = new Date(Date.now() - 31 * 86_400_000).toISOString()
    await env.DB.prepare("UPDATE places SET status_changed_at = ? WHERE id = ?").bind(due, id).run()

    const payload = await exportNow()
    const filtered = filterForImport(payload.tables, new Date(), REAL)
    const revs = filtered.revisions.filter((r) => r.place_id === id)
    expect(revs.length).toBeGreaterThan(0)
    expect(revs.every((r) => r.curated === null && r.name_he === null)).toBe(true)
    const ids = new Set(revs.map((r) => r.id))
    expect(filtered.revision_photos.filter((p) => ids.has(p.revision_id as string))).toEqual([])
    expect(filtered.place_sources.filter((s) => s.place_id === id)).toEqual([])

    await runRetention({ db: env.DB, media: env.MEDIA, ledger: env.LEDGER, purge: async () => true }, new Date())
    expect(await env.DB.prepare("SELECT status FROM places WHERE id = ?").bind(id).first<string>("status")).toBe("erased")
    const left = await env.DB.batch([
      env.DB.prepare("SELECT COUNT(*) AS n FROM revisions WHERE place_id = ? AND curated IS NOT NULL").bind(id),
      env.DB.prepare("SELECT COUNT(*) AS n FROM revision_photos WHERE revision_id IN (SELECT id FROM revisions WHERE place_id = ?)").bind(
        id,
      ),
      env.DB.prepare("SELECT COUNT(*) AS n FROM place_sources WHERE place_id = ?").bind(id),
    ])
    expect(left.map((r) => (r.results[0] as { n: number }).n)).toEqual([0, 0, 0])
    expect((await env.MEDIA.list()).objects.map((o) => o.key).filter((k) => k.includes(id))).toEqual([])
  })
})
