import { beforeEach, expect, it, vi } from "vitest"

// IndexedDB shared by two tabs: one map. Each tab's store says which tab it is, so tab B's writes can be slower; an
// update is one transaction (read and write together), as idb-keyval's is.
const idb = vi.hoisted(() => ({ map: new Map<string, unknown>(), tabs: 0, slowTab: 2, broken: false }))
vi.mock("idb-keyval", () => {
  // Tab B reads as fast as A but writes slowly: both find no id, A stores and reads back its own, then B writes.
  const pause = async (s: { tab: number }, write = false) => {
    for (let i = 0; i < (write && s.tab === idb.slowTab ? 6 : 1); i++) await Promise.resolve()
  }
  const guard = () => {
    if (idb.broken) throw new DOMException("blocked", "SecurityError")
  }
  return {
    createStore: () => ({ tab: ++idb.tabs }),
    get: async (key: string, s: { tab: number }) => (guard(), await pause(s), idb.map.get(key)),
    set: async (key: string, value: unknown, s: { tab: number }) => (guard(), await pause(s, true), void idb.map.set(key, value)),
    update: async (key: string, fn: (old: unknown) => unknown, s: { tab: number }) => {
      guard()
      await pause(s, true)
      idb.map.set(key, fn(idb.map.get(key)))
    },
  }
})

/** A tab: the storage module loaded on its own, with its own cache, sharing the one IndexedDB. */
async function tab() {
  vi.resetModules()
  return import("@/lib/storage")
}

beforeEach(() => {
  idb.map.clear()
  idb.tabs = 0
  idb.broken = false
})

it("two tabs leaving their first anemone at once end up with one device id, the one stored", async () => {
  const [a, b] = [await tab(), await tab()]
  const [ida, idb2] = await Promise.all([a.deviceId(true), b.deviceId(true)])
  expect(ida).toMatch(/^[0-9a-f]{32}$/)
  expect(idb2).toBe(ida)
  expect(idb.map.get("device")).toBe(ida)
})

it("opening the site makes no id, and a browser that keeps nothing gets none", async () => {
  const a = await tab()
  expect(await a.deviceId()).toBeNull()
  expect(idb.map.has("device")).toBe(false)
  idb.broken = true
  expect(await (await tab()).deviceId(true)).toBeNull()
})
