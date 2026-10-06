import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { ReportSend } from "@/lib/api"
import type { ReportInput } from "@/shared/contract"

// The browser's store, with a way to hold changes back (`gate`) to see what happens while they wait.
const disk = vi.hoisted(() => ({ keys: {} as Record<string, unknown>, broken: false, gate: null as Promise<void> | null }))
vi.mock("@/lib/storage", () => ({
  changeReportOutbox: async (fn: (v: never) => unknown) => {
    if (disk.gate) await disk.gate
    if (disk.broken) throw new Error("QuotaExceededError")
    return (disk.keys.reportOutbox = fn((disk.keys.reportOutbox ?? {}) as never))
  },
}))
// The network: each POST recorded by key and body; answers queued, held back by a gate, or thrown.
const net = vi.hoisted(() => ({
  sent: [] as { key: string; body: string; deadline?: number }[],
  answers: [] as (ReportSend | "throw")[],
  gate: null as Promise<void> | null,
}))
vi.mock("@/lib/api", () => ({
  sendReport: async (input: ReportInput, key: string, deadline?: number) => {
    net.sent.push({ key, body: JSON.stringify(input), deadline })
    if (net.gate) await net.gate
    const a = net.answers.shift() ?? { ok: false, kind: "unknown" }
    if (a === "throw") throw new TypeError("Cannot read properties of null")
    return a
  },
}))

// A fresh module is a reload: the page's requests go, the browser's copy stays.
let h: typeof import("@/lib/report-holder")
let o: typeof import("@/lib/report-outbox")
const reload = async () => {
  vi.resetModules()
  h = await import("@/lib/report-holder")
  o = await import("@/lib/report-outbox")
}

const payload: ReportInput = {
  placeId: "p_1",
  elements: ["whole"],
  requesterType: "family",
  relationship: "אח",
  explanation: "המקום כולו מופיע בלי רשות המשפחה, נבקש להסתיר אותו בינתיים.",
  noticeVersion: "notice.report@2026-10-3",
}
const t0 = Date.UTC(2026, 9, 6, 9)
let n = 0
const fresh = () => o.freeze("p_1", payload, String(n++).padStart(22, "k"), Date.now())
const deferred = () => {
  let open!: () => void
  const p = new Promise<void>((r) => (open = r))
  return { p, open }
}
const stored = () => Object.keys((disk.keys.reportOutbox ?? {}) as object)

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })
  vi.setSystemTime(t0)
  disk.keys = {}
  disk.broken = false
  disk.gate = null
  net.sent = []
  net.answers = []
  net.gate = null
  await reload()
})
afterEach(() => void vi.useRealTimers())

it("a refusal before any write, on a first try: let go, and the form is the visitor's again", async () => {
  const r = fresh()
  net.answers = [{ ok: false, kind: "not_sent", code: "turnstile_failed" }]
  await h.start(r)
  expect(h.entry(r.key)).toMatchObject({ r: null, busy: false, shown: { view: "editable", code: "turnstile_failed", cleared: true } })
  expect(stored()).toEqual([])
})

it("the same refusal after a try whose fate is unknown says only that this try was refused: still kept, still locked", async () => {
  const r = fresh()
  net.answers = [
    { ok: false, kind: "unknown" },
    { ok: false, kind: "not_sent", code: "rate_limited" },
  ]
  await h.start(r)
  await h.resend(r.key)
  expect(h.entry(r.key)).toMatchObject({ r, uncertain: true, shown: { view: "pending", reason: "refused", code: "rate_limited" } })
  expect(stored()).toEqual([r.key])
})

it("a key the server holds with another request: this one's delivery is unconfirmed, and it stays kept", async () => {
  const r = fresh()
  net.answers = [{ ok: false, kind: "conflict" }]
  await h.start(r)
  expect(h.entry(r.key)).toMatchObject({ r, shown: { view: "pending", reason: "conflict" } })
})

