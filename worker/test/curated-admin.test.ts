import { env } from "cloudflare:workers"
import { describe, expect, it } from "vitest"
import { call } from "./app"
import { admin } from "./helpers"
import { body, curatedIn, multipart, newId, post, sources, uploadPhoto, viewRev, webp } from "./curated-helpers"
import { send } from "./submission-helpers"

// POST /api/admin/places (spec 3, the API table; phase 7, adviser a50): a moderator creates or edits one of the
// operator's own places, with a source for each field; it is published through the same operation and ledger as an
// approval, its photos wait in quarantine/ until then and are served, hidden and restored by key like any other.

describe("a moderator's curated record", () => {
  it("is created and published with its sources, its own fields and its photos through the media route", async () => {
    const id = newId()
    const photo = await uploadPhoto(id)
    expect(photo.res.status).toBe(201)
    expect(photo.key).toMatch(new RegExp(`^quarantine/${id}/`))
    // Nothing waiting in quarantine is served.
    expect((await call(`http://local/media/${photo.key.replace(/^quarantine/, "public")}`)).status).toBe(404)
    const res = await post(
      body(id, {
        photos: [{ key: photo.key, thumb_key: photo.thumb_key, title: "צילום דמו", author: "צלם דמו", license: "CC BY-SA 4.0" }],
        sources: [...sources, { field: "photo", photo_idx: 0, source: "commons", license: "CC BY-SA 4.0", retrieved_approx: false }],
      }),
    )
    expect(res.status).toBe(201)
    const place = (await curatedIn(id))!
    expect(place.curated).toMatchObject({ coord_source: "osm", region: "envelope", links: [{ label_he: "מקור דמו" }] })
    expect(place.curated.photos).toHaveLength(1)
    const [p] = place.curated.photos
    expect(p.url).toMatch(new RegExp(`^/media/public/${id}/`))
    for (const url of [p.url, p.thumb_url]) {
      const served = await call(`http://local${url}`)
      expect(served.status, url).toBe(200)
      expect(served.headers.get("Content-Type")).toBe("image/webp")
    }
  })

  it("is refused without a source for each field, naming what is missing, and nothing is stored", async () => {
    const id = newId()
    const res = await post(body(id, { sources: [sources[1]] }))
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code: "sources_missing", missing: ["coords"] })
    expect(await curatedIn(id)).toBeUndefined()
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM places WHERE id = ?").bind(id).first("n")).toBe(0)
  })

  it("never edits a contribution", async () => {
    const { id } = await send("ספסל דמו לא לעריכה")
    expect((await post(body(id, { expectedRev: await viewRev(id) }))).status).toBe(403)
  })

  it("is edited at its current rev only, and a stale view is a conflict", async () => {
    const id = newId()
    expect((await post(body(id))).status).toBe(201)
    expect((await post(body(id, { name_he: "שם ישן" }))).status).toBe(409)
    const rev = await viewRev(id)
    const edited = await post(body(id, { expectedRev: rev, name_he: "אנדרטת דמו בשם חדש" }))
    expect(edited.status).toBe(200)
    expect((await curatedIn(id))!.name_he).toBe("אנדרטת דמו בשם חדש")
  })

  it("answers a retry with a lost response the same, once, and refuses the key for another body", async () => {
    const id = newId()
    const key = crypto.randomUUID().replaceAll("-", "")
    const first = await post(body(id), key)
    const again = await post(body(id), key)
    expect([first.status, again.status]).toEqual([201, 201])
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM revisions WHERE place_id = ?").bind(id).first("n")).toBe(1)
    expect((await post(body(id, { name_he: "אחר" }), key)).status).toBe(409)
  })

  it("is created once when two moderators race for the same id", async () => {
    const id = newId()
    const [a, b] = await Promise.all([post(body(id)), post(body(id))])
    expect([a.status, b.status].sort()).toEqual([201, 409])
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM revisions WHERE place_id = ?").bind(id).first("n")).toBe(1)
  })

  it("loses every photo and thumbnail from view when its photo is hidden, and gets them back when the hide is lifted", async () => {
    const id = newId()
    const one = await uploadPhoto(id, 0x51)
    const two = await uploadPhoto(id, 0x61)
    const photos = [one, two].map((p) => ({ key: p.key, thumb_key: p.thumb_key, title: "צילום דמו", author: "צלם", license: "CC0" }))
    const photoSources = [0, 1].map((i) => ({ field: "photo", photo_idx: i, source: "commons", license: "CC0", retrieved_approx: false }))
    expect((await post(body(id, { photos, sources: [...sources, ...photoSources] }))).status).toBe(201)
    const urls = (await curatedIn(id))!.curated.photos.flatMap((p) => [p.url, p.thumb_url])
    expect(urls).toHaveLength(4)
    const hidden = await admin("/api/admin/suppressions", {
      method: "POST",
      body: JSON.stringify({ placeId: id, fields: ["photo"], expectedRev: await viewRev(id), reason: "בקשת בעל זכויות בדמו" }),
    })
    expect(hidden.status).toBe(200)
    expect((await curatedIn(id))!.curated.photos).toEqual([])
    for (const url of urls) expect((await call(`http://local${url}`)).status, url).toBe(404)
    const { suppressions } = await (await admin(`/api/admin/places/${id}`)).json<{ suppressions: { id: string }[] }>()
    const lifted = await admin(`/api/admin/suppressions/${suppressions[0].id}/lift`, {
      method: "POST",
      body: JSON.stringify({
        expectedRev: await viewRev(id),
        basisCode: "rights_cleared",
        basisNote: "בעל הזכויות אישר בכתב את השימוש בתמונות.",
        evidenceRef: "דמו-1",
        confirm: { affirmativeBasis: true, notNonresponseOrDispute: true },
      }),
    })
    expect(lifted.status).toBe(200)
    for (const url of urls) expect((await call(`http://local${url}`)).status, url).toBe(200)
  })

  it("refuses a file that isn't a picture", async () => {
    const form = new FormData()
    form.set("place_id", newId())
    form.set("file", new File([new TextEncoder().encode("<svg/>")], "x.webp", { type: "image/webp" }))
    form.set("thumb", new File([webp(1)], "t.webp", { type: "image/webp" }))
    expect((await multipart(form)).status).toBe(415)
  })
})
