import { afterEach, beforeEach, expect, it, vi } from "vitest"

// IndexedDB stood in for by one map; an update is one transaction, as idb-keyval's is.
const idb = vi.hoisted(() => ({ map: new Map<string, unknown>() }))
vi.mock("idb-keyval", () => ({
  createStore: () => ({}),
  get: async (key: string) => idb.map.get(key),
  set: async (key: string, value: unknown) => void idb.map.set(key, value),
  update: async (key: string, fn: (old: unknown) => unknown) => void idb.map.set(key, fn(idb.map.get(key))),
}))

const storage = await import("@/lib/storage")
const { useStore } = await import("@/store")

beforeEach(() => idb.map.clear())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it("a feed asked for before a removal was learned can't undo it, whatever the clock does; one asked for after it can", async () => {
  const before = await storage.unlistedGeneration()
  // The device clock jumps back between the request and the removal: ordering doesn't depend on it.
  vi.spyOn(Date, "now").mockReturnValue(1)
  await storage.markUnlisted("p_x")
  await storage.relistPublished(["p_x"], before)
  expect(await storage.loadUnlisted()).toEqual(["p_x"])
  // A feed asked for after the removal, which lists the place again, is the server's newer word.
  await storage.relistPublished(["p_x"], await storage.unlistedGeneration())
  expect(await storage.loadUnlisted()).toEqual([])
})

/** A page with a visible tab, and a server whose feed lists `places`; `online: false` refuses every request. */
function page(server: { online: boolean; places: { id: string }[]; hold?: Promise<void>; started?: () => void }) {
  vi.stubGlobal("document", {
    visibilityState: "visible",
    addEventListener: () => {},
    removeEventListener: () => {},
    getElementById: () => null,
  })
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} })
  vi.stubGlobal("fetch", async (url: string) => {
    if (!server.online) throw new TypeError("offline")
    if (url.startsWith("/api/v1/version")) {
      server.started?.()
      return new Response(JSON.stringify({ v: `1.${server.places.length}` }))
    }
    if (url.startsWith("/api/v1/feed")) {
      await server.hold
      return new Response(JSON.stringify({ v: `1.${server.places.length}`, places: server.places }))
    }
    return new Response("{}", { status: 404 })
  })
  useStore.setState({ remote: [], feedVersion: null, feedLive: false })
}
const place = { id: "p_x", kind: "garden", name_he: "גינת דמו", lat: 31.4, lng: 34.5, precision: "exact", place_he: "", summary_he: "" }
const shown = () => useStore.getState().remote.map((p) => p.id)

it("a feed response held across the removal is saved, yet the place stays off after an offline restart; a later feed relists it", async () => {
  const { startFeedSync } = await import("@/lib/feed")
  let release!: () => void
  let started!: () => void
  const requestStarted = new Promise<void>((r) => (started = r))
  const server = { online: true, places: [place], hold: new Promise<void>((r) => (release = r)), started }
  page(server)
  let stop = startFeedSync()
  // The feed request is under way; meanwhile another tab opens the place's share page, which answers 410.
  await requestStarted
  vi.spyOn(Date, "now").mockReturnValue(0)
  await storage.markUnlisted("p_x")
  release()
  await vi.waitFor(() => expect((idb.map.get("feed") as { places: unknown[] } | undefined)?.places).toHaveLength(1))
  stop()
  expect(await storage.loadUnlisted()).toEqual(["p_x"])

  // A restart with no connection: the offline copy holds the place, and it stays off.
  page({ online: false, places: [] })
  stop = startFeedSync()
  await vi.waitFor(() => expect(useStore.getState().feedVersion).not.toBeNull())
  expect(shown()).toEqual([])
  stop()

  // Online again, the server lists it (approved again): a feed asked for after the removal relists it, offline too.
  let again!: () => void
  const asked = new Promise<void>((r) => (again = r))
  page({ online: true, places: [place, { ...place, id: "p_y" }], started: again })
  stop = startFeedSync()
  await asked
  await vi.waitFor(async () => expect(await storage.loadUnlisted()).toEqual([]))
  stop()
  page({ online: false, places: [] })
  stop = startFeedSync()
  await vi.waitFor(() => expect(shown()).toContain("p_x"))
  stop()
})
