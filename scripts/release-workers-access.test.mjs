import assert from "node:assert/strict"
import { test } from "node:test"
import { accessDestinations, PUBLIC_PATHS, workersAccessProblems, WORKERS_ACCESS as T } from "./release-workers-access.mjs"
const now = Date.parse("2026-10-11T08:00:00Z")
const raw = {
  name: "makom-lizkor",
  workers_dev: true,
  preview_urls: false,
  vars: {
    ENVIRONMENT: "production",
    PUBLIC_ORIGIN: `https://${T.domain}`,
    ACCESS_AUD: T.aud,
    ACCESS_TEAM_DOMAIN: "makom-staging.cloudflareaccess.com",
    MODERATORS: T.owner,
  },
}
function fixture(phase = "protected") {
  const policy = { decision: "allow", include: [{ email: { email: T.owner } }], exclude: [], require: [] }
  const app = {
    id: T.app,
    aud: T.aud,
    type: "self_hosted",
    domain: T.host,
    self_hosted_domains: [T.host, T.domain],
    destinations: accessDestinations(phase),
    session_duration: "1h",
    options_preflight_bypass: false,
    http_only_cookie_attribute: true,
    policies: [policy],
  }
  const ok = (result) => ({ success: true, status: 200, result })
  return {
    observed_at: new Date(now).toISOString(),
    app: ok(app),
    policies: ok([policy]),
    apps: { ...ok([structuredClone(app)]), result_info: { total_pages: 1, total_count: 1, count: 1 } },
  }
}
const check = (s, phase = "protected", r = raw) => workersAccessProblems(r, s, { phase, now })
const sync = (s) => {
  s.app.result.policies = structuredClone(s.policies.result)
  s.apps.result[0] = structuredClone(s.app.result)
}
test("accepts exact whole-Worker owner protection before opening, and the exact public paths after", () => {
  assert.deepEqual(check(fixture()), [])
  assert.deepEqual(check(fixture("public"), "public"), [])
  assert.notDeepEqual(check(fixture("public")), [])
  assert(PUBLIC_PATHS.length <= 25)
  for (const path of ["/api/v1/submissions/*", "/api/v1/submissions/*/*", "/api/csp-report", "/licenses/fonts/"])
    assert(PUBLIC_PATHS.includes(path), path)
  assert(!PUBLIC_PATHS.some((p) => /health|admin|ops|purge-probe|__dev|preview-login/.test(p)))
})
test("rejects changed host, owner, Worker, audience, previews, or environment", () => {
  for (const r of [
    { ...raw, name: "another-worker" },
    { ...raw, preview_urls: true },
    { ...raw, workers_dev: false },
    { ...raw, vars: { ...raw.vars, PUBLIC_ORIGIN: "https://evil.workers.dev" } },
    { ...raw, vars: { ...raw.vars, ENVIRONMENT: "staging" } },
  ])
    assert(check(fixture(), "protected", r).length)
  for (const key of ["id", "aud", "domain"]) {
    const s = fixture()
    s.app.result[key] = "wrong"
    sync(s)
    assert(check(s).length)
  }
})
test("rejects stale/future/failed/incomplete reads and shadow applications", () => {
  const stale = fixture()
  stale.observed_at = new Date(now - 300001).toISOString()
  assert(check(stale).length)
  const future = fixture()
  future.observed_at = new Date(now + 5001).toISOString()
  assert(check(future).length)
  const failed = fixture()
  failed.policies.success = false
  assert(check(failed).length)
  const incomplete = fixture()
  incomplete.apps.result_info.total_pages = 2
  assert(check(incomplete).length)
  for (const other of [
    { id: "shadow", domain: T.host + "/api/admin" },
    { id: "shadow", domain: "*.workers.dev" },
    { id: "shadow", destinations: [{ type: "all_workers" }] },
  ]) {
    const s = fixture()
    s.apps.result.push(other)
    s.apps.result_info.count++
    s.apps.result_info.total_count++
    assert(check(s).length)
  }
})
test("rejects broad public patterns, missing Worker coverage and policy expansion", () => {
  for (const path of ["/*", "/api/*", "/api/admin/*", "/media/*"]) {
    const s = fixture("public")
    s.app.result.destinations[0].overrides.push({ path_pattern: path, behavior: "public" })
    sync(s)
    assert(check(s, "public").length)
  }
  const missing = fixture()
  missing.app.result.destinations.pop()
  sync(missing)
  assert(check(missing).length)
  for (const include of [[{ everyone: {} }], [{ service_token: { token_id: "test" } }], [{ email: { email: "other@example.org" } }]]) {
    const s = fixture()
    s.policies.result[0].include = include
    sync(s)
    assert(check(s).length)
  }
  const session = fixture()
  session.app.result.session_duration = "24h"
  sync(session)
  assert(check(session).length)
})
test("the domain is a public destination with the very same paths as the workers.dev address", () => {
  const [old, domain, worker] = accessDestinations("public")
  assert.equal(old.uri, T.host)
  assert.equal(domain.uri, T.domain)
  assert.deepEqual(domain.overrides, old.overrides)
  assert.deepEqual(worker, { type: "worker", worker_id: T.worker })
  const s = fixture("public")
  s.app.result.destinations = s.app.result.destinations.filter((d) => d.uri !== T.domain)
  sync(s)
  assert.notDeepEqual(check(s, "public"), [])
})
