import { describe, expect, it } from "vitest"
import { readImportPacket } from "./import-packet"
const picture = btoa("RIFF0000WEBP0000")
function packet() {
  return {
    format: "makom-curated-v1",
    places: [
      {
        id: "import-check",
        kind: "bench",
        name_he: "בדיקת יבוא",
        lat: 31.5,
        lng: 34.5,
        precision: "exact",
        place_he: "מיקום בדיקה",
        summary_he: "זהו מקום דמה לבדיקת קליטת קובץ היבוא בלבד.",
        curated: { links: [], coord_source: "manual", region: "envelope" },
        photos: [{ file: "check.webp", title: "Test illustration", author: "Project", license: "CC0" }],
        sources: [
          { field: "coords", source: "manual", retrieved_approx: false },
          { field: "text", source: "operator", retrieved_approx: false },
          { field: "photo", photo_idx: 0, source: "commons", license: "CC0", retrieved_approx: false },
        ],
      },
    ],
    files: { "check.webp": { file: picture, thumb: picture } } as Record<string, { file: string; thumb: string }>,
  }
}
describe("curated import packet", () => {
  it("validates records, photo credits and both original and thumbnail bytes", () => {
    const p = packet(),
      got = readImportPacket(JSON.stringify(p))
    expect(got.places[0].id).toBe(p.places[0].id)
    expect(got.photoCount).toBe(p.places[0].photos.length)
    expect(got.pictures.get("check.webp")?.file).toEqual(Uint8Array.from(atob(picture), (c) => c.charCodeAt(0)))
  })
  it("refuses missing sources, duplicate ids and incomplete pictures before import", () => {
    const p = packet()
    p.places[0].sources = []
    expect(() => readImportPacket(JSON.stringify(p))).toThrow()
    const duplicate = packet()
    duplicate.places.push(duplicate.places[0])
    expect(() => readImportPacket(JSON.stringify(duplicate))).toThrow()
    const missing = packet()
    delete missing.files[missing.places[0].photos[0].file]
    expect(() => readImportPacket(JSON.stringify(missing))).toThrow("חסרה בקובץ תמונה")
  })
  it("refuses path traversal and non-image payloads", () => {
    const p = packet()
    p.places[0].photos[0].file = "../secret.webp"
    expect(() => readImportPacket(JSON.stringify(p))).toThrow()
    const bad = packet()
    bad.files[bad.places[0].photos[0].file].file = btoa("not an image")
    expect(() => readImportPacket(JSON.stringify(bad))).toThrow("בסוג שלא נתמך")
  })
})
