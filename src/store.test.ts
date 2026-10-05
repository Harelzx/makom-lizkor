import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Place } from "@/types"

// IndexedDB stood in for: one list, changed in order, with a way to hold a change's answer after it was applied.
const disk = vi.hoisted(() => ({
  stored: [] as Place[],
  fail: null as Error | null,
  hold: null as Promise<void> | null,
}))
vi.mock("@/lib/storage", () => ({
  loadLocal: async () => disk.stored,
  loadTributes: async () => ({}),
  saveTributes: async () => undefined,
  changeLocal: async (change: (s: Place[]) => Place[]) => {
    if (disk.fail) throw disk.fail
    disk.stored = change(disk.stored)
    const answer = disk.stored
    // The transaction is done; its answer reaches the store only when released.
    if (disk.hold) await disk.hold
    return answer
  },
}))

const { useStore } = await import("@/store")

const place = (id: string, extra: Partial<Place["local"]> = {}): Place =>
  ({ id, name_he: id, kind: "bench", lat: 31.4, lng: 34.5, local: { send: "waiting", submitKey: `key-${id}`, ...extra } }) as Place

beforeEach(async () => {
  disk.stored = []
  disk.fail = null
  disk.hold = null
  useStore.setState({ local: [] })
})

describe("the visitor's places in the store", () => {
  it("a write that finishes after a removal never brings the removed place back", async () => {
    disk.stored = [place("local-x"), place("local-y")]
    await useStore.getState().init()
    let release!: () => void
    disk.hold = new Promise((r) => (release = r))
    // An earlier update (the outbox recording something) is applied to storage, but its answer is held…
    const earlier = useStore.getState().updateLocal("local-x", { nextTryAt: 1 })
    disk.hold = null
    // …while the visitor removes the place.
    await useStore.getState().removeLocal("local-x")
    release()
    await earlier
    expect(useStore.getState().local.map((p) => p.id)).toEqual(["local-y"])
    expect(disk.stored.map((p) => p.id)).toEqual(["local-y"])
    // On the next visit too: the removal is what was stored, and the other place keeps its key.
    useStore.setState({ local: [] })
    await useStore.getState().init()
    expect(useStore.getState().local.map((p) => [p.id, p.local?.submitKey])).toEqual([["local-y", "key-local-y"]])
  })

  it("a place another tab stored joins this tab's list, waiting rather than 'sending'", async () => {
    await useStore.getState().init()
    disk.stored = [place("local-other", { send: "sending" })]
    await useStore.getState().addLocal(place("local-mine"))
    const other = useStore.getState().local.find((p) => p.id === "local-other")
    expect(other?.local?.send).toBe("waiting")
    expect(disk.stored.map((p) => p.id).sort()).toEqual(["local-mine", "local-other"])
  })

  it("a removal the device couldn't save says so; with no storage at all there was nothing to remove", async () => {
    disk.stored = [place("local-x")]
    await useStore.getState().init()
    disk.fail = new Error("QuotaExceededError")
    expect(await useStore.getState().removeLocal("local-x")).toBe(false)
    disk.fail = new Error("storage_unavailable")
    useStore.setState({ local: [place("local-z")] })
    expect(await useStore.getState().removeLocal("local-z")).toBe(true)
  })

  it("a place read from the device isn't counted as removed when the device can no longer be reached", async () => {
    disk.stored = [place("local-kept")]
    await useStore.getState().init()
    disk.fail = new Error("storage_unavailable")
    expect(await useStore.getState().removeLocal("local-kept")).toBe(false)
  })
})
