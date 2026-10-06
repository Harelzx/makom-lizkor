import { env } from "cloudflare:workers"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CSP, SECURITY_HEADERS } from "../lib/security-headers"
import { call } from "./app"
import { admin, withSite } from "./helpers"
import { decide, feed, objects, queued, send, upload } from "./submission-helpers"

// Spec 11 (adviser a49): every response the Worker makes carries the site's security headers, with the same policy the
// static files get from public/_headers, and a CSP report is logged as two codes and nothing of the page.

const expectSecure = (res: Response) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(name), name).toBe(value)
}

describe("the security headers", () => {
  it("are on every kind of response: JSON, an error, a refusal, and the share page found or not", async () => {
    const responses = [
      await call("http://local/api/v1/health"),
      await call("http://local/api/v1/no-such-route"),
      await call("http://local/api/ops/summary"),
      await call("http://local/place/nova-memorial-reim", {}, withSite),
      await call("http://local/place/not-a-place", {}, withSite),
    ]
    expect(responses.map((r) => r.status)).toEqual([200, 404, 401, 200, 404])
    for (const res of responses) {
      expectSecure(res)
      expect(res.headers.get("Content-Security-Policy-Report-Only")).toBe(CSP)
      expect(res.headers.get("Content-Security-Policy")).toBeNull()
    }
  })

  it("are set once, not added to what the site's page already carried", async () => {
    const carrying: Env = {
      ...withSite,
      ASSETS: {
        fetch: async () =>
          new Response("<!doctype html><html><head></head><body></body></html>", {
            headers: {
              "Content-Type": "text/html",
              "Content-Security-Policy-Report-Only": "default-src 'none'",
              "Referrer-Policy": "no-referrer",
            },
          }),
      } as unknown as Fetcher,
    }
    const res = await call("http://local/place/nova-memorial-reim", {}, carrying)
    expect(res.headers.get("Content-Security-Policy-Report-Only")).toBe(CSP)
    expect(res.headers.get("Referrer-Policy")).toBe(SECURITY_HEADERS["Referrer-Policy"])
  })

  it("leave a photo's own sandbox in place, without a page policy beside it", async () => {
    const { id, trackingToken } = await send("ספסל דמו כותרות אבטחה")
    await upload(id, trackingToken)
    const [key] = await objects(id)
    const quarantined = await admin(`/api/admin/media/${key}`)
    await decide(id, await queued(id), "approve")
    const url = (await feed()).find((p) => p.id === id)!.photo as { url: string }
    for (const res of [quarantined, await call(`http://local${url.url}`)]) {
      expect(res.status).toBe(200)
      expect(res.headers.get("Content-Security-Policy")).toBe("sandbox; default-src 'none'")
      expect(res.headers.get("Content-Security-Policy-Report-Only")).toBeNull()
      expectSecure(res)
    }
  })

  it("forbid framing now, while the policy only reports", () => {
    expect(CSP).toContain("frame-ancestors 'none'")
    expect(SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY")
  })
})

describe("a CSP report", () => {
  const warn = vi.spyOn(console, "warn")
  afterEach(() => warn.mockClear())
  const lines = () => warn.mock.calls.map((c) => JSON.parse(String(c[0]))).filter((l) => l.event === "csp_report")
  const report = (body: unknown, address = `198.51.100.${Math.floor(Math.random() * 250) + 1}`, type = "application/csp-report") =>
    call("http://local/api/csp-report", {
      method: "POST",
      headers: { "Content-Type": type, "CF-Connecting-IP": address },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })

  it("is logged as its directive and the kind of source, never the page, the host or a sample", async () => {
    const res = await report({
      "csp-report": {
        "document-uri": "http://local/place/p_01J0000000000000000000000?private=1",
        referrer: "http://referrer.example/secret",
        "violated-directive": "img-src 'self' data: blob:",
        "effective-directive": "img-src",
        "blocked-uri": "https://tracker.example.org/pixel.png?who=someone",
        "source-file": "http://local/assets/index.js",
        "script-sample": "console.log('page code')",
      },
    })
    expect(res.status).toBe(204)
    expect(lines()).toEqual([{ level: "warn", event: "csp_report", directive: "img-src", source: "unknown" }])
    const written = warn.mock.calls.map((c) => String(c[0])).join("\n")
    for (const word of ["tracker.example", "p_01J", "private", "referrer.example", "index.js", "page code"])
      expect(written).not.toContain(word)
  })

  it("names our own providers and the site itself by kind, from either report format", async () => {
    await report({
      "csp-report": { "effective-directive": "script-src-elem", "blocked-uri": "https://challenges.cloudflare.com/turnstile/v0/api.js" },
    })
    await report({ "csp-report": { "violated-directive": "connect-src", "blocked-uri": "https://tiles.openfreemap.org/planet" } })
    await report({ "csp-report": { "effective-directive": "connect-src", "blocked-uri": "https://s3.amazonaws.com" } })
    await report({ "csp-report": { "effective-directive": "img-src", "blocked-uri": "http://local/photos/x.webp" } })
    await report({ "csp-report": { "effective-directive": "script-src-elem", "blocked-uri": "inline" } })
    await report({ "csp-report": { "effective-directive": "script-src", "blocked-uri": "wasm-eval" } })
    await report({ "csp-report": { "effective-directive": "img-src", "blocked-uri": "data" } })
    await report({ "csp-report": { "effective-directive": "worker-src", "blocked-uri": "blob" } })
    await report(
      [
        {
          type: "csp-violation",
          body: { effectiveDirective: "font-src", blockedURL: "https://fonts.example.net/x.woff2", documentURL: "http://local/" },
        },
        { type: "csp-violation", body: { effectiveDirective: "made-up-src", blockedURL: "inline" } },
        { type: "deprecation", body: { id: "x" } },
        { type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: "constructor" } },
        { type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: "https://constructor/x" } },
      ],
      undefined,
      "application/reports+json",
    )
    expect(lines().map((l) => `${l.directive} ${l.source}`)).toEqual([
      "script-src-elem turnstile",
      "connect-src map_tiles",
      "connect-src terrain",
      "img-src self",
      "script-src-elem inline",
      "script-src eval",
      "img-src data",
      "worker-src blob",
      "font-src unknown",
      "unknown inline",
      "img-src unknown",
      "img-src unknown",
    ])
  })

  it("that is malformed, empty or too large is answered and logs nothing", async () => {
    for (const body of [
      "",
      "{not json",
      JSON.stringify({ other: 1 }),
      JSON.stringify({ "csp-report": { "blocked-uri": "x".repeat(9000) } }),
    ])
      expect((await report(body)).status).toBe(204)
    expect(lines()).toEqual([])
  })

  it("is capped per address, counted under a keyed code", async () => {
    const statuses: number[] = []
    for (let i = 0; i < 25; i++)
      statuses.push((await report({ "csp-report": { "effective-directive": "img-src", "blocked-uri": "data" } }, "203.0.113.77")).status)
    expect(statuses.filter((s) => s === 204).length).toBe(20)
    expect(statuses.filter((s) => s === 429).length).toBe(5)
    expect(lines().length).toBe(20)
    expect(env.CSP_LIMIT).toBeDefined()
  })
})
