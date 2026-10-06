import { beforeEach, expect, it, vi } from "vitest"
import type { ReportInput } from "@/shared/contract"

// IndexedDB stood in for, each change applied at once and in order (as idb-keyval's update does). `mode`: "ok"; "broken"
// (the store exists but refuses, so a copy may sit there unread); "none" (no storage at all, so nothing was ever kept).
const disk = vi.hoisted(() => ({ keys: {} as Record<string, unknown>, mode: "ok" as "ok" | "broken" | "none" }))
vi.mock("@/lib/storage", () => ({
  changeReportOutbox: async (fn: (v: never) => unknown) => {
    if (disk.mode === "none") throw new Error("storage_unavailable")
    if (disk.mode === "broken") throw new Error("QuotaExceededError")
    return (disk.keys.reportOutbox = fn((disk.keys.reportOutbox ?? {}) as never))
  },
}))

const o = await import("@/lib/report-outbox")

const payload: ReportInput = {
  placeId: "p_1",
  elements: ["name_he"],
  requesterType: "family",
  explanation: "השם מופיע כאן בלי רשות המשפחה, נבקש להסתיר אותו.",
  noticeVersion: "notice.report@2026-10-3",
}
const t0 = Date.UTC(2026, 9, 6, 9)

beforeEach(() => {
  disk.keys = {}
  disk.mode = "ok"
})

it("the window is the configured hours from the first try", () => {
  expect(o.REPORT_WINDOW_MS).toBe(24 * 3600_000)
  expect(o.freeze("p_1", payload, "k".repeat(22), t0).expiresAt).toBe(t0 + o.REPORT_WINDOW_MS)
})

it("a kept request is read back exactly as it was frozen", async () => {
  const r = o.freeze("p_1", payload, "k".repeat(22), t0)
  expect(await o.remember(r)).toBe("stored")
  expect(await o.storedReports(t0 + 60_000)).toEqual({ reports: [r], complete: true })
})

it("a store that refuses: nothing kept, and a read says it couldn't read rather than that there is nothing", async () => {
  disk.mode = "broken"
  const r = o.freeze("p_1", payload, "a".repeat(22), t0)
  expect(await o.remember(r)).toBe("memory")
  expect(await o.storedReports(t0)).toEqual({ reports: [], complete: false })
  expect(await o.forget(r.key)).toBe("failed")
})

it("no storage at all: nothing kept, nothing unread, and nothing left behind", async () => {
  disk.mode = "none"
  const r = o.freeze("p_1", payload, "b".repeat(22), t0)
  expect(await o.remember(r)).toBe("memory")
  expect(await o.storedReports(t0)).toEqual({ reports: [], complete: true })
  expect(await o.forget(r.key)).toBe("cleared")
})

it("letting go is key-scoped", async () => {
  const one = o.freeze("p_1", payload, "c".repeat(22), t0)
  const two = o.freeze("p_2", { ...payload, placeId: "p_2" }, "d".repeat(22), t0 + 1)
  await o.remember(one)
  await o.remember(two)
  expect(await o.forget(one.key)).toBe("cleared")
  expect((await o.storedReports(t0)).reports).toEqual([two])
})

it("past the window nothing is read, and a prune drops the browser's copy; a prune that fails never throws", async () => {
  const r = o.freeze("p_1", payload, "e".repeat(22), t0)
  await o.remember(r)
  expect((await o.storedReports(t0 + o.REPORT_WINDOW_MS - 1)).reports).toEqual([r])
  expect((await o.storedReports(t0 + o.REPORT_WINDOW_MS)).reports).toEqual([])
  await o.remember(r)
  await o.pruneReports(t0 + o.REPORT_WINDOW_MS)
  expect(disk.keys.reportOutbox).toEqual({})
  disk.mode = "broken"
  await expect(o.pruneReports(t0)).resolves.toBeUndefined()
})

it("from the moment the site runs, a stored request is dropped at its deadline, with no view of it ever loaded", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })
  try {
    vi.setSystemTime(t0)
    const r = o.freeze("p_1", payload, "g".repeat(22), t0)
    await o.remember(r)
    await o.superviseReports()
    await vi.advanceTimersByTimeAsync(o.REPORT_WINDOW_MS - 1)
    expect(Object.keys(disk.keys.reportOutbox as object)).toEqual([r.key])
    await vi.advanceTimersByTimeAsync(1)
    expect(disk.keys.reportOutbox).toEqual({})
  } finally {
    vi.useRealTimers()
  }
})
