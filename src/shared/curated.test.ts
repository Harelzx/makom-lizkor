import { describe, expect, it } from "vitest"
import records from "@/data/places.json"
import { PublicPlace } from "./contract"
import { CuratedFields, PlaceSource, curatedSourceProblems, type CuratedPhotoMeta } from "./curated"

// Phase 7 (spec 3, 9; adviser a50): a curated record's own fields, its sources, and the rule that a curated record is
// published only with a source for its coordinates, its text, each photo and a community's return.

const rawFields = (r: (typeof records)[number]) => ({
  ...(r.established !== undefined ? { established: r.established } : {}),
  links: r.links,
  coord_source: r.coord_source,
  ...(r.coord_source_url ? { coord_source_url: r.coord_source_url } : {}),
  region: r.region,
  ...("revival" in r && r.revival ? { revival: r.revival } : {}),
})
const fieldsOf = (r: (typeof records)[number]) => CuratedFields.parse(rawFields(r))
const source = (field: PlaceSource["field"], extra: Partial<PlaceSource> = {}): PlaceSource => ({
  field,
  source: field === "photo" ? "commons" : field === "coords" ? "osm" : "web",
  retrieved_approx: true,
  ...extra,
})
const photo: CuratedPhotoMeta = { title: "x", author: "y", license: "CC BY-SA 4.0" }

describe("a curated record's own fields", () => {
  it("hold every one of the 90 records as built today", () => {
    for (const r of records) expect(CuratedFields.safeParse(rawFields(r)).success, r.id).toBe(true)
  })
  it("refuse a field the schema doesn't name, and keep manual coordinates manual", () => {
    expect(CuratedFields.safeParse({ ...rawFields(records[0]), extra: 1 }).success).toBe(false)
    expect(CuratedFields.safeParse({ ...rawFields(records[0]), coord_source: "survey" }).success).toBe(false)
  })
})

describe("the sources a curated record needs before it is published", () => {
  const complete = [source("coords"), source("text"), source("photo", { photo_idx: 0 }), source("revival")]
  const withRevival = { ...fieldsOf(records.find((r) => r.kind === "community")!) }
  it("are its coordinates, its text, each photo by index, and a community's return", () => {
    expect(curatedSourceProblems(withRevival, [photo], complete)).toEqual([])
  })
  it("name what is missing", () => {
    expect(curatedSourceProblems(withRevival, [photo, photo], [source("text"), source("photo", { photo_idx: 1 })])).toEqual([
      "coords",
      "photo:0",
      "revival",
    ])
  })
  it("don't count a source for a photo that isn't there", () => {
    expect(curatedSourceProblems(withRevival, [], [...complete, source("photo", { photo_idx: 3 })])).toEqual(["photo:3:no_photo"])
  })
  it("refuse a photo source without its index, and an index on any other field", () => {
    expect(PlaceSource.safeParse({ field: "photo", source: "commons", retrieved_approx: false }).success).toBe(false)
    expect(PlaceSource.safeParse({ field: "text", photo_idx: 0, source: "web", retrieved_approx: false }).success).toBe(false)
  })
})

describe("the public place", () => {
  it("is a contribution as before, or a curated record with its own fields and photos", () => {
    const contribution = {
      id: "p_01J0000000000000000000000A",
      kind: "bench",
      name_he: "x",
      lat: 31,
      lng: 34,
      precision: "exact",
      place_he: "",
      summary_he: "",
    }
    expect(PublicPlace.parse(contribution)).toEqual(contribution)
    const r = records.find((x) => x.kind === "community")!
    const curated = {
      id: r.id,
      kind: r.kind,
      name_he: r.name_he,
      lat: r.lat,
      lng: r.lng,
      precision: r.precision,
      place_he: r.place_he,
      summary_he: r.summary_he,
      curated: { ...rawFields(r), photos: [{ url: "/media/public/c/x.webp", thumb_url: "/media/public/c/x.thumb.webp", ...photo }] },
    }
    expect(PublicPlace.parse(curated)).toEqual(curated)
    // A community is a curated kind only.
    expect(PublicPlace.safeParse({ ...curated, curated: undefined }).success).toBe(false)
  })
})
