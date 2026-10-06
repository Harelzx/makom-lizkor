import { beforeEach, expect, it, vi } from "vitest"
import type { ReportSend } from "@/lib/api"
import type { ReportInput } from "@/shared/contract"

// IndexedDB stood in for, each change applied at once and in order (as idb-keyval's update does); `broken` refuses all.
const disk = vi.hoisted(() => ({ keys: {} as Record<string, unknown>, broken: false }))
const net = vi.hoisted(() => ({ sent: [] as { key: string; body: string }[], answers: [] as ReportSend[] }))
vi.mock("@/lib/storage", () => ({
  changeReportOutbox: async (fn: (v: never) => unknown) => {
    if (disk.broken) throw new Error("storage_unavailable")
    return (disk.keys.reportOutbox = fn((disk.keys.reportOutbox ?? {}) as never))
  },
}))
vi.mock("@/lib/api", () => ({
  sendReport: async (input: ReportInput, key: string) => {
    net.sent.push({ key, body: JSON.stringify(input) })
    return net.answers.shift() ?? { ok: false, kind: "unknown" }
  },
}))

const { REPORT_WINDOW_MS, attempt, forget, freeze, pendingReport, pruneReports, remember } = await import("@/lib/report-outbox")

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
  disk.broken = false
  net.sent = []
  net.answers = []
})

it("a request is kept, as sent, from before its first try; every try sends that same key and body", async () => {
  const r = freeze("p_1", payload, "k".repeat(22), t0)
  expect(await remember(r)).toBe(true)
  net.answers = [
    { ok: false, kind: "unknown" },
    { ok: true, ticket: "r_1", outcome: "received" },
  ]
  expect(await attempt(r, false)).toEqual({ view: "pending", reason: "unknown" })
  // After a reload: the same request comes back, untouched, and goes again unchanged.
  const back = (await pendingReport("p_1", t0 + 60_000))!
  expect(back).toEqual(r)
  expect(await attempt(back, true)).toEqual({ view: "result", outcome: "received" })
  expect(net.sent).toEqual([
    { key: r.key, body: JSON.stringify(payload) },
    { key: r.key, body: JSON.stringify(payload) },
  ])
  expect(await pendingReport("p_1", t0 + 120_000)).toBeNull()
})

it("a refusal before any write, on a first try: nothing was stored, so the request is let go and the form unlocks", async () => {
  const r = freeze("p_1", payload, "a".repeat(22), t0)
  await remember(r)
  net.answers = [{ ok: false, kind: "not_sent", code: "turnstile_failed" }]
  expect(await attempt(r, false)).toEqual({ view: "editable", code: "turnstile_failed" })
  expect(await pendingReport("p_1", t0)).toBeNull()
})

it("the same refusal after an earlier try whose fate is unknown says only that this try was refused: still kept, still locked", async () => {
  const r = freeze("p_1", payload, "b".repeat(22), t0)
  await remember(r)
  net.answers = [
    { ok: false, kind: "unknown" },
    { ok: false, kind: "not_sent", code: "rate_limited" },
  ]
  await attempt(r, false)
  expect(await attempt(r, true)).toEqual({ view: "pending", reason: "refused", code: "rate_limited" })
  expect(await pendingReport("p_1", t0)).toEqual(r)
})

it("a key the server holds with another request: this one's delivery is unconfirmed, and it stays kept", async () => {
  const r = freeze("p_1", payload, "c".repeat(22), t0)
  await remember(r)
  net.answers = [{ ok: false, kind: "conflict" }]
  expect(await attempt(r, false)).toEqual({ view: "pending", reason: "conflict" })
  expect(await pendingReport("p_1", t0)).toEqual(r)
})

it("an answer for one request clears only that one, never another place's", async () => {
  const one = freeze("p_1", payload, "d".repeat(22), t0)
  const two = freeze("p_2", { ...payload, placeId: "p_2" }, "e".repeat(22), t0)
  await remember(one)
  await remember(two)
  await forget(one.key)
  expect(await pendingReport("p_1", t0)).toBeNull()
  expect(await pendingReport("p_2", t0)).toEqual(two)
})

it("the window runs from the first try and isn't extended by later ones; past it the request is dropped, never returned or sent", async () => {
  const r = freeze("p_1", payload, "f".repeat(22), t0)
  await remember(r)
  net.answers = [{ ok: false, kind: "unknown" }]
  await attempt(r, false)
  expect(r.expiresAt).toBe(t0 + REPORT_WINDOW_MS)
  expect(await pendingReport("p_1", t0 + REPORT_WINDOW_MS - 1)).toEqual(r)
  await pruneReports(t0 + REPORT_WINDOW_MS)
  expect(disk.keys.reportOutbox).toEqual({})
  expect(await pendingReport("p_1", t0 + REPORT_WINDOW_MS)).toBeNull()
  expect(net.sent).toHaveLength(1)
})

it("a browser that keeps nothing: the request can still be tried in this page, and says it wasn't kept", async () => {
  disk.broken = true
  const r = freeze("p_1", payload, "g".repeat(22), t0)
  expect(await remember(r)).toBe(false)
  net.answers = [
    { ok: false, kind: "unknown" },
    { ok: true, ticket: "r_2", outcome: "hidden_for_review" },
  ]
  expect(await attempt(r, false)).toEqual({ view: "pending", reason: "unknown" })
  expect(await attempt(r, true)).toEqual({ view: "result", outcome: "hidden_for_review" })
  expect(await pendingReport("p_1", t0)).toBeNull()
})
