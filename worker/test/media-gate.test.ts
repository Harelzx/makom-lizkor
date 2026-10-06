import { env } from "cloudflare:workers"
import { describe, expect, it } from "vitest"
import { withdraw } from "../db/places"
import { call } from "./app"
import { decide, jpeg, queued, rev, revise, send, upload } from "./submission-helpers"

/** A published place with a photo, its key, and the bytes stored under it. */
async function withPhoto() {
  const s = await send("ספסל דמו עם תמונה", { place_he: "כיסופים" })
  await upload(s.id, s.trackingToken)
  expect((await decide(s.id, await queued(s.id), "approve")).status).toBe(200)
  return { ...s, key: (await publishedKey(s.id))! }
}
const publishedKey = (id: string) =>
  env.DB.prepare("SELECT r.photo_key FROM places p JOIN revisions r ON r.id = p.published_revision_id WHERE p.id = ?")
    .bind(id)
    .first<string>("photo_key")
const media = (key: string) => call(`http://local/media/${key}`)
/** Puts bytes under the key whatever moved them, so a refusal can only come from the gate itself. */
const present = async (key: string) => {
  await env.MEDIA.put(key, new Uint8Array(jpeg()))
  expect(await env.MEDIA.head(key)).not.toBeNull()
}
async function refused(key: string) {
  const res = await media(key)
  expect(res.status).toBe(404)
  // A refusal is never kept by a shared cache, so a later restoration is served at once.
  expect(res.headers.get("Cache-Control")).toBe("private, no-store")
  expect(await env.MEDIA.head(key)).not.toBeNull()
}
let n = 0
const suppress = (placeId: string, field: "photo" | "whole") =>
  env.DB.prepare(
    `INSERT INTO field_suppressions (id, place_id, field, kind, created_at, created_by, notes_ceiling_at, notes_purge_after)
     VALUES (?1, ?2, ?3, 'manual', '2027-01-01T00:00:00.000Z', 'dev@example.test', '2028-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z')`,
  )
    .bind(`s_gate_${++n}`, placeId, field)
    .run()

describe("the media door refuses by the database, even with the bytes in public/", () => {
  it("serves the published photo of a place nothing hides", async () => {
    const p = await withPhoto()
    expect((await media(p.key)).status).toBe(200)
  })

  it("a photo hide", async () => {
    const p = await withPhoto()
    await suppress(p.id, "photo")
    await present(p.key)
    await refused(p.key)
  })

  it("a whole-place hide", async () => {
    const p = await withPhoto()
    await suppress(p.id, "whole")
    await present(p.key)
    await refused(p.key)
  })

  it("a withdrawn place", async () => {
    const p = await withPhoto()
    const opEnv = { db: env.DB, media: env.MEDIA, ledger: env.LEDGER, purge: async () => true }
    expect(await withdraw(opEnv, p.id, p.trackingToken, new Date())).toBe("done")
    await present(p.key)
    await refused(p.key)
  })

  it("an obsolete key, after a correction with a new photo was approved", async () => {
    const p = await withPhoto()
    expect((await revise(p.id, p.trackingToken, await rev(p.id, p.trackingToken), "ספסל דמו מתוקן")).status).toBe(200)
    await upload(p.id, p.trackingToken, jpeg(0x66))
    expect((await decide(p.id, await queued(p.id), "approve")).status).toBe(200)
    const current = (await publishedKey(p.id))!
    expect(current).not.toBe(p.key)
    expect((await media(current)).status).toBe(200)
    await present(p.key)
    await refused(p.key)
  })
})
