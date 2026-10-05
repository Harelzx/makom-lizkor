import { beforeEach, expect, it, vi } from "vitest"

// IndexedDB stood in for, key by key, each change applied at once and in order (as idb-keyval's update does).
const disk = vi.hoisted(() => ({ keys: {} as Record<string, unknown> }))
const net = vi.hoisted(() => ({ posts: [] as string[], answer: null as null | (() => void) }))
vi.mock("@/lib/storage", () => {
  const change = (name: string) => async (fn: (v: never) => unknown) => (disk.keys[name] = fn((disk.keys[name] ?? {}) as never))
  return {
    deviceId: async () => "0123456789abcdef0123456789abcdef",
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
    if (net.posts.length === 1) await new Promise<void>((r) => (net.answer = r))
    return { ok: true, result: { counted: true } }
  },
}))

const { queueTribute } = await import("@/lib/tributes")

beforeEach(() => {
  disk.keys = {}
  net.posts = []
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
