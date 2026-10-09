import { describe, expect, it, vi, beforeEach } from "vitest"
import type { Place } from "@/types"
import { unacceptedLocal } from "@/lib/local-policy"

const disk = vi.hoisted(() => ({ ids: [] as string[], fail: false }))
vi.mock("@/lib/storage", () => ({
  loadSavedVisits: async () => disk.ids,
  changeSavedVisits: async (fn: (ids: string[]) => string[]) => {
    if (disk.fail) throw new Error("blocked")
    disk.ids = fn(disk.ids)
    return disk.ids
  },
  loadLocal: async () => [],
  loadTributes: async () => ({}),
  saveTributes: async () => {},
}))
const { useVisits, visitKey, nextPlace } = await import("@/lib/visit-list")
const { matches } = await import("@/store")
const place = (id: string, extra: Partial<Place> = {}): Place => ({
  id,
  kind: "bench",
  name_he: "הספסל מול הים",
  lat: 31.4,
  lng: 34.5,
  precision: "exact",
  place_he: "אשקלון",
  summary_he: "חברים הקימו פינה לשיחה",
  links: [],
  coord_source: "contribution",
  region: "country",
  ...extra,
})
beforeEach(() => {
  disk.ids = []
  disk.fail = false
  useVisits.setState({ ids: [], busy: false })
})

describe("local proposal policy", () => {
  it("discards interrupted, waiting and refused sends but preserves confirmed tracking copies", () => {
    for (const send of ["sending", "waiting", "rejected"] as const)
      expect(unacceptedLocal(place("local-demo", { local: { createdAt: "", consentAt: "", send } }))).toBe(true)
    expect(unacceptedLocal(place("local-sent", { local: { createdAt: "", consentAt: "", send: "sent", remoteId: "p_1" } }))).toBe(false)
    expect(unacceptedLocal(place("p_public"))).toBe(false)
  })
})

describe("private visit intentions", () => {
  it("uses the public id after publication, never the private tracking capability", () => {
    expect(visitKey(place("local-demo", { local: { createdAt: "", consentAt: "", remoteId: "p_public", trackingToken: "private" } }))).toBe(
      "p_public",
    )
  })
  it("keeps another tab's saves when toggling and stores identifiers only", async () => {
    await useVisits.getState().init()
    disk.ids = ["p_other_tab"]
    expect(await useVisits.getState().toggle("p_here")).toBe(true)
    expect(disk.ids).toEqual(["p_other_tab", "p_here"])
    await useVisits.getState().toggle("p_here")
    expect(disk.ids).toEqual(["p_other_tab"])
  })
  it("reports blocked storage and never marks a place saved", async () => {
    disk.fail = true
    expect(await useVisits.getState().toggle("p_here")).toBe(false)
    expect(useVisits.getState().ids).toEqual([])
    expect(useVisits.getState().busy).toBe(false)
  })
  it("suggests only a different currently published memorial, never a local draft or community", () => {
    const current = place("p_here")
    const next = place("p_next", { lat: 31.41 })
    expect(
      nextPlace(current, [
        current,
        place("p_community", { kind: "community" }),
        place("local-draft", { local: { createdAt: "", consentAt: "" } }),
        next,
      ]),
    ).toBe(next)
    expect(nextPlace(current, [current])).toBeUndefined()
  })
})

it("searches dedication and story using the same token matching as the list, without contact fields", () => {
  const p = place("p_demo", { inMemoryOf: "נוֹעָה דמו", local: { createdAt: "", consentAt: "", submitter: "private@example.test" } })
  expect(matches(p, "נועה אשקלון")).toBe(true)
  expect(matches(p, "פינה חברים")).toBe(true)
  expect(matches(p, "private@example.test")).toBe(false)
})
