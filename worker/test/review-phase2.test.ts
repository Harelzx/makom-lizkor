// Regression tests for the phase 2 review's findings, one per finding.
import { env } from "cloudflare:workers"
import { describe, expect, it } from "vitest"
import { CURRENT_SUBMISSION_NOTICE } from "@/shared/contract"
import { call } from "./app"
import { admin } from "./helpers"

const seg = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload]
const jpeg = (fill = 0x55) => new Uint8Array([0xff, 0xd8, ...seg(0xda, [1, 1, 0, 0, 63, 0]), ...new Array(32).fill(fill), 0xff, 0xd9])
const send = async (name: string, extra: Record<string, unknown> = {}, key = crypto.randomUUID().replaceAll("-", "")) => {
  const res = await call("http://local/api/v1/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key, "Turnstile-Token": "pass" },
    body: JSON.stringify({ kind: "bench", name_he: name, lat: 31.42, lng: 34.49, consent_version: CURRENT_SUBMISSION_NOTICE, ...extra }),
  })
  return { status: res.status, ...(await res.json<{ id: string; trackingToken: string }>()) }
}
const upload = (id: string, token: string, bytes = jpeg(), headers: Record<string, string> = {}) => {
  const form = new FormData()
  form.append("photo", new File([bytes], "p.jpg", { type: "image/jpeg" }))
  form.append("alt", "תיאור דמו")
  form.append("credit", "צלם דמו")
  return sendForm(`http://local/api/v1/submissions/${id}/photo`, token, form, headers)
}
type Item = { id: string; rev: number; revisionId: string } & Record<string, unknown>
const queued = async (id: string) =>
  ((await (await admin("/api/admin/queue")).json<{ items: Item[] }>()).items as Item[]).find((i) => i.id === id)!
const decide = (id: string, item: Item, action: string, note?: string) =>
  admin(`/api/admin/places/${id}/transitions`, {
    method: "POST",
    body: JSON.stringify({ action, revisionId: item.revisionId, expectedRev: item.rev, ...(note ? { note } : {}) }),
  })
