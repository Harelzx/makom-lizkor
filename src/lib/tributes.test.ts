import { beforeEach, expect, it, vi } from "vitest"

// IndexedDB stood in for, key by key, each change applied at once and in order (as idb-keyval's update does).
const disk = vi.hoisted(() => ({ keys: {} as Record<string, unknown> }))
const net = vi.hoisted(() => ({ posts: [] as string[], answer: null as null | (() => void), hold: true, day: "2026-10-06" }))
vi.mock("@/lib/storage", () => {
  const change = (name: string) => async (fn: (v: never) => unknown) => (disk.keys[name] = fn((disk.keys[name] ?? {}) as never))
  return {
    deviceId: async () => "0123456789abcdef0123456789abcdef",
    storageWorks: async () => true,
    changeTributeOutbox: change("tributeOutbox"),
    loadLocal: async () => [],
    loadTributes: async () => ({}),
    saveTributes: async () => undefined,
    changeLocal: async () => [],
  }
})
vi.mock("@/lib/api", () => ({
  getTributeTotals: async () => ({}),
  sendTribute: async (_place: string, _device: string, key: string) => {
    net.posts.push(key)
    // The first answer is held; any further send (the bug) is answered at once.
    if (net.posts.length === 1 && net.hold) await new Promise<void>((r) => (net.answer = r))
    return { ok: true, result: { counted: true, day: net.day } }
  },
}))

const { queueTribute } = await import("@/lib/tributes")

beforeEach(() => {
  disk.keys = {}
  net.posts = []
  net.hold = true
  // The day the stand-in server answers with is the device's today: midday on 6 October in Jerusalem, whatever the
  // clock says (it failed once Jerusalem passed midnight into the 7th, the answer then read as yesterday's).
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-06T09:00:00Z"))
})

it("taps at every moment around an answer send one anemone a day", async () => {
  const taps: Promise<void>[] = [queueTribute("p_1")]
  await vi.waitFor(() => expect(net.posts).toHaveLength(1))
  taps.push(queueTribute("p_1"))
  net.answer!()
  // Tap on every turn of the event loop while the answer is being recorded.
  for (let i = 0; i < 20; i++) {
    taps.push(queueTribute("p_1"))
    await Promise.resolve()
  }
  await Promise.all(taps)
  expect(net.posts).toHaveLength(1)
})

it("an anemone counted just before midnight, answered after it, doesn't hold back the new day's", async () => {
  // 00:30 in Jerusalem on 6 October; the server counted the anemone on the 5th (its answer came late).
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-05T21:30:00Z"))
  net.hold = false
  net.day = "2026-10-05"
  await queueTribute("p_2")
  expect(net.posts).toHaveLength(1)
  net.day = "2026-10-06"
  await queueTribute("p_2")
  expect(net.posts).toHaveLength(2)
})

it("an anemone left at another place while one is being sent is sent too, not left until the tab comes back", async () => {
  const first = queueTribute("p_a")
  await vi.waitFor(() => expect(net.posts).toHaveLength(1))
  const second = queueTribute("p_b")
  await second
  net.answer!()
  await first
  await vi.waitFor(() => expect(net.posts).toHaveLength(2))
  expect(Object.values(disk.keys.tributeOutbox as object).every((e) => "day" in e)).toBe(true)
})
