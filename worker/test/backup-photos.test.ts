import { env } from "cloudflare:workers"
import { beforeAll, describe, expect, it } from "vitest"
import { pruneExports, runExport } from "../db/exports"
import { sha256, type Manifest } from "../lib/sealed"
import { call } from "./app"
import { admin, approve } from "./helpers"
import { jpeg, send, upload } from "./submission-helpers"

// The nightly export copies the photos the captured database shows or holds, and nothing else (adviser
// 20261006T153309Z-ef1427c3, F5-B1): a file left behind by a deletion that failed is never listed again, so its copy
// ends with the last manifest that rightly listed it.

const DAY = 86_400_000
let pub: string
beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"],
  )) as CryptoKeyPair
  pub = JSON.stringify([await crypto.subtle.exportKey("jwk", pair.publicKey)])
})

/** A bucket whose deletions fail: the withdrawal's own cleanup, and the photo watch after it. */
const undeletable = new Proxy(env.MEDIA, {
  get(target, prop) {
    if (prop === "delete")
      return async () => {
        throw new Error("r2 down")
      }
    const v = Reflect.get(target, prop)
    return typeof v === "function" ? v.bind(target) : v
  },
})
const exportAt = async (at: Date) => {
  const id = (await runExport({ db: env.DB, media: env.MEDIA, exports: env.EXPORTS, keys: pub }, "rr_test", at))!
  return (await (await env.EXPORTS.get(`exports/${id}/manifest.json`))!.json()) as Manifest
}
const photoKey = async (id: string) =>
  (await env.DB.prepare("SELECT r.photo_key AS k FROM places p JOIN revisions r ON r.id = p.published_revision_id WHERE p.id = ?")
    .bind(id)
    .first<string>("k"))!

describe("what the nightly export copies (spec 8.1, 7)", () => {
  it("never lists a withdrawn place's photo again, though its file outlived a failed deletion, and keeps a held one", async () => {
    const gone = await send("גן דמו שנמשך ותמונתו נשארה בטעות")
    expect((await upload(gone.id, gone.trackingToken, jpeg(0x51))).status).toBe(200)
    expect((await approve(gone.id)).status).toBe(200)
    const held = await send("גן דמו שתמונתו מוחזקת")
    expect((await upload(held.id, held.trackingToken, jpeg(0x52))).status).toBe(200)
    expect((await approve(held.id)).status).toBe(200)
    const rev = (await (await admin(`/api/admin/places/${held.id}`)).json<{ rev: number }>()).rev
    const hidden = await admin("/api/admin/suppressions", {
      method: "POST",
      body: JSON.stringify({ placeId: held.id, fields: ["photo"], expectedRev: rev, reason: "נימוק דמו להסתרה" }),
    })
    expect(hidden.status).toBe(200)
    const goneKey = await photoKey(gone.id)
    const goneHash = await sha256(new Uint8Array(await (await env.MEDIA.get(goneKey))!.arrayBuffer()))
    const heldHash = await sha256(
      new Uint8Array(await (await env.MEDIA.get((await photoKey(held.id)).replace(/^public\//, "held/")))!.arrayBuffer()),
    )

    const t = Date.now() + 1000 * DAY
    expect((await exportAt(new Date(t))).files.map((f) => f.sha256)).toEqual(expect.arrayContaining([goneHash, heldHash]))
    const withdrawn = await call(
      `http://local/api/v1/submissions/${gone.id}/withdraw`,
      { method: "POST", headers: { Authorization: `Bearer ${gone.trackingToken}` } },
      { ...env, MEDIA: undeletable },
    )
    expect(withdrawn.status).toBe(200)
    expect(await env.MEDIA.head(goneKey)).not.toBeNull()

    for (const day of [1, 2]) {
      const files = (await exportAt(new Date(t + day * DAY))).files.map((f) => f.sha256)
      expect(files).not.toContain(goneHash)
      expect(files).toContain(heldHash)
    }
    // The first export's end is the copy's end: no later manifest kept it.
    await pruneExports({ db: env.DB, exports: env.EXPORTS }, new Date(t + 35 * DAY + 3600_000))
    expect(await env.EXPORTS.head(`photos/${goneHash}`)).toBeNull()
    expect(await env.EXPORTS.head(`photos/${heldHash}`)).not.toBeNull()
  })
})
