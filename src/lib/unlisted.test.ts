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

beforeEach(() => idb.map.clear())
afterEach(() => vi.unstubAllGlobals())

it("a feed asked for before a removal was learned can't undo it; one asked for after it can", async () => {
  const before = Date.now()
  await new Promise((r) => setTimeout(r, 5))
  await storage.markUnlisted("p_x")
  // The older feed still lists it (it was public when that feed was made): the mark stays.
  await storage.relistPublished(["p_x"], before)
  expect(await storage.loadUnlisted()).toEqual(["p_x"])
  // A feed asked for later that lists it again is the server's newer word: the place is public after all.
  await new Promise((r) => setTimeout(r, 5))
  await storage.relistPublished(["p_x"], Date.now())
  expect(await storage.loadUnlisted()).toEqual([])
})

it("through the feed itself: a response held across the removal, then saved, still leaves the place off offline", async () => {
  // A page with a visible tab and nothing else the feed needs from the DOM.
  vi.stubGlobal("document", {
    visibilityState: "visible",
    addEventListener: () => {},
    removeEventListener: () => {},
    getElementById: () => null,
  })
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} })
  const place = { id: "p_x", kind: "garden", name_he: "גינת דמו", lat: 31.4, lng: 34.5, precision: "exact", place_he: "", summary_he: "" }
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.startsWith("/api/v1/version")) return new Response(JSON.stringify({ v: "1-1" }))
    if (url.startsWith("/api/v1/feed")) {
      await held
      return new Response(JSON.stringify({ v: "1-1", places: [place] }))
    }
    return new Response("{}", { status: 404 })
  })
  const { startFeedSync } = await import("@/lib/feed")
  const stop = startFeedSync()
  await new Promise((r) => setTimeout(r, 10))
  // Meanwhile another tab opens the place's share page, which answers 410.
  await storage.markUnlisted("p_x")
  release()
  await vi.waitFor(async () => expect((idb.map.get("feed") as { places: unknown[] } | undefined)?.places).toHaveLength(1))
  await new Promise((r) => setTimeout(r, 10))
  stop()
  // The old response was saved as the offline copy, but the newer removal stands.
  expect(await storage.loadUnlisted()).toEqual(["p_x"])
})
