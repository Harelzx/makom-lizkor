import { env } from "cloudflare:workers"
import { createExecutionContext } from "cloudflare:test"
import { describe, expect, it, vi } from "vitest"
import { createApp } from "../index"
import { PUBLIC_JSON_BYTES } from "../lib/request-guard"

const verifyTurnstile = vi.fn(async () => ({ success: true, action: "submit", hostname: "example.com" }))
const sendMail = vi.fn(async () => true)
const app = createApp({ verifyTurnstile, sendMail, purge: async () => true })

function streaming(path: string, e: Env = env, declared?: string) {
  let pulled = 0
  let cancelled = false
  const chunk = new TextEncoder().encode("א".repeat(512))
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      pulled += chunk.byteLength
      c.enqueue(chunk)
      if (pulled >= 128 * 1024) c.close()
    },
    cancel() {
      cancelled = true
    },
  })
  const request = new Request(`https://project.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.91", ...(declared ? { "Content-Length": declared } : {}) },
    body,
  })
  return { response: app.fetch(request, e, createExecutionContext()), pulled: () => pulled, cancelled: () => cancelled }
}

describe("public request guards before parsers and external work", () => {
  it("stops streamed bytes, including Hebrew, before JSON parsing without trusting a short declared length", async () => {
    for (const path of [
      "/api/v1/submissions",
      "/api/v1/submissions/p_example/revisions",
      "/api/v1/reports",
      "/api/v1/email/verify",
      "/api/v1/tributes",
      "/api/v1/contact",
    ]) {
      for (const declared of [undefined, "1"]) {
        const r = streaming(
          path,
          {
            ...env,
            SUBMIT_LIMIT: { limit: async () => ({ success: true }) },
            REPORT_LIMIT: { limit: async () => ({ success: true }) },
            TRIBUTE_LIMIT: { limit: async () => ({ success: true }) },
          } as Env,
          declared,
        )
        expect((await r.response).status, path).toBe(413)
        expect(r.pulled()).toBeLessThan(PUBLIC_JSON_BYTES + 4096)
        expect(r.cancelled()).toBe(true)
      }
    }
    expect(verifyTurnstile).not.toHaveBeenCalled()
    expect(sendMail).not.toHaveBeenCalled()
  })

  it("rejects at the edge before consuming a body, touching D1 or contacting Turnstile/mail", async () => {
    const limit = vi.fn(async () => ({ success: false }))
    const prepare = vi.fn(() => {
      throw new Error("must not reach D1")
    })
    const e = { ...env, DB: { prepare }, SUBMIT_LIMIT: { limit }, REPORT_LIMIT: { limit }, TRIBUTE_LIMIT: { limit } } as unknown as Env
    for (const path of ["/api/v1/submissions", "/api/v1/reports", "/api/v1/email/verify", "/api/v1/tributes", "/api/v1/contact"]) {
      const r = streaming(path, e)
      const response = await r.response
      expect(response.status).toBe(429)
      expect(response.headers.get("Cache-Control")).toBe("private, no-store")
      expect(response.headers.get("Retry-After")).toBe("60")
      expect(r.pulled()).toBeLessThan(4096)
    }
    expect(prepare).not.toHaveBeenCalled()
  })

  it("shares contact IPv6 /64 counters while separating different prefixes and endpoint purposes", async () => {
    const keys: string[] = []
    const limit = async ({ key }: { key: string }) => {
      keys.push(key)
      return { success: false }
    }
    const e = { ...env, REPORT_LIMIT: { limit } } as Env
    for (const address of ["2001:db8:aa:bb::1", "2001:0DB8:00aa:00bb:ffff:1:2:3", "2001:db8:aa:bc::1", "192.0.2.10", "::ffff:192.0.2.10"]) {
      expect(
        (
          await app.fetch(
            new Request("https://project.test/api/v1/contact", { method: "POST", headers: { "CF-Connecting-IP": address } }),
            e,
            createExecutionContext(),
          )
        ).status,
      ).toBe(429)
    }
    expect(keys[0]).toBe(keys[1])
    expect(keys[0]).not.toBe(keys[2])
    expect(keys[3]).toBe(keys[4])
    expect(keys.every((k) => /^contact:[0-9a-f]{64}$/.test(k))).toBe(true)
    const { rateKey } = await import("../lib/ids")
    expect(keys[0]).not.toBe(await rateKey(env.TRACKING_SECRET, "2001:db8:aa:bb::1"))
  })

  it("caps public read work before D1/R2 and leaves protected/unknown routes on their original gates", async () => {
    const limit = vi.fn(async () => ({ success: false }))
    const e = { ...env, READ_LIMIT: { limit } } as Env
    for (const path of [
      "/api/v1/feed",
      "/api/v1/version",
      "/api/v1/tributes",
      "/api/v1/submissions/p_x",
      "/media/public/p_x/x.jpg",
      "/media/og/p_x/x.png",
      "/place/p_x",
    ]) {
      expect(
        (
          await app.fetch(
            new Request(`https://project.test${path}`, { headers: { "CF-Connecting-IP": "2001:db8::1" } }),
            e,
            createExecutionContext(),
          )
        ).status,
      ).toBe(429)
    }
    expect(limit).toHaveBeenCalledTimes(7)
    expect((await app.fetch(new Request("https://project.test/api/ops/summary"), e, createExecutionContext())).status).toBe(401)
  })
})
