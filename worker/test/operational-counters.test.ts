import { env } from "cloudflare:workers"
import { beforeEach, expect, it, vi } from "vitest"
import { claimMailBudget } from "../lib/mail-budget"
import { alertOperations, pruneCounters, recordRequest, requestErrorRates } from "../lib/metrics"
import { EXPORT_TABLES } from "../db/exports"
import { admin } from "./helpers"
import { call } from "./app"
import { SignJWT } from "jose"

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM request_metrics"),
    env.DB.prepare("DELETE FROM mail_budget"),
    env.DB.prepare("DELETE FROM job_alerts WHERE job = 'operations'"),
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
