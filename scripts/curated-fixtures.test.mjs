import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { CuratedInput, curatedSourceProblems } from "../src/shared/curated.ts"
import { curatedFixtures } from "./curated-fixtures.mjs"

// The curated fixtures (phase 7, task 2): the records the importer sends through POST /api/admin/places, written by
// build-data from the same research as places.json. Each must be a record the route accepts, with a source for every
// field, and the committed file must be what the generator makes of today's data.

const places = JSON.parse(readFileSync("src/data/places.json", "utf8"))
const committed = JSON.parse(readFileSync("fixtures/curated.json", "utf8"))
const dates = { dataSrcDate: committed.data_src_date, revivalAsOf: committed.revival_as_of }
// What the route receives once the importer has uploaded the photos: each file by the keys its upload got.
const asSent = (r) => ({
  ...r,
  expectedRev: 0,
  photos: r.photos.map(({ file, ...meta }) => ({
    ...meta,
    key: `quarantine/${r.id}/${file}`,
    thumb_key: `quarantine/${r.id}/${file}.thumb`,
  })),
})

test("every record is one the route accepts, with a source for each field", () => {
  const { places: records } = curatedFixtures(places, dates)
  assert.equal(records.length, places.length)
  for (const r of records) {
    const parsed = CuratedInput.safeParse(asSent(r))
    assert.ok(parsed.success, `${r.id}: ${parsed.error?.message}`)
    assert.deepEqual(curatedSourceProblems(parsed.data.curated, parsed.data.photos, parsed.data.sources), [], r.id)
  }
})

test("agrees with places.json on every field the map shows", () => {
  const { places: records } = curatedFixtures(places, dates)
  for (const [i, p] of places.entries()) {
    const r = records[i]
    assert.deepEqual(
      { id: r.id, name_he: r.name_he, kind: r.kind, lat: r.lat, lng: r.lng, precision: r.precision, place_he: r.place_he },
      { id: p.id, name_he: p.name_he, kind: p.kind, lat: p.lat, lng: p.lng, precision: p.precision, place_he: p.place_he },
    )
    assert.equal(r.summary_he, p.summary_he)
    assert.deepEqual(r.curated.links, p.links)
    assert.deepEqual(r.curated.revival, p.revival)
    assert.deepEqual(
      r.photos.map((ph) => ph.file),
      p.photos.map((ph) => ph.file),
    )
  }
})

test("records where each source came from as it was recorded, and marks a repository date as approximate (a50)", () => {
  const { places: records } = curatedFixtures(places, dates)
  const byId = new Map(records.map((r) => [r.id, r]))
  for (const p of places) {
    const coords = byId.get(p.id).sources.filter((s) => s.field === "coords")
    assert.equal(coords.length, 1, p.id)
    // manual stays manual: never relabelled a survey without evidence.
    assert.equal(coords[0].source, p.coord_source, p.id)
    assert.equal(coords[0].retrieved_at, dates.dataSrcDate)
    assert.equal(coords[0].retrieved_approx, true)
  }
  const osm = records.find((r) => r.curated.coord_source === "osm")
  assert.equal(osm.sources.find((s) => s.field === "coords").license, "ODbL-1.0")
  const withPhoto = records.find((r) => r.photos.length)
  const photo = withPhoto.sources.find((s) => s.field === "photo" && s.photo_idx === 0)
  assert.deepEqual(
    { source: photo.source, license: photo.license, url: photo.url },
    { source: "commons", license: withPhoto.photos[0].license, url: withPhoto.photos[0].commons_url },
  )
  const revived = records.find((r) => r.curated.revival?.sources.length)
  for (const s of revived.sources.filter((x) => x.field === "revival"))
    assert.deepEqual(
      { retrieved_at: s.retrieved_at, retrieved_approx: s.retrieved_approx },
      { retrieved_at: dates.revivalAsOf, retrieved_approx: false },
    )
  // The summary is the operator's own writing.
  assert.ok(records.every((r) => r.sources.some((s) => s.field === "text" && s.source === "operator")))
})

test("the committed file is what the generator makes of today's data", () => {
  assert.deepEqual(committed, curatedFixtures(places, dates))
})
