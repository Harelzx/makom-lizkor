import { env } from "cloudflare:workers"
import { createExecutionContext } from "cloudflare:test"
import { describe, expect, it, vi } from "vitest"
import { createApp } from "../index"
import { sendMail } from "../lib/mail"

const body = { email: "visitor@example.test", message: "פניית בדיקה בלבד" }
const provider = vi.fn(async (mail: EmailMessageBuilder) => {
  void mail
  return { messageId: "test-only" }
})
const ready = {
  ...env,
  ENVIRONMENT: "production",
  // This suite exercises the Cloudflare binding explicitly; production now selects Gmail in its configuration.
  MAIL_PROVIDER: "cloudflare",
  PUBLIC_ORIGIN: "https://project.test",
  MAIL_FROM: "contact@makom-unit.org",
  MAIL: { send: provider },
} as Env & { MAIL: SendEmail; MAIL_FROM: string }
const app = createApp({
  sendMail,
  purge: async () => true,
  verifyTurnstile: async (_secret, token) => ({ success: token === "pass-contact", action: "contact", hostname: "example.com" }),
})
const post = (options: { e?: Env; headers?: Record<string, string>; body?: unknown } = {}) =>
  app.fetch(
    new Request("https://project.test/api/v1/contact", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://project.test",
        "Sec-Fetch-Site": "same-origin",
        "Turnstile-Token": "pass-contact",
        ...options.headers,
      },
      body: JSON.stringify(options.body ?? body),
    }),
    options.e ?? ready,
    createExecutionContext(),
  )

describe("bounded contact mail, without a database copy", () => {
  it("reports provider acceptance and always sends to the project, never the visitor", async () => {
    provider.mockClear()
    const r = await post()
    expect(r.status).toBe(202)
    expect(await r.json()).toEqual({ accepted: true })
    expect(provider).toHaveBeenCalledTimes(1)
    expect(provider.mock.calls[0][0]).toMatchObject({
      to: "makomlizkor@gmail.com",
      from: { email: "contact@makom-unit.org", name: "מקום לזכור" },
      subject: "פנייה ממקום לזכור",
    })
    expect(provider.mock.calls[0][0].text).toContain(body.email)
    // The same message as a page beside the text: right to left, the visitor's words escaped.
    expect(provider.mock.calls[0][0].html).toMatch(/dir="rtl"/)
    expect(r.headers.get("Cache-Control")).toBe("private, no-store")
  })
  it("refuses extra recipient fields and header injection", async () => {
    expect((await post({ body: { ...body, to: "other@example.test" } })).status).toBe(400)
    expect((await post({ body: { ...body, email: "visitor@example.test\r\nBcc: other@example.test" } })).status).toBe(400)
  })
  it("refuses cross-site, absent and mismatched origins", async () => {
    provider.mockClear()
    for (const origin of ["", "https://evil.test"]) expect((await post({ headers: { Origin: origin } })).status).toBe(403)
    expect((await post({ headers: { "Sec-Fetch-Site": "cross-site" } })).status).toBe(403)
    expect(provider).not.toHaveBeenCalled()
  })
  it("refuses a failed browser check before sending", async () => {
    provider.mockClear()
    expect((await post({ headers: { "Turnstile-Token": "fail" } })).status).toBe(403)
    expect(provider).not.toHaveBeenCalled()
  })
  it("does not offer sending before its required mail and bot settings exist", async () => {
    for (const field of ["MAIL", "MAIL_FROM", "PUBLIC_ORIGIN", "TRACKING_SECRET", "TURNSTILE_SECRET", "TURNSTILE_HOSTNAMES"] as const) {
      const e = { ...ready, [field]: undefined } as unknown as Env
      const r = await app.fetch(new Request("https://project.test/api/v1/contact"), e, createExecutionContext())
      expect(await r.json()).toEqual({ enabled: false })
    }
  })
  it("keeps staging and development mail off even with production-looking bindings", async () => {
    provider.mockClear()
    for (const environment of ["staging", "development"] as const) {
      const e = { ...ready, ENVIRONMENT: environment }
      const r = await app.fetch(new Request("https://project.test/api/v1/contact"), e, createExecutionContext())
      expect(await r.json()).toEqual({ enabled: false })
      expect((await post({ e })).status).toBe(503)
    }
    expect(provider).not.toHaveBeenCalled()
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM dev_outbox").first<number>("n")).toBe(0)
  })
  it("does not claim success when the provider refuses or throws", async () => {
    provider.mockRejectedValueOnce(new Error("test refusal"))
    expect((await post()).status).toBe(503)
    provider.mockResolvedValueOnce({ messageId: "" })
    expect((await post()).status).toBe(503)
  })
  it("enforces the existing rate ceiling before contacting the provider", async () => {
    provider.mockClear()
    const limit = vi.fn(async (input: { key: string }) => {
      void input
      return { success: false }
    })
    const e = { ...ready, REPORT_LIMIT: { limit } } as unknown as Env
    const r = await post({ e, headers: { "CF-Connecting-IP": "192.0.2.10" } })
    expect(r.status).toBe(429)
    expect(r.headers.get("Retry-After")).toBe("60")
    expect(provider).not.toHaveBeenCalled()
    expect(limit.mock.calls[0][0].key).not.toContain("192.0.2.10")
  })
  it("limits the request bytes as well as message length", async () => {
    expect((await post({ body: { ...body, message: "x".repeat(2001) } })).status).toBe(400)
    expect((await post({ body: { ...body, message: "x".repeat(13_000) } })).status).toBe(413)
  })
})
