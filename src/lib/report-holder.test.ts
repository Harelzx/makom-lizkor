import { beforeEach, expect, it, vi } from "vitest"
import type { ReportSend } from "@/lib/api"
import type { ReportInput } from "@/shared/contract"

// The browser's store, with a way to hold one change back (`gate`) to see what happens while it waits.
const disk = vi.hoisted(() => ({
  keys: {} as Record<string, unknown>,
  broken: false,
  gate: null as Promise<void> | null,
}))
vi.mock("@/lib/storage", () => ({
  changeReportOutbox: async (fn: (v: never) => unknown) => {
    if (disk.gate) await disk.gate
    if (disk.broken) throw new Error("QuotaExceededError")
    return (disk.keys.reportOutbox = fn((disk.keys.reportOutbox ?? {}) as never))
  },
}))
// The network: each POST recorded by key and body; answers queued, or held back by a gate, or thrown.
const net = vi.hoisted(() => ({
  sent: [] as { key: string; body: string }[],
  answers: [] as (ReportSend | "throw")[],
  gate: null as Promise<void> | null,
}))
vi.mock("@/lib/api", () => ({
  sendReport: async (input: ReportInput, key: string) => {
    net.sent.push({ key, body: JSON.stringify(input) })
    if (net.gate) await net.gate
    const a = net.answers.shift() ?? { ok: false, kind: "unknown" }
    if (a === "throw") throw new TypeError("Cannot read properties of null")
    return a
  },
}))

const { attempt, createHolder } = await import("@/lib/report-holder")
const { freeze, pendingReport } = await import("@/lib/report-outbox")

const payload: ReportInput = {
  placeId: "p_1",
  elements: ["whole"],
  requesterType: "family",
  explanation: "המקום כולו מופיע בלי רשות המשפחה, נבקש להסתיר אותו בינתיים.",
  noticeVersion: "notice.report@2026-10-3",
}
const t0 = Date.UTC(2026, 9, 6, 9)
let n = 0
const fresh = () => freeze("p_1", payload, String(n++).padStart(22, "k"), t0)
const deferred = () => {
  let open!: () => void
  const p = new Promise<void>((r) => (open = r))
  return { p, open }
}

beforeEach(() => {
  disk.keys = {}
  disk.broken = false
  disk.gate = null
  net.sent = []
  net.answers = []
  net.gate = null
})

it("a refusal before any write, on a first try: let go, and the form is the visitor's again", async () => {
  const h = createHolder(() => t0)
  const r = fresh()
  net.answers = [{ ok: false, kind: "not_sent", code: "turnstile_failed" }]
  await h.start(r)
  expect(h.get()).toMatchObject({ kept: null, busy: false, shown: { view: "editable", code: "turnstile_failed", cleared: true } })
  expect((await pendingReport("p_1", t0)).report).toBeNull()
})

it("the same refusal after a try whose fate is unknown says only that this try was refused: still kept, still locked", async () => {
  const h = createHolder(() => t0)
  const r = fresh()
  net.answers = [
    { ok: false, kind: "unknown" },
    { ok: false, kind: "not_sent", code: "rate_limited" },
  ]
  await h.start(r)
  await h.resend()
  expect(h.get()).toMatchObject({ kept: r, uncertain: true, shown: { view: "pending", reason: "refused", code: "rate_limited" } })
  expect((await pendingReport("p_1", t0)).report).toEqual(r)
})

it("a key the server holds with another request: this one's delivery is unconfirmed, and it stays kept", async () => {
  const h = createHolder(() => t0)
  const r = fresh()
  net.answers = [{ ok: false, kind: "conflict" }]
  await h.start(r)
  expect(h.get()).toMatchObject({ kept: r, shown: { view: "pending", reason: "conflict" } })
})

