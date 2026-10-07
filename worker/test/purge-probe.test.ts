import { createExecutionContext } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { SignJWT } from "jose"
import { beforeEach, describe, expect, it } from "vitest"
import { createApp } from "../index"
import { tagsFor } from "../db/ops"
import { sendMail } from "../lib/mail"
import { PROBE_TAG } from "../routes/purge-probe"
import { fakeSiteverify } from "./app"
import { approve, devToken } from "./helpers"
import { send } from "./submission-helpers"

// The production purge probe (L-PURGE; adviser a73, Q2): a content-free generation, cached at the edge under its own
// tag only, that one dedicated service token moves on and purges. Exercises are serialized by a compare-and-set on the
// generation, and a retry of the same exercise gives the same answer and purges again.

const serviceToken = (commonName: string) =>
  new SignJWT({ common_name: commonName, type: "app" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("dev-access")
    .setAudience("makom-dev")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(env.DEV_ACCESS_SECRET))
const probeId = () => env.PROBE_SERVICE_TOKENS.split(",")[0]

const purged: string[][] = []
const edge = { refuses: false }
const app = createApp({ verifyTurnstile: fakeSiteverify, sendMail, purge: async (_e, _c, tags) => (purged.push(tags), !edge.refuses) })
const call = (path: string, init: RequestInit = {}, e: Env = env) => app.fetch(new Request(`http://local${path}`, init), e, createExecutionContext())
const read = () => call("/api/v1/purge-probe?run=abcdef012345")
const generation = async () => ((await (await read()).json()) as { generation: number }).generation
const move = async (exercise: string, expected: number, token?: string, e: Env = env) =>
  call(
    "/api/ops/purge-probe",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": token ?? (await serviceToken(probeId())) },
      body: JSON.stringify({ exercise, expected }),
    },
    e,
  )
const exercise = () => crypto.randomUUID().replaceAll("-", "").slice(0, 16)

beforeEach(() => {
  purged.length = 0
  edge.refuses = false
})

describe("the probe's address", () => {
  it("answers its generation and nothing else, kept by the edge under its own tag only, never by the browser", async () => {
    const res = await read()
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBe("max-age=60")
    expect(res.headers.get("Cache-Tag")).toBe(PROBE_TAG)
    const body = (await res.json()) as Record<string, unknown>
    expect(Object.keys(body)).toEqual(["generation"])
    expect(Number.isInteger(body.generation)).toBe(true)
  })

  it("refuses an address without a run of its own shape, and the edge keeps none of them", async () => {
    for (const q of ["", "?run=", "?run=short", "?run=UPPERCASE01234", `?run=${"a".repeat(33)}`, "?other=abcdef012345"]) {
      const res = await call(`/api/v1/purge-probe${q}`)
      expect(res.status, q).toBe(400)
      expect(res.headers.get("Cache-Control"), q).toBe("no-store")
      expect(res.headers.get("Cloudflare-CDN-Cache-Control"), q).toBeNull()
      expect(res.headers.get("Cache-Tag"), q).toBeNull()
    }
  })
})