it("after a reload the request is found again and goes as it was, every time, with its deadline", async () => {
  const r = fresh()
  await h.start(r)
  await reload()
  await h.hydrate()
  expect(h.heldFor("p_1")).toMatchObject({ key: r.key, r, uncertain: true, shown: { view: "restored" } })
  net.answers = [{ ok: true, ticket: "r_1", outcome: "hidden_for_review" }]
  await h.resend(r.key)
  expect(h.entry(r.key)).toMatchObject({ r: null, shown: { view: "result", outcome: "hidden_for_review", cleared: true } })
  expect(net.sent).toEqual([
    { key: r.key, body: JSON.stringify(payload), deadline: r.expiresAt },
    { key: r.key, body: JSON.stringify(payload), deadline: r.expiresAt },
  ])
  expect(h.heldFor("p_1")).toBeUndefined()
})

it("a card closed and opened while its try is out finds the same request, busy: no removal or resend from it, and the try's answer reaches it", async () => {
  const r = fresh()
  const slow = deferred()
  net.gate = slow.p
  const sending = h.start(r)
  await vi.waitFor(() => expect(net.sent).toHaveLength(1))
  // The card that sent it is gone; a new one (or the list of places not shown) looks the place up.
  const again = h.heldFor("p_1")!
  expect(again).toMatchObject({ key: r.key, busy: true })
  expect(await h.discard(again.key)).toBe(false)
  expect(await h.resend(again.key)).toBe(false)
  expect(net.sent).toHaveLength(1)
  slow.open()
  await sending
  expect(h.heldFor("p_1")).toMatchObject({ key: r.key, r, busy: false, shown: { view: "pending", reason: "unknown" } })
  expect(stored()).toEqual([r.key])
})

it("a removal still waiting on the browser holds the request for every view; once done, nothing revives it", async () => {
  const r = fresh()
  await h.start(r)
  const slow = deferred()
  disk.gate = slow.p
  const removing = h.discard(r.key)
  expect(h.heldFor("p_1")).toMatchObject({ key: r.key, busy: true })
  expect(await h.resend(r.key)).toBe(false)
  slow.open()
  await removing
  disk.gate = null
  expect(h.entry(r.key)).toMatchObject({ r: null, busy: false, shown: { view: "discarded", cleared: true } })
  expect(h.heldFor("p_1")).toBeUndefined()
  expect(await h.resend(r.key)).toBe(true)
  expect(net.sent).toHaveLength(1)
  await h.hydrate()
  expect(h.heldFor("p_1")).toBeUndefined()
})

it("a removal the store refused keeps the request, whole, for the page: a card closed and opened finds it with the same key and body", async () => {
  const r = fresh()
  await h.start(r)
  disk.broken = true
  await h.discard(r.key)
  expect(h.entry(r.key)).toMatchObject({ r, shown: { view: "discarded", cleared: false } })
  expect(h.heldFor("p_1")?.r).toEqual(r)
  disk.broken = false
  await h.discard(r.key)
  expect(h.entry(r.key)).toMatchObject({ r: null, shown: { view: "discarded", cleared: true } })
})

it("a request read from the browser stays held by the page when the store then fails", async () => {
  const r = fresh()
  await o.remember(r)
  await h.hydrate()
  disk.broken = true
  expect(h.heldFor("p_1")?.r).toEqual(r)
})

it("a store that couldn't be read is said so, and a later read that works brings the request back as it was", async () => {
  const r = fresh()
  await o.remember(r)
  await reload()
  disk.broken = true
  await h.hydrate()
  expect(h.readFailed()).toBe(true)
  expect(h.heldFor("p_1")).toBeUndefined()
  disk.broken = false
  await h.hydrate()
  expect(h.readFailed()).toBe(false)
  expect(h.heldFor("p_1")?.r).toEqual(r)
})

it("a try that throws frees the request, says it is unconfirmed, and keeps it", async () => {
  const r = fresh()
  net.answers = ["throw"]
  await h.start(r)
  expect(h.entry(r.key)).toMatchObject({ r, busy: false, uncertain: true, shown: { view: "pending", reason: "unknown" } })
})

