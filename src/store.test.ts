import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Place } from "@/types"

// IndexedDB stood in for: one list, changed in order, with a way to hold a change's answer after it was applied.
const disk = vi.hoisted(() => ({
  stored: [] as Place[],
  fail: null as Error | null,
  /** the change is applied, then an error is reported anyway */
  failAfter: null as Error | null,
  unreadable: false,
  hold: null as Promise<void> | null,
}))
vi.mock("@/lib/storage", () => ({
  loadLocal: async () => (disk.unreadable ? null : disk.stored),
  loadTributes: async () => ({}),
  saveTributes: async () => undefined,
  changeLocal: async (change: (s: Place[]) => Place[]) => {
    if (disk.fail) throw disk.fail
    disk.stored = change(disk.stored)
    if (disk.failAfter) throw disk.failAfter
    const answer = disk.stored
    // The transaction is done; its answer reaches the store only when released.
    if (disk.hold) await disk.hold
    return answer
  },
}))

const { useStore, allPlaces } = await import("@/store")

const place = (id: string, extra: Partial<Place["local"]> = {}): Place =>
  ({
    id,
    name_he: id,
    kind: "bench",
    lat: 31.4,
    lng: 34.5,
    local: { send: "sent", remoteId: `p_${id}`, trackingToken: `token-${id}`, ...extra },
  }) as Place

describe("selection when this device's proposal becomes public", () => {
  beforeEach(() => useStore.setState({ local: [], remote: [], selectedId: null }))
  const published = () => ({ id: "p_local-mine", name_he: "approved", kind: "bench", lat: 31.4, lng: 34.5 }) as Place

  it("moves an already open device card to its public id without putting tracking metadata in the feed", async () => {
    const own = place("local-mine")
    await useStore.getState().addLocal(own)
    useStore.getState().select(own.id)
    useStore.getState().setRemote("2", [published()])
    const s = useStore.getState()
    expect(s.selectedId).toBe("p_local-mine")
    expect(allPlaces(s).map((p) => p.id)).toEqual(["p_local-mine"])
    expect(s.remote[0].local).toBeUndefined()
    expect(s.local[0].local?.trackingToken).toBe("token-local-mine")
  })

  it("resolves the receipt's old device id when approval arrived before the receipt was closed", async () => {
    await useStore.getState().addLocal(place("local-mine"))
    useStore.getState().setRemote("2", [published()])
    useStore.getState().select("local-mine")
    expect(useStore.getState().selectedId).toBe("p_local-mine")
    expect(await useStore.getState().removeLocal("local-mine")).toBe("removed")
    expect(useStore.getState().local).toEqual([])
    expect(useStore.getState().remote[0].id).toBe("p_local-mine")
  })

  it("keeps a pending card selected and never invents a public place from its receipt", async () => {
    await useStore.getState().addLocal(place("local-mine"))
    useStore.getState().select("local-mine")
    useStore.getState().setRemote("2", [])
    expect(useStore.getState().selectedId).toBe("local-mine")
    expect(useStore.getState().remote).toEqual([])
  })

  it("resolves a reloaded device link when the public feed arrives before device storage", async () => {
    disk.stored = [place("local-mine")]
    useStore.setState({ selectedId: "local-mine" })
    useStore.getState().setRemote("2", [published()])
    expect(useStore.getState().selectedId).toBe("local-mine")
    await useStore.getState().init()
    expect(useStore.getState().selectedId).toBe("p_local-mine")
    expect(useStore.getState().remote[0].local).toBeUndefined()
  })
})

beforeEach(async () => {
  disk.stored = []
  disk.fail = null
  disk.failAfter = null
  disk.unreadable = false
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
    // On the next visit too: the removal is what was stored, and the other place keeps its tracking link.
    useStore.setState({ local: [] })
    await useStore.getState().init()
    expect(useStore.getState().local.map((p) => [p.id, p.local?.trackingToken])).toEqual([["local-y", "token-local-y"]])
  })

  it("a place removed while its first save is still settling stays removed, and is never sent", async () => {
    await useStore.getState().init()
    let release!: () => void
    disk.hold = new Promise((r) => (release = r))
    // The new place's first save reaches storage, but its answer is held…
    const added = useStore.getState().addLocal(place("local-new"))
    disk.hold = null
    // …while the visitor removes it; the removal is stored and says so.
    expect(await useStore.getState().removeLocal("local-new")).toBe("removed")
    release()
    await added
    expect(useStore.getState().local).toEqual([])
    expect(disk.stored).toEqual([])
    expect(await useStore.getState().stillLocal("local-new")).toBe(false)
    // On the next visit too.
    await useStore.getState().init()
    expect(useStore.getState().local).toEqual([])
  })

  it("an unsuccessful send from an older tab is discarded, never imported into this map", async () => {
    await useStore.getState().init()
    disk.stored = [place("local-other", { send: "sending" })]
    await useStore.getState().addLocal(place("local-mine"))
    const other = useStore.getState().local.find((p) => p.id === "local-other")
    expect(other).toBeUndefined()
    expect(disk.stored.map((p) => p.id).sort()).toEqual(["local-mine"])
  })

  it("a removal the device couldn't save says the place is kept there, for a place read from it or written to it", async () => {
    disk.stored = [place("local-x")]
    await useStore.getState().init()
    await useStore.getState().addLocal(place("local-w"))
    disk.fail = new DOMException("full", "QuotaExceededError")
    expect(await useStore.getState().removeLocal("local-x")).toBe("kept")
    expect(await useStore.getState().removeLocal("local-w")).toBe("kept")
  })

  it("in a browser that keeps nothing, a place made here is simply removed", async () => {
    await useStore.getState().init()
    disk.fail = new DOMException("blocked", "SecurityError")
    expect(await useStore.getState().addLocal(place("local-z"))).toBe(false)
    expect(await useStore.getState().removeLocal("local-z")).toBe("removed")
  })

  it("a place whose write reported an error but was later seen on the device counts as kept there", async () => {
    await useStore.getState().init()
    disk.failAfter = new DOMException("aborted", "AbortError")
    expect(await useStore.getState().addLocal(place("local-c"))).toBe(false)
    disk.failAfter = null
    await useStore.getState().updateLocal("local-c", { nextTryAt: 1 })
    disk.fail = new DOMException("blocked", "SecurityError")
    expect(await useStore.getState().removeLocal("local-c")).toBe("kept")
  })

  it("when the device couldn't be read at the start, a failed removal is unknown, not done", async () => {
    disk.unreadable = true
    await useStore.getState().init()
    disk.fail = new DOMException("blocked", "SecurityError")
    await useStore.getState().importLocal([place("local-i")])
    expect(await useStore.getState().removeLocal("local-i")).toBe("unknown")
  })

  it("a removal while the guard's own read of the device is held still stops the send", async () => {
    disk.stored = [place("local-g")]
    await useStore.getState().init()
    let release!: () => void
    disk.hold = new Promise((r) => (release = r))
    const asking = useStore.getState().stillLocal("local-g")
    disk.hold = null
    useStore.setState({ local: [] })
    release()
    expect(await asking).toBe(false)
  })

  it("a place another tab removed from the device isn't the visitor's to send any more", async () => {
    disk.stored = [place("local-a"), place("local-b")]
    await useStore.getState().init()
    disk.stored = [place("local-a")]
    expect(await useStore.getState().stillLocal("local-b")).toBe(false)
    expect(useStore.getState().local.map((p) => p.id)).toEqual(["local-a"])
    expect(await useStore.getState().stillLocal("local-a")).toBe(true)
  })
})
