import { env } from "cloudflare:workers"
import { beforeEach, expect, it } from "vitest"
import { recordFailure, recordRequest } from "../lib/metrics"
import { SiteHealth } from "../lib/health"
import { admin } from "./helpers"
import { call } from "./app"

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM request_metrics").run()
})

it("gives the moderators every hourly counter of the last two days, codes and counts only", async () => {
  const now = new Date()
  await recordRequest(env, 200, 120, now)
  await recordRequest(env, 200, 2400, now)
  await recordFailure(env, "http_500", now)
  await recordFailure(env, "job_export", now)
  await recordFailure(env, "client_error", new Date(now.getTime() - 3 * 3600_000))
  // Older than the window: left out.
  await recordFailure(env, "http_502", new Date(now.getTime() - 50 * 3600_000))

  expect((await call("http://local/api/admin/health")).status).toBe(401)
  const r = await admin("/api/admin/health")
  expect(r.status).toBe(200)
  expect(r.headers.get("Cache-Control")).toBe("private, no-store")
  const h = SiteHealth.parse(await r.json())
  expect(h.window_hours).toBe(48)
  const codes = Object.fromEntries(h.hours.map((x) => [x.code, x]))
  expect(codes.http_200).toMatchObject({ samples: 2, total_ms: 2520, slow: 1 })
  expect(codes.err_http_500.samples).toBe(1)
  expect(codes.err_job_export.samples).toBe(1)
  expect(codes.err_client_error.samples).toBe(1)
  expect(codes.err_http_502).toBeUndefined()
  expect(JSON.stringify(h)).not.toMatch(/email|token|path|address|body|ip/i)
})
