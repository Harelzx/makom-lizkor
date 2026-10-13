import { describe, expect, it } from "vitest"
import { parseManualPoint } from "./manual-point"

describe("a keyboard-selected location", () => {
  it("accepts the known point without a geolocation or external lookup", () => {
    expect(parseManualPoint("31.46415", "34.52439")).toEqual({ ok: true, point: { lat: 31.46415, lng: 34.52439 } })
  })
  it("accepts decimal commas and surrounding paste whitespace", () => {
    expect(parseManualPoint(" 31,46415 ", "34,52439")).toEqual({ ok: true, point: { lat: 31.46415, lng: 34.52439 } })
  })
  it.each(["", "NaN", "Infinity", "0x1f", "3.1e1", "31<script>", "31.4.2"])("rejects ambiguous latitude %s", (value) => {
    expect(parseManualPoint(value, "34.5")).toMatchObject({ ok: false, field: "lat" })
  })
  it.each([
    ["29.39", "35"],
    ["33.451", "35"],
    ["31", "34.19"],
    ["31", "35.951"],
  ])("rejects outside map bounds %s/%s", (lat, lng) => {
    expect(parseManualPoint(lat, lng).ok).toBe(false)
  })
  it.each([
    ["29.4", "34.2"],
    ["33.45", "35.95"],
  ])("keeps the inclusive covered boundary %s/%s", (lat, lng) => {
    expect(parseManualPoint(lat, lng).ok).toBe(true)
  })
  it("bounds stored precision without silently moving the point to an area center", () => {
    expect(parseManualPoint("31.46415999", "34.52439123")).toEqual({ ok: true, point: { lat: 31.46416, lng: 34.524391 } })
  })
})
