// Regression tests for the phase 2 review's findings, one per finding.
import { env } from "cloudflare:workers"
import { describe, expect, it } from "vitest"
import { sweepPhotos } from "../db/places"
import { call } from "./app"
import { admin } from "./helpers"
import { decide, feed, jpeg, objects, queued, rev, revise, send, upload } from "./submission-helpers"

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
  // Revised after the adviser's close-out (20261005T212614Z-78a1ea11): a decision removes exactly the files it made
  // obsolete, since a newer correction may own others; anything left that no revision names goes with the sweep.
  it("#11 a rejection deletes the refused photo at once, and the sweep takes any other leftover", async () => {
    const { id, trackingToken } = await send("ספסל דמו שאריות בהסגר")
    await upload(id, trackingToken)
    await env.MEDIA.put(`quarantine/${id}/stray.jpg`, jpeg())
    await decide(id, await queued(id), "reject")
    expect(await objects(id)).toEqual([`quarantine/${id}/stray.jpg`])
    await sweepPhotos(env.DB, env.MEDIA, new Date(Date.now() + 2 * 3600 * 1000))
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
