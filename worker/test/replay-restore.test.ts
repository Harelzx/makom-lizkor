import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { beforeAll, describe, expect, it } from "vitest"
import { EXPORT_TABLES, runExport } from "../db/exports"
import { importExport, type ExportPayload } from "../db/import"
import { readFeed } from "../db/places"
import { readLedger, replayLedger, restorePhotos } from "../db/replay"
import { ogResponse, ogState } from "../lib/og"
import { sha256, unseal, type Manifest } from "../lib/sealed"
import { call } from "./app"
import { admin, approve } from "./helpers"
import { decide, jpeg, queued, send, upload } from "./submission-helpers"

let keys: CryptoKeyPair
beforeAll(async () => {
  await applyD1Migrations(env.IMPORT_TEST, env.TEST_MIGRATIONS)
  for (const t of [...EXPORT_TABLES].reverse()) await env.IMPORT_TEST.prepare(`DELETE FROM ${t}`).run()
  keys = (await crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"],
  )) as CryptoKeyPair
})

let lastManifest: Manifest
async function exportNow(): Promise<ExportPayload> {
  await env.DB.prepare("DELETE FROM exports").run()
  const pub = JSON.stringify([await crypto.subtle.exportKey("jwk", keys.publicKey)])
  const id = (await runExport({ db: env.DB, media: env.MEDIA, exports: env.EXPORTS, keys: pub }, "rr_test", new Date()))!
  const manifest = (await (await env.EXPORTS.get(`exports/${id}/manifest.json`))!.json()) as Manifest
  lastManifest = manifest
  const data = new Uint8Array(await (await env.EXPORTS.get(manifest.data.key))!.arrayBuffer())
  const plain = await unseal(data, manifest.data, (await crypto.subtle.exportKey("jwk", keys.privateKey)) as JsonWebKey)
  return JSON.parse(await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"))).text()) as ExportPayload
}
const rev = async (id: string) => (await (await admin(`/api/admin/places/${id}`)).json<{ rev: number }>()).rev
const hide = (placeId: string, fields: string[], expectedRev: number) =>
  admin("/api/admin/suppressions", { method: "POST", body: JSON.stringify({ placeId, fields, expectedRev, reason: "נימוק דמו להסתרה" }) })
const without = (places: { id: string }[], id: string) => places.filter((p) => p.id !== id)

describe("replaying the ledger onto a restored database (spec 8.2, 8.3)", () => {
  it("brings back every decision taken after the export, never an erased place, and hides a place whose chain has a gap", async () => {
    // Before the export: one pending with its photo, four published.
    const pending = await send("גן דמו שאושר אחרי הייצוא")
    expect((await upload(pending.id, pending.trackingToken, jpeg(0x61))).status).toBe(200)
    const hidden = await send("גן דמו שהוסתר אחרי הייצוא")
    await approve(hidden.id)
    const withdrawn = await send("גן דמו שנמשך אחרי הייצוא")
    await approve(withdrawn.id)
    const gap = await send("גן דמו עם פער ברישום")
    await approve(gap.id)
    const untouched = await send("גן דמו שלא השתנה")
    await approve(untouched.id)

    const payload = await exportNow()

    // After it: an approval (with its photo), a hide, a withdrawal, two hides of which one commit goes missing.
    expect((await decide(pending.id, await queued(pending.id), "approve")).status).toBe(200)
    expect((await hide(hidden.id, ["story_he"], await rev(hidden.id))).status).toBe(200)
    expect(
      (
        await call(`http://local/api/v1/submissions/${withdrawn.id}/withdraw`, {
          method: "POST",
          headers: { Authorization: `Bearer ${withdrawn.trackingToken}` },
        })
      ).status,
    ).toBe(200)
    expect((await hide(gap.id, ["name_he"], await rev(gap.id))).status).toBe(200)
    expect((await hide(gap.id, ["story_he"], await rev(gap.id))).status).toBe(200)
    const gapCommits = (await env.LEDGER.list({ prefix: `ledger/${gap.id}/` })).objects.filter((o) => o.key.endsWith("-commit.json"))
    await env.LEDGER.delete(gapCommits[gapCommits.length - 2].key)

    const imported = await importExport(env.IMPORT_TEST, payload, new Date(), await readLedger(env.LEDGER))
    expect(imported).toMatchObject({ ok: true, reconciled: { quarantined: [gap.id] } })
    // The import applied the ledger already: the replay after it finds nothing left to do.
    expect(await replayLedger(env.IMPORT_TEST, env.LEDGER, new Date(), payload.created_at)).toMatchObject({ applied: 0, quarantined: [] })

    // What the public sees is what it saw before the loss, but for the place whose record has a gap: hidden until a
    // moderator looks.
    const live = (await readFeed(env.DB, "0")).places
    const restored = (await readFeed(env.IMPORT_TEST, "0")).places
    expect(restored).toEqual(without(live, gap.id))
    expect(restored.find((p) => p.id === pending.id)?.photo?.url).toMatch(/^\/media\/public\//)
    expect(restored.find((p) => p.id === hidden.id)?.summary_he).toBe("")
    const tomb = await env.IMPORT_TEST.prepare("SELECT status FROM places WHERE id = ?").bind(withdrawn.id).first<string>("status")
    expect(tomb).toBe("withdrawn")
    const left = await env.IMPORT_TEST.prepare("SELECT COUNT(*) AS n FROM revisions WHERE place_id = ? AND name_he IS NOT NULL")
      .bind(withdrawn.id)
      .first<number>("n")
    expect(left).toBe(0)

    // Share images (L4) follow the reconciled state: the hide after the export is in the restored image's address,
    // and the place with a gap has none until a moderator looks.
    expect((await ogState(env.IMPORT_TEST, hidden.id))!.hash).toBe((await ogState(env.DB, hidden.id))!.hash)
    expect(await ogState(env.IMPORT_TEST, gap.id)).toBeNull()
    expect(await ogState(env.IMPORT_TEST, withdrawn.id)).toBeNull()

    // Twice is once.
    const before = JSON.stringify((await env.IMPORT_TEST.prepare("SELECT * FROM field_suppressions ORDER BY id").all()).results)
    expect(await replayLedger(env.IMPORT_TEST, env.LEDGER, new Date(), payload.created_at)).toMatchObject({ applied: 0 })
    expect(JSON.stringify((await env.IMPORT_TEST.prepare("SELECT * FROM field_suppressions ORDER BY id").all()).results)).toBe(before)
    expect((await readFeed(env.IMPORT_TEST, "0")).places).toEqual(restored)
  })

  it("puts photos back from their copies only where the restored place still shows or holds them", async () => {
    for (const t of [...EXPORT_TABLES].reverse()) await env.IMPORT_TEST.prepare(`DELETE FROM ${t}`).run()
    const shown = await send("גן דמו שתמונתו חוזרת")
    expect((await upload(shown.id, shown.trackingToken, jpeg(0x71))).status).toBe(200)
    await approve(shown.id)
    const held = await send("גן דמו שתמונתו מוסתרת")
    expect((await upload(held.id, held.trackingToken, jpeg(0x72))).status).toBe(200)
    await approve(held.id)
    expect((await hide(held.id, ["photo"], await rev(held.id))).status).toBe(200)
    const gone = await send("גן דמו שנמשך ותמונתו לא חוזרת")
    expect((await upload(gone.id, gone.trackingToken, jpeg(0x73))).status).toBe(200)
    await approve(gone.id)
    const payload = await exportNow()
    expect(
      (
        await call(`http://local/api/v1/submissions/${gone.id}/withdraw`, {
          method: "POST",
          headers: { Authorization: `Bearer ${gone.trackingToken}` },
        })
      ).status,
    ).toBe(200)
    const keyOf = async (id: string) =>
      (await env.DB.prepare("SELECT r.photo_key AS k FROM places p JOIN revisions r ON r.id = p.published_revision_id WHERE p.id = ?")
        .bind(id)
        .first<{ k: string }>())!.k
    const shownKey = await keyOf(shown.id)
    const heldKey = (await keyOf(held.id)).replace(/^public\//, "held/")
    const shownBytes = new Uint8Array(await (await env.MEDIA.get(shownKey))!.arrayBuffer())

    // The photo bucket is lost.
    for (const id of [shown.id, held.id, gone.id])
      for (const prefix of ["public/", "held/", "quarantine/"])
        for (const o of (await env.MEDIA.list({ prefix: `${prefix}${id}/` })).objects) await env.MEDIA.delete(o.key)
    expect(await importExport(env.IMPORT_TEST, payload, new Date(), await readLedger(env.LEDGER))).toMatchObject({ ok: true })
    await replayLedger(env.IMPORT_TEST, env.LEDGER, new Date(), payload.created_at)
    const result = await restorePhotos(env.IMPORT_TEST, env.MEDIA, env.EXPORTS, lastManifest)
    expect(result).toMatchObject({ restored: 2 })
    expect(await sha256(new Uint8Array(await (await env.MEDIA.get(shownKey))!.arrayBuffer()))).toBe(await sha256(shownBytes))
    expect(await env.MEDIA.head(heldKey)).not.toBeNull()
    expect(await env.MEDIA.head(heldKey.replace(/^held\//, "public/"))).toBeNull()
    expect((await env.MEDIA.list({ prefix: `public/${gone.id}/` })).objects).toHaveLength(0)
    expect((await env.MEDIA.list({ prefix: `held/${gone.id}/` })).objects).toHaveLength(0)
  })

  it("a hide of what the share image shows, made after the export, is in the restored image's address; the old one is refused (E-L4-1)", async () => {
    for (const t of [...EXPORT_TABLES].reverse()) await env.IMPORT_TEST.prepare(`DELETE FROM ${t}`).run()
    const p = await send("גן דמו ששמו הוסתר אחרי הייצוא")
    expect((await upload(p.id, p.trackingToken, jpeg(0x7a))).status).toBe(200)
    await approve(p.id)
    const before = (await ogState(env.DB, p.id))!.hash
    const payload = await exportNow()
    expect((await hide(p.id, ["name_he", "photo"], await rev(p.id))).status).toBe(200)
    const live = (await ogState(env.DB, p.id))!
    expect(live.hash).not.toBe(before)
    expect(live.projection.photo).toBeNull()

    expect(await importExport(env.IMPORT_TEST, payload, new Date(), await readLedger(env.LEDGER))).toMatchObject({ ok: true })
    await replayLedger(env.IMPORT_TEST, env.LEDGER, new Date(), payload.created_at)
    expect((await ogState(env.IMPORT_TEST, p.id))!.hash).toBe(live.hash)
    expect((await ogResponse({ db: env.IMPORT_TEST, media: env.MEDIA }, p.id, before)).status).toBe(404)
  })
})