const objects = async (id: string) => (await env.MEDIA.list()).objects.map((o) => o.key).filter((k) => k.includes(id))
const feed = async () => {
  const v = (await (await call("http://local/api/v1/version")).json<{ v: string }>()).v
  return (await (await call(`http://local/api/v1/feed?v=${v}`)).json<{ places: Record<string, unknown>[] }>()).places
}
const revise = (id: string, token: string, rev: number, name: string) =>
  call(`http://local/api/v1/submissions/${id}/revisions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "Turnstile-Token": "pass-revise" },
    body: JSON.stringify({ expectedRev: rev, name_he: name, consent_version: CURRENT_SUBMISSION_NOTICE }),
  })
const rev = async (id: string, token: string) =>
  (await (await call(`http://local/api/v1/submissions/${id}`, { headers: { Authorization: `Bearer ${token}` } })).json<{ rev: number }>())
    .rev

describe("phase 2 review", () => {
  it("#1 the moderator sees every field the feed would publish, the access note included", async () => {
    const { id } = await send("גינת דמו עם הערת גישה", {
      on_private_property: true,
      location_permission: true,
      access_note_he: "בתיאום עם המשפחה",
    })
    const item = await queued(id)
    expect(item).toMatchObject({ access_note_he: "בתיאום עם המשפחה", on_private_property: 1, location_permission: 1 })
    await decide(id, item, "approve")
    const published = (await feed()).find((p) => p.id === id)!
    const shown: Record<string, string> = {
      access_note: "access_note_he",
      summary_he: "story_he",
      precision: "location_precision",
      photo: "photo_url",
    }
    for (const field of Object.keys(published)) if (field !== "id") expect(item, field).toHaveProperty(shown[field] ?? field)
  })
  it("#2 a photo replaced after the moderator looked makes the approval conflict", async () => {
    const { id, trackingToken } = await send("ספסל דמו תמונה מתחלפת")
    await upload(id, trackingToken, jpeg(0x11))
    const seen = await queued(id)
    await upload(id, trackingToken, jpeg(0x22))
    expect((await decide(id, seen, "approve")).status).toBe(409)
  })
  it("#3 withdrawal erases the photo's description and its photographer too", async () => {
    const { id, trackingToken } = await send("ספסל דמו נמשך עם תמונה")
    await upload(id, trackingToken)
    await call(`http://local/api/v1/submissions/${id}/withdraw`, { method: "POST", headers: { Authorization: `Bearer ${trackingToken}` } })
    const row = await env.DB.prepare("SELECT photo_key, photo_alt, photo_credit FROM revisions WHERE place_id = ?").bind(id).first()
    expect(row).toEqual({ photo_key: null, photo_alt: null, photo_credit: null })
  })
  it("#4 a photo is refused before its body is read: a wrong token, then a missing or oversized length", async () => {
    const { id, trackingToken } = await send("ספסל דמו גוף תמונה")
    const wrong = await call(`http://local/api/v1/submissions/${id}/photo`, {
      method: "PUT",
      headers: { Authorization: "Bearer nope" },
      body: "x",
    })
    expect(wrong.status).toBe(404)
    const noLength = await call(`http://local/api/v1/submissions/${id}/photo`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${trackingToken}`, "Content-Type": "multipart/form-data; boundary=x" },
      body: new ReadableStream({ start: (c) => (c.enqueue(new Uint8Array(10)), c.close()) }),
      duplex: "half",
    } as RequestInit)
    expect(noLength.status).toBe(411)
    expect((await upload(id, trackingToken, jpeg(), { "Content-Length": String(6 * 1024 * 1024) })).status).toBe(413)
  })
  it("#6 an approved photo is public in the same step that publishes the place", async () => {
    const { id, trackingToken } = await send("ספסל דמו תמונה מתפרסמת")
    await upload(id, trackingToken)
    const item = await queued(id)
    // The photo is lost before approval: the place is published without it, never with a key that doesn't serve.
    const [key] = await objects(id)
    await env.MEDIA.delete(key)
    expect((await decide(id, item, "approve")).status).toBe(200)
    expect((await feed()).find((p) => p.id === id)).not.toHaveProperty("photo")
    expect(await env.DB.prepare("SELECT photo_key FROM revisions WHERE place_id = ?").bind(id).first("photo_key")).toBeNull()
  })
  it("#7 sending the same submission again returns the same tracking token", async () => {
    const key = crypto.randomUUID().replaceAll("-", "")
    const first = await send("ספסל דמו טוקן קבוע", {}, key)
    const again = await send("ספסל דמו טוקן קבוע", {}, key)
    expect(again.status).toBe(200)
    expect(again.trackingToken).toBe(first.trackingToken)
  })
  it("#8 photos are served as images only, and quarantine sandboxed", async () => {
    const { id, trackingToken } = await send("ספסל דמו כותרות תמונה")
    await upload(id, trackingToken)
    const [key] = await objects(id)
    const quarantined = await admin(`/api/admin/media/${key}`)
    expect(quarantined.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(quarantined.headers.get("Content-Security-Policy")).toContain("sandbox")
    await decide(id, await queued(id), "approve")
    const url = (await feed()).find((p) => p.id === id)!.photo as { url: string }
    const pub = await call(`http://local${url.url}`)
    expect(pub.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(pub.headers.get("Content-Security-Policy")).toContain("sandbox")
  })
  it("#9 a text-only correction after a rejected photo correction keeps the published photo", async () => {
    const { id, trackingToken } = await send("ספסל דמו תמונה מאושרת")
    await upload(id, trackingToken)
    await decide(id, await queued(id), "approve")
    await revise(id, trackingToken, await rev(id, trackingToken), "ספסל דמו תיקון עם תמונה")
    await upload(id, trackingToken, jpeg(0x33))
    await decide(id, await queued(id), "reject")
    await revise(id, trackingToken, await rev(id, trackingToken), "ספסל דמו תיקון טקסט")
    await decide(id, await queued(id), "approve")
    const published = (await feed()).find((p) => p.id === id)!
    expect(published).toMatchObject({ name_he: "ספסל דמו תיקון טקסט" })
    expect(published.photo).toBeTruthy()
    expect((await objects(id)).filter((k) => k.startsWith("public/"))).toHaveLength(1)
  })
  it("#11 a rejection deletes every photo the place has in quarantine", async () => {
    const { id, trackingToken } = await send("ספסל דמו שאריות בהסגר")
    await upload(id, trackingToken)
    await env.MEDIA.put(`quarantine/${id}/stray.jpg`, jpeg())
    await decide(id, await queued(id), "reject")
    expect(await objects(id)).toHaveLength(0)
  })
  it("#15 a refused correction is told as a correction, and the place stays", async () => {
    const to = `r${Date.now()}@example.test`
    const { id, trackingToken } = await send("ספסל דמו תיקון נדחה", { email: to })
    const verifyToken = /#\/verify\/(\S+)/.exec(
      (await env.DB.prepare("SELECT body FROM dev_outbox WHERE to_address = ?").bind(to).first<string>("body"))!,
    )![1]
    await call("http://local/api/v1/email/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: verifyToken }),
    })
    await decide(id, await queued(id), "approve")
    await revise(id, trackingToken, await rev(id, trackingToken), "שם שלא יאושר")
    await decide(id, await queued(id), "reject")
    const last = await env.DB.prepare("SELECT body FROM dev_outbox WHERE to_address = ? ORDER BY at DESC, id DESC LIMIT 1")
      .bind(to)
      .first<string>("body")
    expect(last).toContain("התיקון")
    expect(last).toContain("נשאר")
    expect(last).not.toContain("לענות למייל")
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
