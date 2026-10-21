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

const beacon = (reports: unknown[]) =>
  call("http://local/api/csp-report", {
    method: "POST",
    headers: { "Content-Type": "application/reports+json", "CF-Connecting-IP": `198.51.100.${Math.floor(Math.random() * 250) + 1}` },
    body: JSON.stringify(reports),
  })
const counted = async () =>
  Object.fromEntries(
    (
      await env.DB.prepare("SELECT code, SUM(samples) AS n FROM request_metrics GROUP BY code").all<{ code: string; n: number }>()
    ).results.map((r) => [r.code, r.n]),
  )

it("counts what went wrong for a visitor by kind from the closed list, and nothing else of the report", async () => {
  expect(
    (
      await beacon([
        { type: "client-issue", body: { kind: "crash" } },
        { type: "client-issue", body: { kind: "map_tiles", url: "https://tiles.example/1/2/3.pbf" } },
        { type: "client-issue", body: { kind: "crash" } },
        { type: "client-issue", body: { kind: "../../etc" } },
        { type: "client-issue", body: { kind: "constructor" } },
      ])
    ).status,
  ).toBe(204)
  expect(await counted()).toEqual({ err_client_crash: 1, err_client_map_tiles: 1 })
})

it("counts a visit and its speed ratings, dropping a rating it doesn't know", async () => {
  await beacon([{ type: "client-visit", body: { lcp: "good", inp: "poor", cls: "huge", page: "/place/secret" } }])
  await beacon([{ type: "client-visit", body: {} }])
  expect(await counted()).toEqual({ ev_visit: 2, ev_lcp_good: 1, ev_inp_poor: 1 })
  const r = await admin("/api/admin/health")
  expect(SiteHealth.parse(await r.json()).hours.map((h) => h.code)).toEqual(expect.arrayContaining(["ev_visit", "ev_lcp_good"]))
})