describe("moving the probe on", () => {
  it("is refused without a token, to a moderator, to an unlisted token, and to an ops token even when it is listed too", async () => {
    const g = await generation()
    const ops = env.OPS_SERVICE_TOKENS.split(",")[0]
    const both = { ...env, PROBE_SERVICE_TOKENS: `${probeId()},${ops}` }
    const unauthenticated = await call("/api/ops/purge-probe", { method: "POST", body: JSON.stringify({ exercise: exercise(), expected: g }) })
    expect(unauthenticated.status).toBe(401)
    expect((await move(exercise(), g, await devToken("dev@example.test"))).status).toBe(403)
    expect((await move(exercise(), g, await serviceToken("not-listed.access"))).status).toBe(403)
    // Read-only diagnostics never gain write access by being listed here as well (a73).
    expect((await move(exercise(), g, await serviceToken(ops), both)).status).toBe(403)
    expect(await generation()).toBe(g)
    expect(purged).toEqual([])
  })

  it("the probe's token reads nothing else: the ops summary and the moderators' queue refuse it", async () => {
    const token = await serviceToken(probeId())
    expect((await call("/api/ops/summary", { headers: { "Cf-Access-Jwt-Assertion": token } })).status).toBe(403)
    expect((await call("/api/admin/queue", { headers: { "Cf-Access-Jwt-Assertion": token } })).status).toBe(403)
  })

  it("moves the generation on by one and purges the probe's tag alone, privately answered", async () => {
    const g = await generation()
    const res = await move(exercise(), g)
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("private, no-store")
    expect(await res.json()).toEqual({ generation: g + 1, purged: true })
    expect(purged).toEqual([[PROBE_TAG]])
    expect(await generation()).toBe(g + 1)
  })

  it("a retry of the same exercise answers the same and purges again, without moving twice", async () => {
    const g = await generation()
    const id = exercise()
    expect(await (await move(id, g)).json()).toEqual({ generation: g + 1, purged: true })
    expect(await (await move(id, g)).json()).toEqual({ generation: g + 1, purged: true })
    expect(purged).toEqual([[PROBE_TAG], [PROBE_TAG]])
    expect(await generation()).toBe(g + 1)
  })

  it("serializes exercises: of two sent at once from the same generation, one moves it and the other is refused", async () => {
    const g = await generation()
    const answers = await Promise.all([move(exercise(), g), move(exercise(), g)])
    expect(answers.map((r) => r.status).sort()).toEqual([200, 409])
    const refused = answers.find((r) => r.status === 409)!
    expect(((await refused.json()) as { code: string }).code).toBe("changed_meanwhile")
    expect(await generation()).toBe(g + 1)
    expect(purged).toEqual([[PROBE_TAG]])
  })

  it("a purge the edge refuses is said so; the same exercise, sent again, purges again", async () => {
    const g = await generation()
    const id = exercise()
    edge.refuses = true
    const res = await move(id, g)
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ code: "purge_failed", generation: g + 1 })
    edge.refuses = false
    expect(await (await move(id, g)).json()).toEqual({ generation: g + 1, purged: true })
    expect(await generation()).toBe(g + 1)
  })

  it("refuses a body that isn't an exercise of its shape and a whole-number generation", async () => {
    const g = await generation()
    for (const body of [{}, { exercise: "short", expected: g }, { exercise: exercise(), expected: "1" }, { exercise: exercise(), expected: -1 }]) {
      const res = await call("/api/ops/purge-probe", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": await serviceToken(probeId()) },
        body: JSON.stringify(body),
      })
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
    expect(await generation()).toBe(g)
  })
})

// Every answer the edge may keep carries tags a takedown purges, or the probe's own (a73: a checked mapping between
// cached representations and their purge tags). A takedown never purges the probe, and the probe never the feed.
describe("what the edge keeps, and what clears it", () => {
  it("each cached answer's tags are a takedown's tags for its place, or the probe's own", async () => {
    const s = await send("ספסל דמו למיפוי התגיות")
    expect((await approve(s.id)).status).toBe(200)
    const version = ((await (await call("/api/v1/version")).json()) as { v: string }).v
    const takedown = new Set(tagsFor(s.id))
    expect(takedown.has(PROBE_TAG)).toBe(false)
    const cached = [
      "/api/v1/version",
      `/api/v1/feed?v=${encodeURIComponent(version)}`,
      "/api/v1/tributes",
      `/place/${s.id}`,
      "/api/v1/purge-probe?run=abcdef012345",
    ]
    for (const path of cached) {
      const res = await call(path)
      const kept = res.headers.get("Cloudflare-CDN-Cache-Control")
      if (!kept) continue
      const tags = (res.headers.get("Cache-Tag") ?? "").split(",").map((t) => t.trim())
      expect(tags.length, path).toBeGreaterThan(0)
      for (const tag of tags) expect(takedown.has(tag) || tag === PROBE_TAG, `${path}: ${tag}`).toBe(true)
      if (path.includes("purge-probe")) expect(tags).toEqual([PROBE_TAG])
    }
  })

  // The census behind the mapping: only these sources mark an answer for the edge. Each one's tag is pinned by a test:
  // the feed's in feed.test.ts, a photo's in visibility.test.ts, a share image's in og.test.ts, and the share page's,
  // the anemones' and the probe's above. A new one fails here until its tags are mapped.
  it("no other source marks an answer for the edge to keep", () => {
    const sources = import.meta.glob(["../**/*.ts", "!../test/**"], { query: "?raw", import: "default", eager: true }) as Record<string, string>
    const keeping = Object.entries(sources)
      .filter(([, text]) => /"Cloudflare-CDN-Cache-Control": [`"]max-age/.test(text))
      .map(([path]) => path.replace(/^\.\.\//, ""))
      .sort()
    expect(keeping).toEqual(["index.ts", "lib/og.ts", "routes/feed.ts", "routes/purge-probe.ts", "routes/share.ts", "routes/tributes.ts"])
  })
})
