import { env } from "cloudflare:workers"
import { describe, expect, it } from "vitest"
import { CURRENT_SUBMISSION_NOTICE } from "@/shared/contract"
import { call } from "./app"
import { admin } from "./helpers"

const seg = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload]
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))
/** A JPEG's structure, enough for the server's checks: SOI, APP0, an EXIF APP1 with a GPS mark, a comment, SOS, data, EOI. */
const jpeg = (extra = 0) =>
  new Uint8Array([
    0xff,
    0xd8,
    ...seg(0xe0, [...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...seg(0xe1, [...ascii("Exif"), 0, 0, ...ascii("GPS 31.4200 34.4900")]),
    ...seg(0xfe, ascii("camera owner")),
    ...seg(0xc0, [8, 0, 16, 0, 16, 1, 1, 0x11, 0]),
    ...seg(0xda, [1, 1, 0, 0, 63, 0]),
    ...new Array(32 + extra).fill(0x55),
    0xff,
    0xd9,
  ])

const send = async (name: string) => {
  const res = await call("http://local/api/v1/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""), "Turnstile-Token": "pass" },
    body: JSON.stringify({ kind: "bench", name_he: name, lat: 31.42, lng: 34.49, consent_version: CURRENT_SUBMISSION_NOTICE }),
  })
  return res.json<{ id: string; trackingToken: string }>()
}
const upload = (
  id: string,
  token: string,
  bytes: Uint8Array,
  fields: Record<string, string> = { alt: "ספסל עץ מול השדה", credit: "צלם דמו" },
  type = "image/jpeg",
) => {
  const form = new FormData()
  form.append("photo", new File([bytes], "photo.jpg", { type }))
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  return sendForm(`http://local/api/v1/submissions/${id}/photo`, token, form)
}
const decide = async (id: string, action: string) => {
  const { items } = await (
    await admin("/api/admin/queue")
  ).json<{ items: { id: string; rev: number; revisionId: string; photo_url?: string }[] }>()
  const item = items.find((i) => i.id === id)!
  await admin(`/api/admin/places/${id}/transitions`, {
    method: "POST",
    body: JSON.stringify({ action, revisionId: item.revisionId, expectedRev: item.rev }),
  })
  return item
}
const objects = async (placeId: string) =>
  (await env.MEDIA.list({ prefix: "" })).objects.map((o) => o.key).filter((k) => k.includes(placeId))
const feed = async () => {
  const v = (await (await call("http://local/api/v1/version")).json<{ v: string }>()).v
  return (
    await (
      await call(`http://local/api/v1/feed?v=${v}`)
    ).json<{ places: { id: string; photo?: { url: string; alt: string; credit?: string } }[] }>()
  ).places
}

describe("a photo with a submission", () => {
  it("is kept in quarantine, without its camera metadata", async () => {
    const { id, trackingToken } = await send("ספסל דמו עם תמונה")
    expect((await upload(id, trackingToken, jpeg())).status).toBe(200)
    const keys = await objects(id)
    expect(keys).toHaveLength(1)
    expect(keys[0]).toMatch(new RegExp(`^quarantine/${id}/`))
    const stored = new Uint8Array(await (await env.MEDIA.get(keys[0]))!.arrayBuffer())
    const text = String.fromCharCode(...stored)
    expect(text).not.toContain("Exif")
    expect(text).not.toContain("GPS")
    expect(text).not.toContain("camera owner")
    expect([stored[0], stored[1], stored.at(-2), stored.at(-1)]).toEqual([0xff, 0xd8, 0xff, 0xd9])
  })
  it("refuses what isn't a JPEG, what is too large, a missing description, and a wrong token", async () => {
    const { id, trackingToken } = await send("ספסל דמו תמונה לא תקינה")
    expect((await upload(id, trackingToken, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]))).status).toBe(415)
    expect((await upload(id, trackingToken, jpeg(4 * 1024 * 1024))).status).toBe(413)
    expect((await upload(id, trackingToken, jpeg(), { credit: "צלם" })).status).toBe(400)
    expect((await upload(id, "nope", jpeg())).status).toBe(404)
    expect(await objects(id)).toHaveLength(0)
  })
  it("is shown to the moderator, and published only with the place", async () => {
    const { id, trackingToken } = await send("ספסל דמו תמונה לפרסום")
    await upload(id, trackingToken, jpeg())
    const item = await decide(id, "approve")
    expect(item.photo_url).toMatch(/^\/api\/admin\/media\/quarantine\//)
    const published = (await feed()).find((p) => p.id === id)!
    expect(published.photo).toMatchObject({ alt: "ספסל עץ מול השדה", credit: "צלם דמו" })
    const res = await call(`http://local${published.photo!.url}`)
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("image/jpeg")
    expect((await objects(id)).every((k) => k.startsWith("public/"))).toBe(true)
  })
  it("in quarantine is visible to moderators only", async () => {
    const { id, trackingToken } = await send("ספסל דמו תמונה פרטית")
    await upload(id, trackingToken, jpeg())
    const [key] = await objects(id)
    expect((await call(`http://local/media/${key}`)).status).toBe(404)
    expect((await call(`http://local/api/admin/media/${key}`)).status).toBe(401)
    expect((await admin(`/api/admin/media/${key}`)).status).toBe(200)
  })
  it("is deleted at once when the place is rejected or withdrawn", async () => {
    const a = await send("ספסל דמו תמונה נדחית")
    await upload(a.id, a.trackingToken, jpeg())
    await decide(a.id, "reject")
    expect(await objects(a.id)).toHaveLength(0)

    const b = await send("ספסל דמו תמונה נמשכת")
    await upload(b.id, b.trackingToken, jpeg())
    await decide(b.id, "approve")
    await call(`http://local/api/v1/submissions/${b.id}/withdraw`, {
      method: "POST",
      headers: { Authorization: `Bearer ${b.trackingToken}` },
    })
    expect(await objects(b.id)).toHaveLength(0)
  })
})

/** A form sent as a browser sends it: serialised, with its Content-Length. */
async function sendForm(url: string, token: string, form: FormData, headers: Record<string, string> = {}) {
  const encoded = new Request(url, { method: "PUT", body: form })
  const body = await encoded.arrayBuffer()
  return call(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": encoded.headers.get("Content-Type")!,
      "Content-Length": String(body.byteLength),
      ...headers,
    },
    body,
  })
}
