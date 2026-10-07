import { env } from "cloudflare:workers"
import { describe, expect, it } from "vitest"
import { CURRENT_SUBMISSION_NOTICE } from "@/shared/contract"
import { call } from "./app"

const body = (name: string) =>
  JSON.stringify({ kind: "bench", name_he: name, lat: 31.42, lng: 34.49, consent_version: CURRENT_SUBMISSION_NOTICE })
const key = () => crypto.randomUUID().replaceAll("-", "")
const post = (name: string, token: string | null, extra: Record<string, string> = {}, e: Env = env, k = key()) =>
  call(
    "http://local/api/v1/submissions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": k, ...(token ? { "Turnstile-Token": token } : {}), ...extra },
      body: body(name),
    },
    e,
  )
const code = async (r: Response) => ((await r.json()) as { code?: string }).code

describe("Turnstile on a new submission", () => {
  it("is required, and a failed or mismatched check refuses the place", async () => {
    for (const [token, expected] of [
      [null, "turnstile_required"],
      ["fail", "turnstile_failed"],
      ["wrong-host", "turnstile_failed"],
      ["wrong-action", "turnstile_failed"],
    ] as const) {
      const res = await post(`ספסל דמו ${token}`, token)
      expect(res.status).toBe(403)
      expect(await code(res)).toBe(expected)
    }
  })
  it("passes a real check for the submit action", async () => {
    expect((await post("ספסל דמו עובר", "pass")).status).toBe(201)
  })
  it("accepts Cloudflare's test keys in development and on staging, never in production", async () => {
    expect((await post("ספסל דמו מפתח בדיקה", "testing-key")).status).toBe(201)
    // Staging's synthetic submissions (H-TURNSTILE): the test keys answer for example.com, which staging must list.
    const staging = { ...env, ENVIRONMENT: "staging", TURNSTILE_HOSTNAMES: "example.com" }
    expect((await post("ספסל דמו מפתח בדיקה ב־staging", "testing-key", {}, staging)).status).toBe(201)
    const unlisted = { ...env, ENVIRONMENT: "staging", TURNSTILE_HOSTNAMES: "makom-lizkor-staging.makom-staging.workers.dev" }
    expect((await post("ספסל דמו מפתח בדיקה ב־staging בלי המארח", "testing-key", {}, unlisted)).status).toBe(403)
    // A real answer for another action stays refused on staging: only the test keys' missing action is excused.
    expect((await post("ספסל דמו פעולה אחרת ב־staging", "wrong-action", {}, staging)).status).toBe(403)
    const production = { ...env, ENVIRONMENT: "production", TURNSTILE_HOSTNAMES: "example.com" }
    expect((await post("ספסל דמו מפתח בדיקה בייצור", "testing-key", {}, production)).status).toBe(403)
  })
  it("answers 503 when the check can't be reached, so the browser tries again later", async () => {
    const res = await post("ספסל דמו בלי בדיקה", "down")
    expect(res.status).toBe(503)
    expect(await code(res)).toBe("turnstile_unavailable")
  })
  it("refuses everything in production when no secret is set", async () => {
    const production = { ...env, ENVIRONMENT: "production", TURNSTILE_SECRET: "" }
    expect((await post("ספסל דמו בלי סוד", "pass", {}, production)).status).toBe(503)
  })
  it("isn't asked again when the same submission is sent again: the first try was checked", async () => {
    const k = key()
    expect((await post("ספסל דמו חוזר", "pass", {}, env, k)).status).toBe(201)
    expect((await post("ספסל דמו חוזר", null, {}, env, k)).status).toBe(200)
  })
})

describe("limits", () => {
  it("stops new submissions politely once the queue is full", async () => {
    const full = { ...env, QUEUE_LIMIT: "0" }
    const res = await post("ספסל דמו תור מלא", "pass", {}, full)
    expect(res.status).toBe(503)
    expect(res.headers.get("Retry-After")).toBe("3600")
    expect(await code(res)).toBe("queue_full")
  })
  it("caps one address's submissions, and the cap needs no stored address", async () => {
    const statuses: number[] = []
    for (let i = 0; i < 14; i++) statuses.push((await post(`ספסל דמו קצב ${i}`, "pass", { "CF-Connecting-IP": "203.0.113.7" })).status)
    expect(statuses).toContain(429)
    expect(statuses.filter((s) => s === 201).length).toBeLessThanOrEqual(10)
    const tables = await env.DB.prepare("SELECT group_concat(sql) AS s FROM sqlite_master").first<string>("s")
    // No column for a visitor's IP in any form (an email's to_address is not one).
    expect(tables).not.toMatch(/\b(remote_?|client_?)?ip(_?address|_?hash)?\b/i)
  })
})
