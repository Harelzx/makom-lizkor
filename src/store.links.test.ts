import { afterEach, expect, it, vi } from "vitest"
import type { Place } from "@/types"

vi.mock("@/lib/storage", () => ({
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
})

it("a share page for a public place opens it under the hash route", async () => {
  const { location, useStore } = await storeAt("/place/p_x", "")
  expect(location.hash).toBe("#/place/p_x")
  expect(useStore.getState().selectedId).toBe("p_x")
})

it("a link with a broken escape opens the site, not an empty page", async () => {
  const { useStore } = await storeAt("/", "#/place/%E0%A4%A")
  expect(useStore.getState().selectedId).toBeNull()
  const shared = await storeAt("/place/%E0%A4%A", "", "none")
  expect(shared.useStore.getState().selectedId).toBeNull()
})