it("a request found again goes as it was: the same key and body every time", async () => {
  const h = createHolder(() => t0)
  const r = fresh()
  h.restore(r)
  expect(h.get()).toMatchObject({ kept: r, uncertain: true, shown: { view: "restored" } })
  net.answers = [
    { ok: false, kind: "unknown" },
    { ok: true, ticket: "r_1", outcome: "hidden_for_review" },
  ]
  await h.resend()
  await h.resend()
  expect(h.get()).toMatchObject({ kept: null, shown: { view: "result", outcome: "hidden_for_review", cleared: true } })
  expect(net.sent).toEqual([
    { key: r.key, body: JSON.stringify(payload) },
    { key: r.key, body: JSON.stringify(payload) },
  ])
})

it("a removal still waiting on the browser holds the request: a resend asked for meanwhile is refused, and nothing comes back after", async () => {
  const h = createHolder(() => t0)
  const r = fresh()
  await h.start(r)
  expect(net.sent).toHaveLength(1)
  const slow = deferred()
  disk.gate = slow.p
  const removing = h.discard()
  expect(await h.resend()).toBe(false)
  expect(net.sent).toHaveLength(1)
  slow.open()
  await removing
  disk.gate = null
  expect(h.get()).toMatchObject({ kept: null, busy: false, shown: { view: "discarded", cleared: true } })
  expect(await h.resend()).toBe(true)
  expect(net.sent).toHaveLength(1)
})

it("a removal asked for while a try is out is refused; the try's unknown answer leaves the request kept", async () => {
  const h = createHolder(() => t0)
  const r = fresh()
  const slow = deferred()
  net.gate = slow.p
  const sending = h.start(r)
  await vi.waitFor(() => expect(net.sent).toHaveLength(1))
  expect(await h.discard()).toBe(false)
  slow.open()
  await sending
  expect(h.get()).toMatchObject({ kept: r, busy: false, shown: { view: "pending", reason: "unknown" } })
  expect((await pendingReport("p_1", t0)).report).toEqual(r)
})

it("a try that throws still frees the form, and the request stays kept for another try", async () => {
  const h = createHolder(() => t0)
  const r = fresh()
  net.answers = ["throw"]
  await expect(h.start(r)).rejects.toThrow()
  expect(h.get()).toMatchObject({ kept: r, busy: false })
  net.answers = [{ ok: true, ticket: "r_2", outcome: "received" }]
  await h.resend()
  expect(h.get().shown).toMatchObject({ view: "result", outcome: "received" })
  expect(net.sent.map((s) => s.key)).toEqual([r.key, r.key])
})

it("past the deadline nothing is sent: a try lets it go unsent, and an open form lets it go on time", async () => {
  const r = fresh()
  disk.keys.reportOutbox = { [r.key]: r }
  expect(await attempt(r, true, r.expiresAt)).toEqual({ view: "expired", cleared: true })
  expect(net.sent).toHaveLength(0)

  let now = t0
  const h = createHolder(() => now)
  const s = fresh()
  h.restore(s)
  await h.expire()
  expect(h.get().kept).toEqual(s)
  now = s.expiresAt
  await h.expire()
  expect(h.get()).toMatchObject({ kept: null, uncertain: false, shown: { view: "expired", cleared: true } })
  expect(net.sent).toHaveLength(0)
})

it("an answer that settles the request but whose copy couldn't be removed says so", async () => {
  const h = createHolder(() => t0)
  const r = fresh()
  await h.start(r)
  disk.broken = true
  net.answers = [{ ok: true, ticket: "r_3", outcome: "received" }]
  await h.resend()
  expect(h.get()).toMatchObject({ kept: null, shown: { view: "result", cleared: false } })
})

it("a removal the browser refused keeps the request held, so it can be asked for again", async () => {
  const h = createHolder(() => t0)
  const r = fresh()
  await h.start(r)
  disk.broken = true
  await h.discard()
  expect(h.get()).toMatchObject({ kept: r, shown: { view: "discarded", cleared: false } })
  disk.broken = false
  await h.discard()
  expect(h.get()).toMatchObject({ kept: null, shown: { view: "discarded", cleared: true } })
})
