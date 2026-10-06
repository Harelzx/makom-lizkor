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

// A fresh module is a reload: the page's memory goes, the browser's copy stays.
let o: typeof import("@/lib/report-outbox")
const reload = async () => {
  vi.resetModules()
  o = await import("@/lib/report-outbox")
}

const payload: ReportInput = {
  placeId: "p_1",
  elements: ["name_he"],
  requesterType: "family",
  explanation: "השם מופיע כאן בלי רשות המשפחה, נבקש להסתיר אותו.",
  noticeVersion: "notice.report@2026-10-3",
}
const t0 = Date.UTC(2026, 9, 6, 9)

beforeEach(async () => {
  disk.keys = {}
  disk.mode = "ok"
  await reload()
})

it("the window is the configured hours from the first try", () => {
  expect(o.REPORT_WINDOW_MS).toBe(24 * 3600_000)
  expect(o.freeze("p_1", payload, "k".repeat(22), t0).expiresAt).toBe(t0 + o.REPORT_WINDOW_MS)
})

it("a kept request comes back after a reload exactly as it was frozen", async () => {
  const r = o.freeze("p_1", payload, "k".repeat(22), t0)
  expect(await o.remember(r)).toBe("stored")
  await reload()
  expect(await o.pendingReport("p_1", t0 + 60_000)).toEqual({ report: r, complete: true })
})

it("a browser whose store refuses: the request is held in the page across a closed card, and after a reload the unread store is never read as empty", async () => {
  disk.mode = "broken"
  const r = o.freeze("p_1", payload, "a".repeat(22), t0)
  expect(await o.remember(r)).toBe("memory")
  // The card closed and opened again (no reload): still there, from the page's own copy.
  expect(await o.pendingReport("p_1", t0)).toEqual({ report: r, complete: false })
  await reload()
  expect(await o.pendingReport("p_1", t0)).toEqual({ report: null, complete: false })
})

it("a browser with no storage at all: held in the page, nothing is unread, and letting go leaves nothing behind", async () => {
  disk.mode = "none"
  const r = o.freeze("p_1", payload, "b".repeat(22), t0)
  expect(await o.remember(r)).toBe("memory")
  expect(await o.pendingReport("p_1", t0)).toEqual({ report: r, complete: true })
  expect(await o.forget(r.key)).toBe("cleared")
  expect(await o.pendingReport("p_1", t0)).toEqual({ report: null, complete: true })
})

it("letting go is key-scoped, and a removal the store refused is reported as failed, not as done", async () => {
  const one = o.freeze("p_1", payload, "c".repeat(22), t0)
  const two = o.freeze("p_2", { ...payload, placeId: "p_2" }, "d".repeat(22), t0)
  await o.remember(one)
  await o.remember(two)
  expect(await o.forget(one.key)).toBe("cleared")
  expect((await o.pendingReport("p_1", t0)).report).toBeNull()
  expect((await o.pendingReport("p_2", t0)).report).toEqual(two)
  disk.mode = "broken"
  expect(await o.forget(two.key)).toBe("failed")
  disk.mode = "ok"
  await reload()
  // The copy it couldn't remove is still there, within its window.
  expect((await o.pendingReport("p_2", t0)).report).toEqual(two)
})

it("past the window nothing is returned, from the page or the browser, and a start prunes the browser's copy", async () => {
  const r = o.freeze("p_1", payload, "e".repeat(22), t0)
  await o.remember(r)
  expect((await o.pendingReport("p_1", t0 + o.REPORT_WINDOW_MS - 1)).report).toEqual(r)
  expect((await o.pendingReport("p_1", t0 + o.REPORT_WINDOW_MS)).report).toBeNull()
  await o.remember(r)
  await reload()
  await o.pruneReports(t0 + o.REPORT_WINDOW_MS)
  expect(disk.keys.reportOutbox).toEqual({})
})

it("a view listing held requests hears every change", async () => {
  const seen: number[] = []
  const stop = o.subscribeReports(() => seen.push(o.reportsVersion()))
  const r = o.freeze("p_1", payload, "f".repeat(22), t0)
  await o.remember(r)
  await o.forget(r.key)
  stop()
  expect(seen).toEqual([1, 2])
})
