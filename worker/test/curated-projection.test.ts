import { describe, expect, it } from "vitest"
import { call } from "./app"
import { admin, withSite } from "./helpers"
import { body, curatedIn, newId, post, sources, uploadPhoto, viewRev } from "./curated-helpers"

// A hidden name stays out of everything public that could repeat it (spec 3.3; P7-PROJECTION-1): a curated place's
// links and photo credits are handled as a contribution's link and photo description already are. The credit keeps
// what attribution needs (author and licence); the title reads as the place's neutral words, and the subject and the
// source page (often named after the place) are left out. Lifting the hide brings everything back.

const NAME = "חורשת זיוה-אלמוג"
const page = async (id: string) => {
  const html = await (await call(`http://local/place/${encodeURIComponent(id)}`, {}, withSite)).text()
  return JSON.parse(/<script type="application\/json" id="place-data">([^<]*)<\/script>/.exec(html)![1])
}
const visible = async (id: string) => JSON.stringify([await curatedIn(id), await page(id)])

describe("a curated place whose name is hidden", () => {
  it("names it nowhere public, in its links, its revival's sources or its photo credits, until the hide is lifted", async () => {
    const id = newId()
    const photo = await uploadPhoto(id, 0x71)
    const created = await post(
      body(id, {
        kind: "grove",
        name_he: NAME,
        curated: {
          links: [{ label_he: `${NAME} באתר הרשות`, url: "https://example.org/ziva" }],
          coord_source: "osm",
          region: "envelope",
        },
        photos: [
          {
            key: photo.key,
            thumb_key: photo.thumb_key,
            title: `${NAME} באביב`,
            author: "צלמת דמו",
            license: "CC BY-SA 4.0",
            license_url: "https://creativecommons.org/licenses/by-sa/4.0/",
            commons_url: "https://commons.wikimedia.org/wiki/File:Ziva_Almog_grove.webp",
            subject_he: `שביל ב${NAME}`,
          },
        ],
        sources: [...sources, { field: "photo", photo_idx: 0, source: "commons", license: "CC BY-SA 4.0", retrieved_approx: false }],
      }),
    )
    expect(created.status).toBe(201)
    expect(await visible(id)).toContain(NAME)

    const hidden = await admin("/api/admin/suppressions", {
      method: "POST",
      body: JSON.stringify({ placeId: id, fields: ["name_he"], expectedRev: await viewRev(id), reason: "בקשת משפחה בדמו" }),
    })
    expect(hidden.status).toBe(200)
    const after = await visible(id)
    expect(after).not.toContain(NAME)
    // Nor anywhere else on the share page: its preview tags and image description included.
    expect(await (await call(`http://local/place/${id}`, {}, withSite)).text()).not.toContain(NAME)
    expect(after).not.toContain("Ziva_Almog")
    const shown = (await curatedIn(id))!
    expect(shown.curated.links).toEqual([])
    expect(shown.curated.photos).toHaveLength(1)
    expect(shown.curated.photos[0]).toMatchObject({ title: shown.name_he, author: "צלמת דמו", license: "CC BY-SA 4.0" })
    expect(shown.curated.photos[0].subject_he).toBeUndefined()
    expect(shown.curated.photos[0].commons_url).toBeUndefined()

    const { suppressions } = await (await admin(`/api/admin/places/${id}`)).json<{ suppressions: { id: string }[] }>()
    const lifted = await admin(`/api/admin/suppressions/${suppressions[0].id}/lift`, {
      method: "POST",
      body: JSON.stringify({
        expectedRev: await viewRev(id),
        basisCode: "hidden_in_error",
        basisNote: "ההסתרה נעשתה בטעות בבדיקה, ואין סיבה להשאיר אותה.",
        confirm: { affirmativeBasis: true, notNonresponseOrDispute: true },
      }),
    })
    expect(lifted.status).toBe(200)
    const back = (await curatedIn(id))!
    expect(back.name_he).toBe(NAME)
    expect(back.curated.links[0].label_he).toContain(NAME)
    expect(back.curated.photos[0]).toMatchObject({ title: `${NAME} באביב`, subject_he: `שביל ב${NAME}` })
  })

  it("leaves a community's revival without sources that could name it", async () => {
    const id = newId()
    const created = await post(
      body(id, {
        kind: "community",
        name_he: NAME,
        curated: {
          links: [],
          coord_source: "osm",
          region: "envelope",
          revival: {
            status: "partial",
            milestones_he: [],
            revival_he: "חזרה הדרגתית.",
            sources: [{ label_he: `ועד ${NAME}`, url: "https://example.org/vaad" }],
            confidence: "medium",
          },
        },
        sources: [...sources, { field: "revival", source: "web", retrieved_approx: false }],
      }),
    )
    expect(created.status).toBe(201)
    const hidden = await admin("/api/admin/suppressions", {
      method: "POST",
      body: JSON.stringify({ placeId: id, fields: ["name_he"], expectedRev: await viewRev(id), reason: "בקשת משפחה בדמו" }),
    })
    expect(hidden.status).toBe(200)
    expect(await visible(id)).not.toContain(NAME)
    expect((await curatedIn(id))!.curated.revival!.sources).toEqual([])
  })
})