it("the page lets a request go at its deadline with no view open, unsent, and its content goes with it", async () => {
  const r = fresh()
  await h.start(r)
  await vi.advanceTimersByTimeAsync(r.expiresAt - Date.now() - 1)
  expect(h.entry(r.key)?.r).toEqual(r)
  await vi.advanceTimersByTimeAsync(1)
  await vi.waitFor(() => expect(h.entry(r.key)).toMatchObject({ r: null, uncertain: false, shown: { view: "expired", cleared: true } }))
  expect(stored()).toEqual([])
  expect(net.sent).toHaveLength(1)
})

it("a deadline passed while a try was out is kept as soon as that try ends", async () => {
  const r = fresh()
  const slow = deferred()
  net.gate = slow.p
  const sending = h.start(r)
  await vi.waitFor(() => expect(net.sent).toHaveLength(1))
  vi.setSystemTime(r.expiresAt + 1)
  slow.open()
  await sending
  await vi.advanceTimersByTimeAsync(0)
  await vi.waitFor(() => expect(h.entry(r.key)).toMatchObject({ r: null, shown: { view: "expired" } }))
})

it("a try past the deadline sends nothing", async () => {
  const r = fresh()
  disk.keys.reportOutbox = { [r.key]: r }
  expect(await h.attempt(r, true, r.expiresAt)).toEqual({ view: "expired", cleared: true })
  expect(net.sent).toHaveLength(0)
  net.answers = [{ ok: false, kind: "expired" }]
  expect(await h.attempt(r, true, r.expiresAt - 1)).toEqual({ view: "expired", cleared: true })
})

it("an answer whose copy couldn't be removed lets the content go, never offers it again (even once its view is closed), and keeps trying to remove the copy", async () => {
  const a = fresh()
  await h.start(a)
  disk.broken = true
  net.answers = [{ ok: true, ticket: "r_2", outcome: "received" }]
  await h.resend(a.key)
  expect(h.entry(a.key)).toMatchObject({ r: null, shown: { view: "result", cleared: false } })
  h.dismiss(a.key)
  disk.broken = false
  // Still within its window, and still in the browser: read again, it must not come back as a request to send.
  await h.hydrate()
  expect(h.heldFor("p_1")).toBeUndefined()
  expect(stored()).toEqual([a.key])
  await h.check()
  expect(stored()).toEqual([])
})

it("an expiry whose copy couldn't be removed still lets the content go, and the copy is removed once the browser allows", async () => {
  const b = fresh()
  await h.start(b)
  disk.broken = true
  vi.setSystemTime(b.expiresAt)
  await h.expire(b.key)
  expect(h.entry(b.key)).toMatchObject({ r: null, shown: { view: "expired", cleared: false } })
  disk.broken = false
  await h.check()
  expect(stored()).toEqual([])
})

it("a closed answer is dismissed from the page; a held request can't be", async () => {
  const r = fresh()
  await h.start(r)
  h.dismiss(r.key)
  expect(h.entry(r.key)).toBeDefined()
  net.answers = [{ ok: true, ticket: "r_3", outcome: "received" }]
  await h.resend(r.key)
  h.dismiss(r.key)
  expect(h.entry(r.key)).toBeUndefined()
})

it("a first refusal whose copy couldn't be removed keeps that request, whole, in place of any new one; after a reload it is the one found", async () => {
  const k1 = fresh()
  const slow = deferred()
  net.gate = slow.p
  net.answers = [{ ok: false, kind: "not_sent", code: "turnstile_failed" }]
  const sending = h.start(k1)
  await vi.waitFor(() => expect(net.sent).toHaveLength(1))
  disk.broken = true
  slow.open()
  await sending
  net.gate = null
  expect(h.entry(k1.key)).toMatchObject({ r: k1, shown: { view: "editable", code: "turnstile_failed", cleared: false } })
  expect(await h.start(fresh())).toBe(false)
  expect(net.sent).toHaveLength(1)
  disk.broken = false
  await reload()
  await h.hydrate()
  expect(h.heldFor("p_1")?.key).toBe(k1.key)
})

