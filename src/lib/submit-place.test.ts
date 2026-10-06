import { afterEach, expect, it, vi } from "vitest"

vi.mock("@/lib/turnstile", () => ({ turnstileToken: async () => "token" }))
const { submitPlace } = await import("@/lib/api")

const answer = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status, headers }))
afterEach(() => vi.unstubAllGlobals())
const input = { kind: "bench", name_he: "ספסל דמו", lat: 31.4, lng: 34.5, consent_version: "x" } as never

it("a failed bot check waits ten minutes before the next try, rather than a challenge every wake", async () => {
  answer(403, { code: "turnstile_failed" })
  expect(await submitPlace(input, "k")).toMatchObject({ ok: false, kind: "temporary", code: "turnstile_failed", retryAfter: 600 })
})

it("the server's own wait wins, and a dropped connection waits for the next wake", async () => {
  answer(429, { code: "rate_limited" }, { "Retry-After": "30" })
  expect(await submitPlace(input, "k")).toMatchObject({ retryAfter: 30 })
  vi.stubGlobal("fetch", async () => {
    throw new TypeError("offline")
  })
  expect((await submitPlace(input, "k")) as object).not.toHaveProperty("retryAfter")
})
