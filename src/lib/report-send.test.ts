import { afterEach, expect, it, vi } from "vitest"
import type { ReportInput } from "@/shared/contract"

vi.mock("@/lib/turnstile", () => ({ turnstileToken: async () => "XXXX.DUMMY.TOKEN.XXXX" }))
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
