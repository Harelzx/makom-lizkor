import { afterEach, expect, it, vi } from "vitest"
import type { ReportInput } from "@/shared/contract"

// The bot check answers at once, unless a test holds it back.
const bot = vi.hoisted(() => ({ wait: null as Promise<string | null> | null }))
vi.mock("@/lib/turnstile", () => ({ turnstileToken: async () => bot.wait ?? "XXXX.DUMMY.TOKEN.XXXX" }))
const { sendReport } = await import("@/lib/api")

const input: ReportInput = {
  placeId: "p_1",
  elements: ["name_he"],
  requesterType: "other",
  explanation: "יש כאן טעות בשם, כדאי לבדוק.",
  noticeVersion: "notice.report@2026-10-3",
}
const answer = (status: number, body: string) => vi.stubGlobal("fetch", async () => new Response(body, { status }))

afterEach(() => void vi.unstubAllGlobals())

it("only a recognised acknowledgement settles a request; any other 202 body is unknown", async () => {
  answer(202, JSON.stringify({ ticket: "r_1", outcome: "received" }))
  expect(await sendReport(input, "k".repeat(22))).toEqual({ ok: true, ticket: "r_1", outcome: "received" })
  for (const body of [
    "null",
    "[]",
    '"ok"',
    JSON.stringify({ ticket: "r_1", outcome: "approved" }),
    JSON.stringify({ outcome: "received" }),
    "<html>",
  ]) {
    answer(202, body)
    expect(await sendReport(input, "k".repeat(22)), body).toEqual({ ok: false, kind: "unknown" })
  }
})

it("an error body of any shape never throws: unrecognised is unknown, and only a listed refusal is read as one", async () => {
  for (const [status, body] of [
    [409, "null"],
    [400, '"invalid_input"'],
    [400, "[]"],
    [403, JSON.stringify({ code: 7 })],
    [500, "null"],
    [502, "<html>bad gateway</html>"],
    [404, JSON.stringify({ code: "rate_limited" })],
  ] as const) {
    answer(status, body)
    expect(await sendReport(input, "k".repeat(22)), `${status} ${body}`).toEqual({ ok: false, kind: "unknown" })
  }
  answer(400, JSON.stringify({ code: "invalid_input" }))
  expect(await sendReport(input, "k".repeat(22))).toEqual({ ok: false, kind: "not_sent", code: "invalid_input" })
  answer(409, JSON.stringify({ code: "idempotency_key_reused" }))
  expect(await sendReport(input, "k".repeat(22))).toEqual({ ok: false, kind: "conflict" })
})

it("a try whose window ends while the browser check runs is not sent at all", async () => {
  let posts = 0
  vi.stubGlobal("fetch", async () => (posts++, new Response(JSON.stringify({ ticket: "r_1", outcome: "received" }), { status: 202 })))
  expect(await sendReport(input, "k".repeat(22), Date.now() - 1)).toEqual({ ok: false, kind: "expired" })
  expect(posts).toBe(0)
  expect(await sendReport(input, "k".repeat(22), Date.now() + 60_000)).toMatchObject({ ok: true })
  expect(posts).toBe(1)
})

it("a window that ends while the bot check is still loading: nothing is sent, even when the check answers after", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout"] })
  try {
    let posts = 0
    vi.stubGlobal("fetch", async () => (posts++, new Response("{}", { status: 202 })))
    let answer!: (t: string) => void
    bot.wait = new Promise((r) => (answer = r))
    const sending = sendReport(input, "k".repeat(22), Date.now() + 1000)
    await vi.advanceTimersByTimeAsync(2000)
    answer("XXXX.DUMMY.TOKEN.XXXX")
    expect(await sending).toEqual({ ok: false, kind: "expired" })
    expect(posts).toBe(0)
  } finally {
    bot.wait = null
    vi.useRealTimers()
  }
})

it("a bot check that never finishes loading doesn't hold a try forever: after its bound the request goes without a token", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout"] })
  try {
    const sent: (string | null)[] = []
    vi.stubGlobal("fetch", async (_: string, init: RequestInit) => {
      sent.push(new Headers(init.headers).get("Turnstile-Token"))
      return new Response(JSON.stringify({ code: "turnstile_required" }), { status: 403 })
    })
    bot.wait = new Promise(() => {})
    const sending = sendReport(input, "k".repeat(22), Date.now() + 3600_000)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await sending).toEqual({ ok: false, kind: "not_sent", code: "turnstile_required" })
    expect(sent).toEqual([null])
  } finally {
    bot.wait = null
    vi.useRealTimers()
  }
})
