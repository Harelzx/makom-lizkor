import { afterEach, expect, it, vi } from "vitest"
import type { Place } from "@/types"

const marked = vi.hoisted(() => ({ ids: [] as string[] }))
vi.mock("@/lib/storage", () => ({
  markUnlisted: async (id: string) => void marked.ids.push(id),
  loadLocal: async () => [],
  loadTributes: async () => ({}),
  saveTributes: async () => undefined,
  changeLocal: async () => [],
}))

/** Loads the store as a page at this address would, with the Worker's place-status tag if any. */
async function storeAt(pathname: string, hash: string, status?: string) {
  vi.resetModules()
  const location = { pathname, hash }
  vi.stubGlobal("location", location)
  vi.stubGlobal("history", {
    replaceState: (_s: unknown, _t: string, url: string) => Object.assign(location, { pathname: "/", hash: url.slice(1) }),
  })
  vi.stubGlobal("document", { querySelector: () => (status ? { getAttribute: () => status } : null) })
  return { location, ...(await import("@/store")) }
}
const place = (id: string) => ({ id, name_he: id, kind: "garden", lat: 31.4, lng: 34.5 }) as Place

afterEach(() => vi.unstubAllGlobals())

it("a share page for a place no longer public opens the overview, and keeps the place off the map from an old copy", async () => {
  for (const status of ["gone", "none"]) {
    const { location, useStore } = await storeAt("/place/p_x", "", status)
    expect(location.hash).toBe("#/")
    expect(useStore.getState().selectedId).toBeNull()
    useStore.getState().setRemote("1", [place("p_x"), place("p_y")], false)
    expect(useStore.getState().remote.map((p) => p.id)).toEqual(["p_y"])
  }
  // Noted in storage both times, so a reload of the overview keeps it off too (src/lib/feed.ts reads the note).
  expect(marked.ids).toEqual(["p_x", "p_x"])
})

it("one of the site's own places taken back is noted too, so an offline reload keeps it off (P7-OFFLINE-1)", async () => {
  marked.ids.length = 0
  const { location, useStore } = await storeAt("/place/car-wall-tkuma", "", "gone")
  expect(location.hash).toBe("#/")
  useStore.getState().setRemote("1", [place("car-wall-tkuma"), place("p_y")], false)
  expect(useStore.getState().remote.map((p) => p.id)).toEqual(["p_y"])
  expect(marked.ids).toEqual(["car-wall-tkuma"])
  // An address no place could have, or a visitor's own id, is noted for nothing.
  for (const id of ["local-1", "Not%20A%20Place"]) await storeAt(`/place/${id}`, "", "none")
  expect(marked.ids).toEqual(["car-wall-tkuma"])
})

it("a share page for a public place opens it under the hash route", async () => {
  marked.ids = []
  const { location, useStore } = await storeAt("/place/p_x", "")
  expect(marked.ids).toEqual([])
  expect(location.hash).toBe("#/place/p_x")
  expect(useStore.getState().selectedId).toBe("p_x")
})

it("a link with a broken escape opens the site, not an empty page", async () => {
  const { useStore } = await storeAt("/", "#/place/%E0%A4%A")
  expect(useStore.getState().selectedId).toBeNull()
  const shared = await storeAt("/place/%E0%A4%A", "", "none")
  expect(shared.useStore.getState().selectedId).toBeNull()
})

it("the server's live feed is shown whole, even a place the share page said wasn't public (it may be approved since)", async () => {
  const { useStore } = await storeAt("/place/p_x", "", "none")
  useStore.getState().setRemote("2", [place("p_x"), place("p_y")], true)
  expect(useStore.getState().remote.map((p) => p.id)).toEqual(["p_x", "p_y"])
})

it("device-id selection resolves only against the effective feed, after offline suppression", async () => {
  const { useStore } = await storeAt("/place/p_x", "", "gone")
  const own = { ...place("local-own"), local: { send: "sent", remoteId: "p_x", trackingToken: "private-test-token" } } as Place
  useStore.setState({ local: [own], selectedId: own.id })
  useStore.getState().setRemote("1", [place("p_x")], false)
  expect(useStore.getState().remote).toEqual([])
  expect(useStore.getState().selectedId).toBe(own.id)
  useStore.getState().select(own.id)
  expect(useStore.getState().selectedId).toBe(own.id)
  useStore.getState().setRemote("2", [place("p_x")], true)
  expect(useStore.getState().selectedId).toBe("p_x")
  expect(useStore.getState().remote[0].local).toBeUndefined()
})