it("a settled request stays the place's latest, with its answer and without its content, until a view closes it", async () => {
  const r = fresh()
  net.answers = [{ ok: true, ticket: "r_4", outcome: "received" }]
  await h.start(r)
  expect(h.latestFor("p_1")).toMatchObject({ key: r.key, r: null, shown: { view: "result", outcome: "received" } })
  h.dismiss(r.key)
  expect(h.latestFor("p_1")).toBeUndefined()
})

it("a deadline that comes while a try waits (on the bot check or the network) lets the request go at once; that try's answer is kept only as what happened", async () => {
  const r = fresh()
  const slow = deferred()
  net.gate = slow.p
  net.answers = [{ ok: true, ticket: "r_5", outcome: "received" }]
  const sending = h.start(r)
  await vi.waitFor(() => expect(net.sent).toHaveLength(1))
  await vi.advanceTimersByTimeAsync(r.expiresAt - Date.now())
  expect(h.entry(r.key)).toMatchObject({ r: null, busy: true, shown: { view: "expired" } })
  expect(h.heldFor("p_1")).toBeUndefined()
  slow.open()
  await sending
  expect(h.entry(r.key)).toMatchObject({ r: null, busy: false, shown: { view: "result", outcome: "received" } })
})

it("an unanswered try past the deadline leaves the request let go, not revived", async () => {
  const r = fresh()
  const slow = deferred()
  net.gate = slow.p
  const sending = h.start(r)
  await vi.waitFor(() => expect(net.sent).toHaveLength(1))
  await vi.advanceTimersByTimeAsync(r.expiresAt - Date.now())
  slow.open()
  await sending
  expect(h.entry(r.key)).toMatchObject({ r: null, shown: { view: "expired" } })
})

it("an expiry whose removal from the browser is slow lets the content go at once and says so only once it is done", async () => {
  const r = fresh()
  await h.start(r)
  const slow = deferred()
  disk.gate = slow.p
  vi.setSystemTime(r.expiresAt)
  const expiring = h.expire(r.key)
  expect(h.entry(r.key)).toMatchObject({ r: null, shown: { view: "expired" } })
  expect((h.entry(r.key)!.shown as { cleared?: boolean }).cleared).toBeUndefined()
  slow.open()
  await expiring
  disk.gate = null
  expect(h.entry(r.key)).toMatchObject({ shown: { view: "expired", cleared: true } })
})

it("a removal held up at one deadline never holds up the next: each request goes at its own deadline", async () => {
  const a = fresh()
  await h.start(a)
  vi.advanceTimersByTime(1000)
  const b = o.freeze("p_2", { ...payload, placeId: "p_2" }, "second".padStart(22, "b"), Date.now())
  await h.start(b)
  const slow = deferred()
  disk.gate = slow.p
  await vi.advanceTimersByTimeAsync(a.expiresAt - Date.now())
  expect(h.entry(a.key)).toMatchObject({ r: null, shown: { view: "expired" } })
  expect(h.entry(b.key)?.r).toEqual(b)
  await vi.advanceTimersByTimeAsync(b.expiresAt - Date.now())
  expect(h.entry(b.key)).toMatchObject({ r: null, shown: { view: "expired" } })
  slow.open()
  disk.gate = null
  await vi.waitFor(() => expect(h.entry(b.key)).toMatchObject({ shown: { view: "expired", cleared: true } }))
  expect(stored()).toEqual([])
  expect(net.sent).toHaveLength(2)
})

it("coming back to a page with several deadlines passed lets them all go at once, before any removal is done", async () => {
  const a = fresh()
  const b = o.freeze("p_2", { ...payload, placeId: "p_2" }, "second".padStart(22, "c"), Date.now())
  await h.start(a)
  await h.start(b)
  const slow = deferred()
  disk.gate = slow.p
  vi.setSystemTime(b.expiresAt + 3600_000)
  const checking = h.check()
  expect(h.entry(a.key)).toMatchObject({ r: null, shown: { view: "expired" } })
  expect(h.entry(b.key)).toMatchObject({ r: null, shown: { view: "expired" } })
  slow.open()
  await checking
  disk.gate = null
  expect(stored()).toEqual([])
})
