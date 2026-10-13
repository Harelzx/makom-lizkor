import { env } from "cloudflare:workers"
import { createExecutionContext } from "cloudflare:test"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp } from "../index"
import { contactMailReady, sendMail } from "../lib/mail"
import { GMAIL_SCOPE, gmailRaw, gmailReady, gmailSend, gmailAttempt } from "../lib/gmail"
import { logLineProblems } from "../lib/log"

const settings = {
  MAIL_FROM: "synthetic.project@gmail.com",
  GMAIL_ACCOUNT: "synthetic.project@gmail.com",
  GMAIL_CLIENT_ID: "synthetic-client",
  GMAIL_CLIENT_SECRET: "synthetic-secret",
  GMAIL_REFRESH_TOKEN: "synthetic-refresh",
  GMAIL_OAUTH_STATUS: "production",
}
const ready = { ...env, ...settings, ENVIRONMENT: "production", MAIL_PROVIDER: "gmail", PUBLIC_ORIGIN: "https://project.test" }
const message = { to: "recipient@unit.org", subject: "פניית בדיקה", text: "בדיקה סינתטית בלבד\nשורה שנייה" }
const token = { access_token: "synthetic-access", token_type: "Bearer", scope: GMAIL_SCOPE }
const json = (data: unknown, status = 200) => Response.json(data, { status })
const from64 = (data: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(data.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)))
const request = () =>
  vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json(token))
    .mockResolvedValueOnce(json({ id: "synthetic-receipt" }))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("Gmail send-only transport, without live Google requests", () => {
  it("distinguishes safe pre-send retries from uncertain provider acknowledgement without a blind resend", async () => {
    expect(await gmailAttempt(settings, message, vi.fn<typeof fetch>().mockRejectedValue(new Error("token network")))).toBe("retryable")
    for (const status of [503, 302, 200]) {
      const fake = vi.fn<typeof fetch>().mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json({}, status))
      expect(await gmailAttempt(settings, message, fake)).toBe("uncertain")
      expect(fake).toHaveBeenCalledTimes(2)
    }
    const limited = vi.fn<typeof fetch>().mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json({}, 429))
    expect(await gmailAttempt(settings, message, limited)).toBe("retryable")
  })
  it("refreshes once and sends one exact UTF-8 MIME message; only an id is acceptance", async () => {
    const fake = request()
    expect(await gmailSend(settings, message, fake)).toBe(true)
    expect(fake).toHaveBeenCalledTimes(2)
    const [url, refresh] = fake.mock.calls[0]
    expect(url).toBe("https://oauth2.googleapis.com/token")
    expect(new URLSearchParams(refresh?.body as URLSearchParams).get("refresh_token")).toBe("synthetic-refresh")
    expect(refresh?.redirect).toBe("manual")
    const [endpoint, send] = fake.mock.calls[1]
    expect(endpoint).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send")
    expect(send?.redirect).toBe("manual")
    expect(send?.headers).toEqual({ Authorization: "Bearer synthetic-access", "Content-Type": "application/json" })
    const mime = from64(JSON.parse(send?.body as string).raw)
    expect(mime).toContain(`From: ${settings.MAIL_FROM}\r\nTo: ${message.to}\r\n`)
    expect(from64(mime.split("\r\n\r\n")[1].replace(/\s/g, ""))).toBe(message.text.replace(/\n/g, "\r\n"))
    expect(mime).not.toContain("synthetic-refresh")
  })

  it("folds a long Hebrew subject without splitting characters or overflowing encoded words", () => {
    const subject = "זיכרון 🌺 ".repeat(35)
    const mime = from64(gmailRaw(settings.MAIL_FROM, { ...message, subject })!)
    const words = [...mime.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)]
    expect(words.length).toBeGreaterThan(1)
    expect(words.map((w) => from64(w[1])).join("")).toBe(subject)
    expect(words.every((w) => w[0].length <= 75)).toBe(true)
  })

  it("refuses header injection and an oversized body before refreshing credentials", async () => {
    const fake = request()
    for (const mail of [
      { ...message, to: "recipient@unit.org\r\nBcc: other@unit.org" },
      { ...message, subject: "Hello\nBcc: other@unit.org" },
      { ...message, subject: "" },
      { ...message, text: "א".repeat(32_001) },
    ])
      expect(await gmailSend(settings, mail, fake)).toBe(false)
    expect(fake).not.toHaveBeenCalled()
  })

  it("does not offer contact sending with missing credentials or a different Gmail sender", async () => {
    const fake = request()
    for (const field of [
      "GMAIL_ACCOUNT",
      "GMAIL_CLIENT_ID",
      "GMAIL_CLIENT_SECRET",
      "GMAIL_REFRESH_TOKEN",
      "GMAIL_OAUTH_STATUS",
      "MAIL_FROM",
    ] as const) {
      const e = { ...ready, [field]: "" }
      expect(gmailReady(e)).toBe(false)
      expect(contactMailReady(e)).toBe(false)
      expect(await gmailSend(e, message, fake)).toBe(false)
    }
    expect(gmailReady({ ...settings, MAIL_FROM: "other@gmail.com" })).toBe(false)
    expect(gmailReady({ ...settings, MAIL_FROM: "sender@domain.org", GMAIL_ACCOUNT: "sender@domain.org" })).toBe(false)
    expect(gmailReady({ ...settings, GMAIL_OAUTH_STATUS: "testing" })).toBe(false)
    expect(fake).not.toHaveBeenCalled()
  })

  it.each([
    [400, { error: "invalid_grant" }],
    [200, {}],
    [200, { ...token, access_token: " " }],
    [200, { ...token, token_type: "invalid" }],
    [200, { ...token, scope: `${GMAIL_SCOPE} https://mail.google.com/` }],
  ])("token failure %s never reaches the send endpoint", async (status, data) => {
    const fake = vi.fn<typeof fetch>().mockResolvedValue(json(data, status))
    expect(await gmailSend(settings, message, fake)).toBe(false)
    expect(fake).toHaveBeenCalledTimes(1)
  })

  it.each([
    [429, {}],
    [503, {}],
    [200, {}],
    [200, { id: " " }],
    [200, { id: 12 }],
  ])("send failure %s causes no retry, fallback or outbox; logs only a safe outcome", async (status, data) => {
    const fake = vi.fn<typeof fetch>().mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json(data, status))
    const log = vi.spyOn(console, "log")
    const error = vi.spyOn(console, "error")
    vi.stubGlobal("fetch", fake)
    const fallback = vi.fn(async () => ({ messageId: "must-not-send" }))
    expect(await sendMail({ ...ready, MAIL: { send: fallback } }, message)).toBe(false)
    expect(fake).toHaveBeenCalledTimes(2)
    expect(fallback).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
    const outcome = status === 429 ? "retryable" : "uncertain"
    expect(error).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ level: "error", event: "mail_delivery_failed", failure: outcome }))
    expect(logLineProblems(String(error.mock.calls[0][0]))).toEqual([])
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM dev_outbox").first<number>("n")).toBe(0)
  })

  it("bounds provider response bytes and catches malformed JSON", async () => {
    for (const response of [new Response("{"), new Response("x".repeat(16_385)), json(null), json([])]) {
      const fake = vi.fn<typeof fetch>().mockResolvedValue(response)
      expect(await gmailSend(settings, message, fake)).toBe(false)
      expect(fake).toHaveBeenCalledTimes(1)
    }
  })

  it("ends a hanging provider call within the shared twelve-second budget", async () => {
    vi.useFakeTimers()
    const fake = vi.fn<typeof fetch>(
      async (_url, init) =>
        new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("synthetic timeout")))),
    )
    const pending = gmailSend(settings, message, fake)
    await vi.advanceTimersByTimeAsync(12_000)
    expect(await pending).toBe(false)
    expect(fake).toHaveBeenCalledTimes(1)
  })

  it("keeps Gmail off in synthetic staging, and refuses an unknown provider", async () => {
    const fake = request()
    vi.stubGlobal("fetch", fake)
    expect(await sendMail({ ...ready, ENVIRONMENT: "staging" }, message)).toBe(false)
    expect(contactMailReady({ ...ready, ENVIRONMENT: "staging" })).toBe(false)
    expect(await sendMail({ ...ready, MAIL_PROVIDER: "unknown" }, message)).toBe(false)
    expect(contactMailReady({ ...ready, MAIL_PROVIDER: "unknown" })).toBe(false)
    expect(fake).not.toHaveBeenCalled()
  })

  it("the real contact route sends only to the project and reports Gmail refusal truthfully", async () => {
    const app = createApp({
      sendMail,
      purge: async () => true,
      verifyTurnstile: async () => ({ success: true, action: "contact", hostname: "example.com" }),
    })
    const post = () =>
      app.fetch(
        new Request("https://project.test/api/v1/contact", {
          method: "POST",
          headers: {
            Origin: "https://project.test",
            "Sec-Fetch-Site": "same-origin",
            "Content-Type": "application/json",
            "Turnstile-Token": "pass",
          },
          body: JSON.stringify({ email: "visitor@unit.org", message: "בדיקה סינתטית בלבד" }),
        }),
        ready,
        createExecutionContext(),
      )
    const fake = request()
    vi.stubGlobal("fetch", fake)
    const accepted = await post()
    expect(accepted.status).toBe(202)
    expect(await accepted.json()).toEqual({ accepted: true })
    const mime = from64(JSON.parse(fake.mock.calls[1][1]?.body as string).raw)
    expect(mime).toContain("To: makomlizkor@gmail.com\r\n")
    expect(mime).not.toContain("To: visitor@unit.org")
    fake.mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json({ error: "synthetic failure" }, 503))
    expect((await post()).status).toBe(503)
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM dev_outbox").first<number>("n")).toBe(0)
  })
})
