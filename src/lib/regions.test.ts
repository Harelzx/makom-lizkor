import { describe, expect, it } from "vitest"
import type { MultiPolygon, Polygon } from "geojson"
import boundaries from "@/data/region-boundaries.json"
import curated from "../../fixtures/curated.json"
import { containsPoint, groupPlaces, placeRegion, REGIONS } from "./regions"

const at = (lat: number, lng: number) => ({ lat, lng, region: "country" as const })

describe("coordinate classification with the pinned boundaries", () => {
  it.each([
    ["חיפה", 32.794, 34.9896, "haifa"],
    ["חדרה", 32.434, 34.919, "haifa"],
    ["עכו", 32.927, 35.083, "north"],
    ["צפת", 32.965, 35.499, "north"],
    ["טבריה", 32.794, 35.531, "north"],
    ["עפולה", 32.609, 35.289, "north"],
    ["קצרין", 32.992, 35.689, "golan"],
    ["תל אביב", 32.0853, 34.7818, "tel-aviv"],
    ["ירושלים", 31.7683, 35.2137, "jerusalem"],
    ["נתניה", 32.3215, 34.8532, "center"],
    ["רחובות", 31.8948, 34.8113, "center"],
    ["פתח תקווה", 32.084, 34.887, "center"],
    ["רמלה", 31.9275, 34.862, "center"],
    ["אשקלון", 31.6688, 34.5743, "south"],
    ["באר שבע", 31.252, 34.7915, "south"],
    ["אילת", 29.5577, 34.9519, "south"],
    ["הערבה", 30.3667, 35.1586, "south"],
    ["מעלה אדומים", 31.788053, 35.314005, "judea-samaria"],
  ])("classifies %s from coordinates alone", (_name, lat, lng, region) => {
    expect(placeRegion(at(lat as number, lng as number))).toBe(region)
  })

  it("preserves envelope membership without using it to redraw geographic boundaries", () => {
    expect(placeRegion({ ...at(31.416, 34.49), region: "envelope" })).toBe("envelope")
    expect(placeRegion(at(31.416, 34.49))).toBe("south")
  })

  it.each([
    [0, 0],
    [NaN, 35],
    [32, Infinity],
    [91, 35],
    [32, 181],
  ])("keeps uncovered/invalid coordinates %s,%s in the fallback", (lat, lng) => expect(placeRegion(at(lat, lng))).toBe("other"))

  it("keeps source provenance and all 15 subdistricts in the bundled snapshot", () => {
    expect(boundaries.source.year).toBe(2021)
    expect(boundaries.source.license).toBe("CC0-1.0")
    expect(boundaries.features).toHaveLength(16)
    expect(new Set(boundaries.features.map((f) => f.name)).size).toBe(16)
    expect(boundaries.supplementarySource.license).toBe("CC-BY-4.0")
  })
})

describe("polygon membership", () => {
  const shape: Polygon = {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
        [0, 0],
      ],
      [
        [1, 1],
        [3, 1],
        [3, 3],
        [1, 3],
        [1, 1],
      ],
    ],
  }
  it("handles holes, vertices, repeated vertices and outer/hole edges", () => {
    expect(containsPoint([0.5, 0.5], shape)).toBe(true)
    expect(containsPoint([2, 2], shape)).toBe(false)
    expect(containsPoint([1, 2], shape)).toBe(true)
    expect(containsPoint([0, 2], shape)).toBe(true)
    expect(containsPoint([4, 4], shape)).toBe(true)
    expect(containsPoint([5, 2], shape)).toBe(false)
    expect(containsPoint([NaN, 2], shape)).toBe(false)
  })
  it("handles disjoint polygons and reversed winding", () => {
    const multi: MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [
        shape.coordinates,
        [
          [
            [10, 10],
            [10, 12],
            [12, 12],
            [12, 10],
            [10, 10],
          ],
        ],
      ],
    }
    expect(containsPoint([11, 11], multi)).toBe(true)
    expect(containsPoint([7, 7], multi)).toBe(false)
    expect(containsPoint([2, 2], multi)).toBe(false)
  })
})

describe("list grouping", () => {
  it("places every curated non-community record once, preserving order within each group", () => {
    const places = curated.places
      .filter((p) => p.kind !== "community")
      .map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, region: p.curated.region as "envelope" | "country" }))
    const groups = groupPlaces(places)
    const ids = groups.flatMap((g) => g.items.map((p) => p.id))
    expect(ids.length).toBe(places.length)
    expect(new Set(ids).size).toBe(places.length)
    expect(new Set(ids)).toEqual(new Set(places.map((p) => p.id)))
    for (const g of groups) expect(g.items).toEqual(places.filter((p) => placeRegion(p) === g.id))
    expect(groups.map((g) => g.id)).toEqual(REGIONS.filter((r) => groups.some((g) => g.id === r.id)).map((r) => r.id))
    expect(groups.find((g) => g.id === "envelope")?.items.length).toBe(places.filter((p) => p.region === "envelope").length)
  })
  it("retains local proposals once, filters empty groups, and does not mutate records", () => {
    const local = { id: "local", ...at(32.0853, 34.7818), local: { send: "sent" } }
    const remote = { id: "remote", ...at(32.794, 34.9896) }
    const uncovered = { id: "uncovered", ...at(0, 0) }
    const places = [local, remote, uncovered]
    const before = JSON.stringify(places)
    expect(groupPlaces(places).map((g) => [g.id, g.items.map((p) => p.id)])).toEqual([
      ["local", ["local"]],
      ["haifa", ["remote"]],
      ["other", ["uncovered"]],
    ])
    expect(groupPlaces([])).toEqual([])
    expect(JSON.stringify(places)).toBe(before)
  })
})
