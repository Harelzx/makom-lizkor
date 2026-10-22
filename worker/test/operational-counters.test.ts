import { env } from "cloudflare:workers"
import { beforeEach, expect, it, vi } from "vitest"
import { claimMailBudget, VISITOR_RESERVE } from "../lib/mail-budget"
import { CONTACT_EMAIL } from "@/config"
import { alertFailures, alertOperations, pruneCounters, recordFailure, recordRequest, requestErrorRates } from "../lib/metrics"
import { createApp } from "../index"
import { runJobs } from "../jobs"
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test"
import { EXPORT_TABLES } from "../db/exports"
import { admin } from "./helpers"
import { call } from "./app"
import { SignJWT } from "jose"

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM request_metrics"),
    env.DB.prepare("DELETE FROM mail_budget"),
    env.DB.prepare("DELETE FROM job_alerts WHERE job IN ('operations', 'failures')"),
  ])
})

it("the human administrator can read the aggregate summary while anonymous and machine visitors cannot", async () => {
  expect((await call("http://local/api/admin/summary")).status).toBe(401)
  const r = await admin("/api/admin/summary")
  expect(r.status).toBe(200)
  expect(r.headers.get("Cache-Control")).toBe("private, no-store")
  const s = await r.json<{ mail_delivery: unknown; mail_budget: unknown }>()
  expect(s.mail_delivery).toBeDefined()
  expect(s.mail_budget).toBeDefined()
  const token = await new SignJWT({ common_name: "dev-staging-moderator.access" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("dev-access")
    .setAudience("makom-dev")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(env.DEV_ACCESS_SECRET))
  expect((await call("http://local/api/admin/summary", { headers: { "Cf-Access-Jwt-Assertion": token } })).status).toBe(403)
})

it("claims a global mail quota atomically and reserves a separate bounded operations allowance", async () => {
  const now = new Date("2026-10-12T12:00:00Z")
  const e = { ...env, MAIL_DAILY_LIMIT: "3", MAIL_OPS_DAILY_LIMIT: "1" }
  const attempts = await Promise.all(Array.from({ length: 10 }, () => claimMailBudget(e, "public", now)))
  expect(attempts.filter(Boolean)).toHaveLength(3)
  expect(await claimMailBudget(e, "ops", now)).toBe(true)
  expect(await claimMailBudget(e, "ops", now)).toBe(false)
  expect(await claimMailBudget({ ...e, MAIL_DAILY_LIMIT: "1000" }, "public", now)).toBe(false)
  expect(await claimMailBudget(e, "public", new Date("2026-10-13T12:00:00Z"))).toBe(true)
})

it("keeps part of the public budget from what visitors' actions send, for the moderators' alerts", async () => {
  const now = new Date("2026-10-14T12:00:00Z")
  const e = { ...env, MAIL_DAILY_LIMIT: String(VISITOR_RESERVE + 1) }
  expect(await claimMailBudget(e, "visitor", now)).toBe(true)
  expect(await claimMailBudget(e, "visitor", now)).toBe(false)
  expect(await claimMailBudget(e, "public", now)).toBe(true)
})

it("stores only hourly sampled status counts and latency, marks estimates and excludes counters from backups", async () => {
  expect(await requestErrorRates(env)).toBeNull()
  await recordRequest(env, 200, 35)
  await recordRequest(env, 500, 2400)
  const rates = await requestErrorRates(env)
  expect(rates).toEqual({ windowHours: 24, requests: 2, byCode: { http_500: 1 }, sampleEvery: 32 })
  const rows = (await env.DB.prepare("SELECT * FROM request_metrics ORDER BY code").all()).results
  expect(Object.keys(rows[0]).sort()).toEqual(["hour", "code", "samples", "slow", "total_ms"].sort())
  expect(JSON.stringify(rows)).not.toMatch(/email|token|path|address|body/)
  expect(EXPORT_TABLES).not.toContain("request_metrics")
  expect(EXPORT_TABLES).not.toContain("mail_budget")
})

it("alerts only with aggregate counts, once per day after acceptance, and prunes expired operational counters", async () => {
  const now = new Date()
  const e = { ...env, MAIL_DAILY_LIMIT: "1" }
  await claimMailBudget(e, "public", now)
  const send = vi.fn(async () => true)
  await alertOperations(e, send, now)
  await alertOperations(e, send, now)
  expect(send).toHaveBeenCalledTimes(1)
  expect(send.mock.calls[0]).toBeDefined()
  expect((send.mock.calls[0] as unknown as [Env, { to: string }])[1].to).toBe(CONTACT_EMAIL)
  await recordRequest(env, 200, 50, new Date(now.getTime() - 72 * 3600_000))
  await claimMailBudget(e, "public", new Date(now.getTime() - 72 * 3600_000))
  await pruneCounters(e, now)
  const cutoff = new Date(now.getTime() - 48 * 3600_000).toISOString()
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM request_metrics WHERE hour < ?").bind(cutoff).first<number>("n")).toBe(0)
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM mail_budget WHERE day < ?").bind(cutoff.slice(0, 10)).first<number>("n")).toBe(0)
  expect(
    await env.DB.prepare("SELECT COUNT(*) AS n FROM mail_budget WHERE day = ?").bind(now.toISOString().slice(0, 10)).first<number>("n"),
  ).toBe(1)
})

it("counts every server error and every failed job part, unsampled, apart from the sampled estimate", async () => {
  // A rare 500 (a broken submission) would be missed by a 1-in-32 sample, and the sampled alert needs about a thousand
  // requests an hour before it can fire. Failures are counted whole, under their own codes.
  const failures: string[] = []
  const app = createApp({
    verifyTurnstile: async () => ({ success: true }),
    sendMail: async () => true,
    purge: async () => true,
    observeRequest: async () => {},
    observeFailure: async (_e, what) => void failures.push(what),
  })
  app.get("/api/v1/boom", () => {
    throw new TypeError("boom")
  })
  for (let i = 0; i < 3; i++) {
    const ctx = createExecutionContext()
    expect((await app.fetch(new Request("http://local/api/v1/boom"), env, ctx)).status).toBe(500)
    await waitOnExecutionContext(ctx)
  }
  const ok = createExecutionContext()
  expect((await app.fetch(new Request("http://local/api/v1/version"), env, ok)).status).toBe(200)
  await waitOnExecutionContext(ok)
  expect(failures).toEqual(["http_500", "http_500", "http_500"])

  // Recorded under err_*, which the sampled estimate's denominator and error rate never count.
  await recordRequest(env, 200, 30)
  await recordFailure(env, "http_500")
  await recordFailure(env, "http_500")
  await recordFailure(env, "job_export")
  await recordFailure(env, "not a code")
  expect(await requestErrorRates(env)).toEqual({ windowHours: 24, requests: 1, byCode: {}, sampleEvery: 32 })
  const rows = (await env.DB.prepare("SELECT code, samples FROM request_metrics ORDER BY code").all()).results
  expect(rows).toEqual([
    { code: "err_http_500", samples: 2 },
    { code: "err_job_export", samples: 1 },
    { code: "http_200", samples: 1 },
  ])
})

it("records a scheduled part that throws as a failure, without stopping the others", async () => {
  const now = new Date()
  const broken = { ...env, EXPORT_PUBLIC_KEYS: undefined, EXPORTS: undefined } as unknown as Env
  await runJobs(broken, { sendMail: async () => true, purge: async () => true }, undefined, now)
  const codes = (await env.DB.prepare("SELECT code FROM request_metrics WHERE code GLOB 'err_job_*'").all<{ code: string }>()).results
  expect(codes.length).toBeGreaterThan(0)
  expect(codes.every((r) => /^err_job_[a-z_]+$/.test(r.code))).toBe(true)
})

it("tells the moderators of server errors and failed jobs at once, with counts only, at most every six hours", async () => {
  const now = new Date()
  const send = vi.fn<(e: Env, m: { to: string; subject: string; text: string }) => Promise<boolean>>(async () => true)
  await alertFailures(env, send, now)
  expect(send).not.toHaveBeenCalled()
  await recordFailure(env, "http_500", now)
  await recordFailure(env, "http_503", now)
  await recordFailure(env, "job_export", now)
  await alertFailures(env, send, now)
  expect(send).toHaveBeenCalledTimes(1)
  const mail = send.mock.calls[0][1]
  expect(mail.subject).toBe("מקום לזכור - תקלות בשרת")
  // The site's own inbox, not the moderators' (owner, 19 October 2026).
  expect(mail.to).toBe(CONTACT_EMAIL)
  expect(mail.text).toContain("שגיאות שרת (500): 1")
  expect(mail.text).toContain("שגיאות שרת (503): 1")
  expect(mail.text).toContain("export: 1")
  expect(mail.text).not.toMatch(/@|token|body/)
  await recordFailure(env, "http_500", new Date(now.getTime() + 60_000))
  await alertFailures(env, send, new Date(now.getTime() + 5 * 3600_000))
  expect(send).toHaveBeenCalledTimes(1)
  await alertFailures(env, send, new Date(now.getTime() + 6 * 3600_000 + 60_000))
  expect(send).toHaveBeenCalledTimes(2)
})

it("tells of errors in visitors' browsers only once there are three in six hours: one alone may be an old browser or an extension", async () => {
  const now = new Date()
  const send = vi.fn<(e: Env, m: { to: string; subject: string; text: string }) => Promise<boolean>>(async () => true)
  await recordFailure(env, "client_error", now)
  await recordFailure(env, "client_error", now)
  await alertFailures(env, send, now)
  expect(send).not.toHaveBeenCalled()
  await recordFailure(env, "client_error", now)
  await alertFailures(env, send, now)
  expect(send).toHaveBeenCalledTimes(1)
  expect(send.mock.calls[0][1].text).toContain("שגיאות בדפדפן של מבקרים: 3")
})

it("pushes the alert to the owner's phone (ntfy) too, even while its mail fails, at most every six hours", async () => {
  const now = new Date()
  const pushes: { url: string; body: { topic: string; title: string; message: string } }[] = []
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    pushes.push({ url, body: JSON.parse(String(init.body)) })
    return new Response("{}")
  })
  try {
    const withTopic = { ...env, NTFY_TOPIC: "unit-topic" } as Env
    const failing = vi.fn(async () => false)
    await recordFailure(withTopic, "http_500", now)
    await alertFailures(withTopic, failing, now)
    expect(failing).toHaveBeenCalledTimes(1)
    expect(pushes).toHaveLength(1)
    expect(pushes[0].url).toBe("https://ntfy.sh/")
    expect(pushes[0].body.topic).toBe("unit-topic")
    expect(pushes[0].body.title).toBe("מקום לזכור - תקלות בשרת")
    expect(pushes[0].body.message).toContain("שגיאות שרת (500): 1")
    expect(pushes[0].body.message).not.toMatch(/@|token|body/)
    // The mail is tried again at the next pass; the phone isn't told again within six hours.
    await alertFailures(withTopic, failing, new Date(now.getTime() + 15 * 60_000))
    expect(failing).toHaveBeenCalledTimes(2)
    expect(pushes).toHaveLength(1)
    await alertFailures(withTopic, failing, new Date(now.getTime() + 6 * 3600_000 + 60_000))
    expect(pushes).toHaveLength(2)
    // No topic (development, tests): nothing leaves.
    await alertFailures(env, failing, new Date(now.getTime() + 13 * 3600_000))
    expect(pushes).toHaveLength(2)
  } finally {
    vi.unstubAllGlobals()
  }
})
