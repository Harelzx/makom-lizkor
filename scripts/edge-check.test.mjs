// node --test scripts/edge-check.test.mjs
// The edge check's own rules, against a stand-in deployment: it must catch a wrong answer, a missing header, a cacheable
// authenticated answer, a shared HIT and one owner's private answer reaching another. Where it can't see, it says
// "incomplete" against a real deployment (which never qualifies a release), and "skip" only in the explicit local mode.
import assert from "node:assert/strict"
import { test } from "node:test"
import { CSP, SECURITY_HEADERS } from "../worker/lib/security-headers.ts"
import { edgeChecks, outcome } from "./edge-check.mjs"

/** The stand-in sign-in names a session by the length of what was sent: the moderator's. */
const MODERATOR = JSON.stringify({ email: "dev@example.test" }).length
const GOOD = { ...SECURITY_HEADERS, "Content-Security-Policy-Report-Only": CSP }
/** A deployment that answers everything well, with one thing changed by `bend`. */
const deployment =
  (bend = () => {}) =>
  async (input, init = {}) => {
    const u = new URL(input)
    const headers = new Headers(GOOD)
    if (u.pathname.startsWith("/api/")) headers.set("Cache-Control", "private, no-store")
    if (u.pathname === "/__dev/login") headers.set("Set-Cookie", `CF_Authorization=${init.body?.length}; Path=/; HttpOnly`)
    const auth = new Headers(init.headers).get("Authorization") ?? new Headers(init.headers).get("Cookie") ?? ""
    const owner = /^\/api\/v1\/submissions\/(\w+)$/.exec(u.pathname)?.[1]
    const status =
      u.pathname === "/api/v1/no-such-route" || u.pathname === "/place/p_00000000000000000000000000"
        ? 404
        : u.pathname.startsWith("/api/admin")
          ? auth.includes(`CF_Authorization=${MODERATOR}`)
            ? 200
            : auth.includes("CF_Authorization=")
              ? 403
              : 401
          : u.pathname.startsWith("/api/ops")
            ? 401
            : owner
              ? auth === `Bearer token-${owner}`
                ? 200
                : 401
              : 200
    if (u.pathname === "/" || u.pathname.startsWith("/place/")) headers.set("Content-Type", "text/html")
    // An owner's own private answer carries its synthetic marker.
    const body = u.pathname === "/api/v1/health" ? '{"ok":true}' : owner && status === 200 ? `{"marker":"marker-${owner}"}` : "{}"
    const res = { status, headers, body }
    bend(u, init, res)
    return new Response(res.status === 204 ? null : res.body, { status: res.status, headers: res.headers })
  }
const status = (results) => Object.fromEntries(results.map((r) => [r.check, r.status]))

const OWNERS = [
  { name: "a", path: "/api/v1/submissions/p_a", headers: { Authorization: "Bearer token-p_a" }, marker: "marker-p_a" },
  { name: "b", path: "/api/v1/submissions/p_b", headers: { Authorization: "Bearer token-p_b" }, marker: "marker-p_b" },
]
/** The owners' probes as they come through the edge cache. */
const throughEdge = (bend = () => {}) =>
  deployment((u, i, res) => {
    if (u.pathname.startsWith("/api/")) res.headers.set("CF-Cache-Status", "DYNAMIC")
    bend(u, i, res)
  })

test("locally (explicit), a deployment that keeps every rule passes what it can show, and skips the rest", async () => {
  const results = await edgeChecks("https://site.example", { fetch: deployment(), local: true, dev: true })
  assert.deepEqual(status(results), {
    responses: "pass",
    headers: "pass",
    private_no_store: "pass",
    private_isolation: "pass",
    place_page: "pass",
    no_shared_hit: "skip",
    purge_freshness: "skip",
    workers_dev_closed: "skip",
  })
  assert.equal(outcome(results), "pass")
})

test("against a real deployment, what it can't show is incomplete, never passed or skipped (P6-EDGE-1)", async () => {
  const results = await edgeChecks("https://site.example", { fetch: deployment() })
  assert.deepEqual(status(results), {
    responses: "pass",
    headers: "pass",
    private_no_store: "pass",
    private_isolation: "incomplete",
    place_page: "incomplete",
    no_shared_hit: "incomplete",
    purge_freshness: "incomplete",
    workers_dev_closed: "incomplete",
    deployed_version: "incomplete",
  })
  assert.equal(outcome(results), "incomplete")
})

// From phase 7 a share page needs a place in the database, so a deployment names the place to check (a60, EDGE_PLACE).
test("a named place's share page must answer 200; one never named leaves the check incomplete on a deployment (a60)", async () => {
  const named = await edgeChecks("https://site.example", { fetch: deployment(), place: "car-wall-tkuma" })
  assert.equal(status(named).place_page, "pass")
  const asked = []
  await edgeChecks("https://site.example", { fetch: deployment((u) => asked.push(u.pathname)), place: "p_01M49YXN0NET6BY2Z9PEXGWFHG" })
  assert.ok(asked.includes("/place/p_01M49YXN0NET6BY2Z9PEXGWFHG"))
  // Named and missing, hidden or broken: a failure, never an unavailable prerequisite.
  for (const code of [404, 410, 500]) {
    const results = await edgeChecks("https://site.example", {
      fetch: deployment((u, _i, res) => u.pathname === "/place/car-wall-tkuma" && (res.status = code)),
      place: "car-wall-tkuma",
    })
    assert.equal(status(results).place_page, "fail", String(code))
    assert.equal(outcome(results), "fail")
  }
  const wrongType = await edgeChecks("https://site.example", {
    fetch: deployment((u, _i, res) => u.pathname === "/place/car-wall-tkuma" && res.headers.set("Content-Type", "application/json")),
    place: "car-wall-tkuma",
  })
  assert.equal(status(wrongType).place_page, "fail")
})

test("a named place's share page without the page policy, or with another, fails the headers (P7-EDGE-HEADERS-1)", async () => {
  for (const bend of [
    (u, _i, res) => u.pathname === "/place/car-wall-tkuma" && res.headers.delete("Content-Security-Policy-Report-Only"),
    (u, _i, res) => u.pathname === "/place/car-wall-tkuma" && res.headers.set("Content-Security-Policy-Report-Only", "default-src *"),
  ]) {
    const results = await edgeChecks("https://site.example", { fetch: deployment(bend), place: "car-wall-tkuma" })
    assert.equal(status(results).headers, "fail", String(bend))
    assert.match(results.find((r) => r.check === "headers").detail.join(" "), /\/place\/car-wall-tkuma: the page policy differs/)
    assert.equal(outcome(results), "fail")
  }
})

test("locally the seeded place is checked by default, and a missing seed fails (a60)", async () => {
  const asked = []
  const results = await edgeChecks("https://site.example", { fetch: deployment((u) => asked.push(u.pathname)), local: true })
  assert.ok(asked.includes("/place/car-wall-tkuma"))
  assert.equal(status(results).place_page, "pass")
  const unseeded = await edgeChecks("https://site.example", {
    fetch: deployment((u, _i, res) => u.pathname === "/place/car-wall-tkuma" && (res.status = 404)),
    local: true,
  })
  assert.equal(status(unseeded).place_page, "fail")
})

test("an unnamed place never hides a failure elsewhere (a60)", async () => {
  const results = await edgeChecks("https://site.example", {
    fetch: deployment((u, _i, res) => u.pathname === "/" && res.headers.delete("X-Content-Type-Options")),
  })
  assert.equal(status(results).place_page, "incomplete")
  assert.equal(status(results).headers, "fail")
  assert.equal(outcome(results), "fail")
})

test("a place that was never public is the share route's 404, whatever is named (a60)", async () => {
  const results = await edgeChecks("https://site.example", {
    fetch: deployment((u, _i, res) => u.pathname === "/place/p_00000000000000000000000000" && (res.status = 200)),
  })
  assert.equal(status(results).responses, "fail")
})

test("a place named in a shape no place has is refused before anything is asked (a60)", async () => {
  for (const place of ["local-1", "../admin", "Car Wall", "", "p_" + "x".repeat(40)])
    await assert.rejects(edgeChecks("https://site.example", { fetch: deployment(), place }), /EDGE_PLACE/, place)
})

// After a deploy the previous version may still answer for a while: the run waits for the expected tag on health,
// bounded, then holds every Worker answer it measures to that tag (a61, DEPLOY-VERSION-1).
const FAST = { deadlineMs: 300, everyMs: 10, fetchMs: 100 }
const WORKER = /^\/(api|place|media|__dev)\//
/** A deployment whose Worker answers name `tagOf(path, n)`, n counting the health probes so far. */
const versioned = (tagOf, bend = () => {}) => {
  let n = 0
  return deployment((u, i, res) => {
    if (u.pathname === "/api/v1/health") n++
    const tag = WORKER.test(u.pathname) ? tagOf(u.pathname, n) : null
    if (tag) res.headers.set("X-Worker-Version", tag)
    bend(u, i, res, n)
  })
}

test("a deployment's version is waited for on health, then named on every Worker answer measured (a61)", async () => {
  const healthAsked = []
  const fetch = versioned(
    (_p, n) => (n <= 2 ? "staging-old" : "staging-new"),
    (u) => u.pathname === "/api/v1/health" && healthAsked.push(u.search),
  )
  const results = await edgeChecks("https://site.example", { fetch, expectTag: "staging-new", readiness: FAST })
  assert.equal(status(results).deployed_version, "pass")
  assert.ok(healthAsked.length >= 3)
  // Each readiness probe is its own address, so no cache answers one for another.
  assert.equal(new Set(healthAsked.slice(0, 3)).size, 3)
  // Static files carry no version: not counted against it.
  assert.match(results.find((r) => r.check === "deployed_version").detail, /Worker answers named staging-new/)
})

test("a version that never answers within the deadline fails the run before anything else is checked (a61)", async () => {
  for (const [why, fetch] of [
    ["the old version", versioned(() => "staging-old")],
    ["no version named", versioned(() => null)],
    [
      "the right tag on a failing answer",
      versioned(
        () => "staging-new",
        (u, _i, res) => u.pathname === "/api/v1/health" && (res.status = 503),
      ),
    ],
  ]) {
    const results = await edgeChecks("https://site.example", { fetch, expectTag: "staging-new", readiness: FAST })
    assert.deepEqual(status(results), { deployed_version: "fail" }, why)
    assert.equal(outcome(results), "fail", why)
  }
})

test("a stalled request can't outlast the readiness deadline (a61)", async () => {
  const stalled = (input, init = {}) =>
    new URL(input).pathname === "/api/v1/health"
      ? new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal.reason)))
      : deployment()(input, init)
  const started = Date.now()
  const results = await edgeChecks("https://site.example", { fetch: stalled, expectTag: "staging-new", readiness: FAST })
  assert.deepEqual(status(results), { deployed_version: "fail" })
  assert.ok(Date.now() - started < FAST.deadlineMs + 200, `took ${Date.now() - started} ms`)
})

test("an old version answering a later probe fails, even after health named the new one (a61)", async () => {
  const fetch = versioned((path) => (path === "/api/admin/queue" ? "staging-old" : "staging-new"))
  const results = await edgeChecks("https://site.example", { fetch, expectTag: "staging-new", readiness: FAST })
  assert.equal(status(results).deployed_version, "fail")
  assert.match(results.find((r) => r.check === "deployed_version").detail.join(" "), /\/api\/admin\/queue[^;]*staging-old/)
  assert.equal(outcome(results), "fail")
  const unnamed = await edgeChecks("https://site.example", {
    fetch: versioned((path) => (path === "/api/v1/no-such-route" ? null : "staging-new")),
    expectTag: "staging-new",
    readiness: FAST,
  })
  assert.equal(status(unnamed).deployed_version, "fail")
})

test("locally, with no version expected, nothing about versions is asked or reported (a61)", async () => {
  const results = await edgeChecks("https://site.example", { fetch: deployment(), local: true })
  assert.equal(status(results).deployed_version, undefined)
})

test("an expected tag in a shape no deploy gives is refused (a61)", async () => {
  for (const expectTag of ["", "--report", "staging new", "a".repeat(80)])
    await assert.rejects(edgeChecks("https://site.example", { fetch: deployment(), expectTag }), /--expect-tag/, expectTag)
})

test("an unhealthy deployment fails, however right its headers (P6-EDGE-1)", async () => {
  for (const bend of [
    (u, _i, res) => u.pathname === "/api/v1/health" && (res.status = 500),
    (u, _i, res) => u.pathname === "/api/v1/health" && (res.body = '{"ok":false}'),
    (u, _i, res) => u.pathname === "/" && (res.status = 503),
    (u, _i, res) => u.pathname === "/api/v1/no-such-route" && (res.status = 200),
    // A private address answered without a credential.
    (u, _i, res) => u.pathname === "/api/ops/summary" && (res.status = 200),
  ]) {
    const results = await edgeChecks("https://site.example", { fetch: deployment(bend), local: true })
    assert.equal(status(results).responses, "fail", String(bend))
    assert.equal(outcome(results), "fail")
  }
})

test("two owners each get their own private answer, and never the other's (P6-EDGE-1)", async () => {
  const ok = await edgeChecks("https://site.example", { fetch: deployment(), identities: OWNERS })
  assert.equal(status(ok).private_isolation, "pass")
  // A shared cache handing a's answer to whoever asks: b reads a's.
  const leaking = deployment((u, _i, res) => u.pathname.startsWith("/api/v1/submissions/") && (res.status = 200))
  const bad = (await edgeChecks("https://site.example", { fetch: leaking, identities: OWNERS })).find(
    (r) => r.check === "private_isolation",
  )
  assert.equal(bad.status, "fail")
  assert.deepEqual(bad.detail, ["b read a's private address (200)", "a read b's private address (200)"])
  // One owner is not two.
  assert.equal(
    status(await edgeChecks("https://site.example", { fetch: deployment(), identities: OWNERS.slice(0, 1) })).private_isolation,
    "incomplete",
  )
})

test("a header missing on one address fails", async () => {
  const fetch = deployment((u, _i, res) => u.pathname === "/favicon.svg" && res.headers.delete("X-Frame-Options"))
  const r = (await edgeChecks("https://site.example", { fetch })).find((x) => x.check === "headers")
  assert.equal(r.status, "fail")
  assert.deepEqual(r.detail, ["/favicon.svg: X-Frame-Options is null"])
})

test("an authenticated answer a shared cache may keep fails, a refusal included", async () => {
  const fetch = deployment((u, _i, res) => u.pathname === "/api/ops/summary" && res.headers.set("Cache-Control", "public, max-age=60"))
  assert.equal(status(await edgeChecks("https://site.example", { fetch })).private_no_store, "fail")
})

test("a HIT for an authenticated address fails once the edge cache is there", async () => {
  let n = 0
  const fetch = deployment((u, _i, res) => {
    if (!u.pathname.startsWith("/api/admin")) return
    res.headers.set("CF-Cache-Status", n++ === 0 ? "MISS" : "HIT")
  })
  const r = (await edgeChecks("https://site.example", { fetch })).find((x) => x.check === "no_shared_hit")
  assert.equal(r.status, "fail")
  assert.ok(r.detail.length >= 1)
  assert.equal(status(await edgeChecks("https://site.example", { fetch: throughEdge(), identities: OWNERS })).no_shared_hit, "pass")
})

test("workers.dev answering fails; refused passes; unreachable proves nothing (P6-EDGE-1)", async () => {
  const open = deployment()
  const probe = async (fetch) =>
    status(await edgeChecks("https://site.example", { fetch, workersDev: "https://w.example.workers.dev" })).workers_dev_closed
  assert.equal(await probe(open), "fail")
  const answering = (code) => async (input, init) =>
    String(input).includes("workers.dev") ? new Response(null, { status: code }) : open(input, init)
  assert.equal(await probe(answering(403)), "pass")
  // A redirect without a Location to Access proves nothing (a52).
  assert.equal(await probe(answering(302)), "incomplete")
  assert.equal(await probe(answering(502)), "incomplete")
  const unreachable = async (input, init) =>
    String(input).includes("workers.dev") ? Promise.reject(new TypeError("fetch failed")) : open(input, init)
  assert.equal(await probe(unreachable), "incomplete")
})

test("--dev without a working sign-in fails instead of checking less", async () => {
  const fetch = deployment((u, _i, res) => u.pathname === "/__dev/login" && res.headers.delete("Set-Cookie"))
  assert.equal(status(await edgeChecks("https://site.example", { fetch, local: true, dev: true })).private_no_store, "fail")
})

test("behind Access, the service token goes with every request, and never to the workers.dev probe", async () => {
  const seen = []
  const open = deployment()
  const fetch = async (input, init = {}) => {
    seen.push([String(input), new Headers(init.headers).get("CF-Access-Client-Id")])
    return open(input, init)
  }
  await edgeChecks("https://site.example", { fetch, workersDev: "https://w.example.workers.dev", access: { id: "id.access", secret: "s" } })
  assert.ok(seen.filter(([u]) => !u.includes("workers.dev")).every(([, id]) => id === "id.access"))
  assert.deepEqual(
    seen.filter(([u]) => u.includes("workers.dev")).map(([, id]) => id),
    [null],
  )
})

test("each owner's own answer must carry its own marker, and no other's (a52)", async () => {
  const isolation = async (fetch) =>
    (await edgeChecks("https://site.example", { fetch, identities: OWNERS })).find((r) => r.check === "private_isolation")
  assert.equal((await isolation(throughEdge())).status, "pass")
  // Swapped: each reads, at its own address, the other's answer.
  const swapped = await isolation(
    throughEdge(
      (u, _i, res) =>
        res.status === 200 &&
        u.pathname.startsWith("/api/v1/submissions/") &&
        (res.body = res.body.replace(/p_a|p_b/, (m) => (m === "p_a" ? "p_b" : "p_a"))),
    ),
  )
  assert.equal(swapped.status, "fail")
  assert.deepEqual(swapped.detail, [
    "a's own answer didn't carry its marker",
    "a's own answer carried b's marker",
    "b's own answer didn't carry its marker",
    "b's own answer carried a's marker",
  ])
  // A success with nothing of the owner in it.
  const malformed = await isolation(
    throughEdge((u, _i, res) => u.pathname === "/api/v1/submissions/p_b" && res.status === 200 && (res.body = "{}")),
  )
  assert.deepEqual(malformed.detail, ["b's own answer didn't carry its marker"])
  // The report never holds a body or a marker's value beyond the owner's name.
  assert.ok(!JSON.stringify(malformed).includes("marker-p_"))
})

test("against a deployment, two owners must each read their own address with a marker of their own (a52)", async () => {
  const one = [OWNERS[0], { ...OWNERS[1], path: null }]
  const noMarker = [OWNERS[0], { ...OWNERS[1], marker: undefined }]
  const same = [OWNERS[0], { ...OWNERS[1], marker: OWNERS[0].marker }]
  for (const identities of [one, noMarker, same])
    assert.equal(status(await edgeChecks("https://site.example", { fetch: throughEdge(), identities })).private_isolation, "incomplete")
})

test("no shared HIT is shown only by the owners' own probes passing through the edge cache (a52)", async () => {
  // A cache status on other answers, none on the owners' probes: nothing shown about them.
  const others = deployment((u, _i, res) => u.pathname.startsWith("/api/admin") && res.headers.set("CF-Cache-Status", "DYNAMIC"))
  assert.equal(status(await edgeChecks("https://site.example", { fetch: others, identities: OWNERS })).no_shared_hit, "incomplete")
})

test("only a refusal or a redirect to Access proves workers.dev closed (a52)", async () => {
  const open = deployment()
  const probe = async (res) =>
    status(
      await edgeChecks("https://site.example", {
        fetch: async (input, init) => (String(input).includes("workers.dev") ? res() : open(input, init)),
        workersDev: "https://w.example.workers.dev",
      }),
    ).workers_dev_closed
  assert.equal(
    await probe(
      () => new Response(null, { status: 302, headers: { Location: "https://team.cloudflareaccess.com/cdn-cgi/access/login/w" } }),
    ),
    "pass",
  )
  assert.equal(await probe(() => new Response(null, { status: 401 })), "pass")
  assert.equal(await probe(() => new Response(null, { status: 302 })), "incomplete")
  assert.equal(await probe(() => new Response(null, { status: 302, headers: { Location: "https://elsewhere.example/" } })), "incomplete")
  assert.equal(
    await probe(() => new Response(null, { status: 302, headers: { Location: "https://cloudflareaccess.com.evil.example/" } })),
    "incomplete",
  )
  assert.equal(await probe(() => new Response(null, { status: 404 })), "incomplete")
})

test("a named place's share page is held to the deployed version too (a60 with a61)", async () => {
  const fetch = versioned((path) => (path === "/place/car-wall-tkuma" ? "staging-old" : "staging-new"))
  const results = await edgeChecks("https://site.example", { fetch, place: "car-wall-tkuma", expectTag: "staging-new", readiness: FAST })
  assert.equal(status(results).place_page, "pass")
  assert.equal(status(results).deployed_version, "fail")
  assert.match(results.find((r) => r.check === "deployed_version").detail.join(" "), /\/place\/car-wall-tkuma/)
})

// The staging purge exercise (spec 13: "measure the time from purge to fresh content"): a moderator hides a synthetic
// place, the edge's copies of its page and of the feed must turn fresh within seconds, and the hide is lifted again
// whatever happened. It needs a moderator and a synthetic place (EDGE_PURGE), and an edge cache it can see; without
// either it stays incomplete, never passed.
const PURGE_TIMING = { freshMs: 300, deadlineMs: 1200, everyMs: 20 }
const MOD = { "Cf-Access-Jwt-Assertion": "synthetic-moderator" }
/** A deployment behind an edge cache: answers kept per address until purged (by tag) or until `ttlMs` passes. */
function edgeSite({ purgeWorks = true, cached = true, ttlMs = 5000, hideStatus = 200, liftStatus = 200 } = {}) {
  const state = { hidden: false, rev: 3, v: 7, suppressions: [], lifted: [], calls: [] }
  const cache = new Map()
  const origin = (path) => {
    if (path === "/place/syn-place")
      return state.hidden ? { status: 410, body: "gone", tag: "place:syn-place" } : { status: 200, body: "page", tag: "place:syn-place" }
    if (path === "/api/v1/version") return { status: 200, body: JSON.stringify({ v: `0.${state.v}` }), tag: "feed" }
    if (path.startsWith("/api/v1/feed"))
      return { status: 200, body: JSON.stringify({ places: state.hidden ? [] : [{ id: "syn-place" }] }), tag: "feed" }
    return null
  }
  const respond = (status, body, extra = {}) => new Response(body, { status, headers: { "Content-Type": "application/json", ...extra } })
  const fetch = async (input, init = {}) => {
    const u = new URL(input)
    const key = u.pathname + u.search
    const auth = new Headers(init.headers).get("Cf-Access-Jwt-Assertion")
    state.calls.push(`${init.method ?? "GET"} ${u.pathname}`)
    if (u.pathname.startsWith("/api/admin/")) {
      if (auth !== MOD["Cf-Access-Jwt-Assertion"]) return respond(403, "{}")
      if (u.pathname === "/api/admin/places/syn-place")
        return respond(
          200,
          JSON.stringify({
            rev: state.rev,
            suppressions: state.suppressions.filter((s) => !state.lifted.includes(s)).map((id) => ({ id, field: "whole" })),
          }),
        )
      if (u.pathname === "/api/admin/suppressions" && init.method === "POST") {
        if (hideStatus !== 200) return respond(hideStatus, "{}")
        state.hidden = true
        state.rev++
        state.v++
        state.suppressions.push(`s_${state.suppressions.length}`)
        if (purgeWorks) for (const [k, c] of cache) if (c.tag === "feed" || c.tag === "place:syn-place") cache.delete(k)
        return respond(200, JSON.stringify({ ok: true }))
      }
      const lift = /^\/api\/admin\/suppressions\/(s_\d+)\/lift$/.exec(u.pathname)
      if (lift && init.method === "POST") {
        if (liftStatus !== 200) return respond(liftStatus, "{}")
        state.lifted.push(lift[1])
        state.hidden = false
        state.rev++
        state.v++
        if (purgeWorks) for (const [k, c] of cache) if (c.tag === "feed" || c.tag === "place:syn-place") cache.delete(k)
        return respond(200, JSON.stringify({ ok: true }))
      }
    }
    const o = origin(u.pathname)
    if (!o) return deployment()(input, init)
    const hit = cached && cache.get(key)
    if (hit && Date.now() - hit.at < ttlMs) return respond(hit.status, hit.body, { "CF-Cache-Status": "HIT" })
    if (cached) cache.set(key, { ...o, at: Date.now() })
    return respond(o.status, o.body, cached ? { "CF-Cache-Status": "MISS" } : {})
  }
  return { fetch, state }
}
const PURGE = { place: "syn-place", moderator: { headers: MOD } }

test("the purge exercise passes when a hide reaches the page and the feed within seconds, and lifts its hide (spec 13)", async () => {
  const site = edgeSite()
  const results = await edgeChecks("https://site.example", { fetch: site.fetch, purge: PURGE, purgeTiming: PURGE_TIMING })
  const r = results.find((x) => x.check === "purge_freshness")
  assert.equal(r.status, "pass", JSON.stringify(r))
  assert.match(r.detail, /page fresh after \d+ ms, feed after \d+ ms/)
  assert.equal(site.state.hidden, false)
  assert.deepEqual(site.state.lifted, ["s_0"])
})

test("a purge that doesn't take fails once the bound passes, and the hide is still lifted (spec 13)", async () => {
  const site = edgeSite({ purgeWorks: false })
  const results = await edgeChecks("https://site.example", { fetch: site.fetch, purge: PURGE, purgeTiming: PURGE_TIMING })
  const r = results.find((x) => x.check === "purge_freshness")
  assert.equal(r.status, "fail")
  assert.match(r.detail.join(" "), /still served|not fresh/)
  assert.deepEqual(site.state.lifted, ["s_0"])
  assert.equal(outcome(results), "fail")
})

test("the purge exercise is incomplete without a moderator and a synthetic place, or without an edge cache to see (spec 13)", async () => {
  const none = await edgeChecks("https://site.example", { fetch: edgeSite().fetch })
  assert.equal(status(none).purge_freshness, "incomplete")
  const uncached = edgeSite({ cached: false })
  const r = (await edgeChecks("https://site.example", { fetch: uncached.fetch, purge: PURGE, purgeTiming: PURGE_TIMING })).find(
    (x) => x.check === "purge_freshness",
  )
  assert.equal(r.status, "incomplete")
  assert.match(r.detail, /edge cache/)
  // Nothing was hidden when nothing could be measured.
  assert.ok(!uncached.state.calls.some((c) => c.startsWith("POST")))
})

test("a hide the deployment refuses, or a lift it refuses, fails the exercise (spec 13)", async () => {
  const refused = await edgeChecks("https://site.example", {
    fetch: edgeSite({ hideStatus: 403 }).fetch,
    purge: PURGE,
    purgeTiming: PURGE_TIMING,
  })
  assert.equal(status(refused).purge_freshness, "fail")
  const stuck = edgeSite({ liftStatus: 409 })
  const r = (await edgeChecks("https://site.example", { fetch: stuck.fetch, purge: PURGE, purgeTiming: PURGE_TIMING })).find(
    (x) => x.check === "purge_freshness",
  )
  assert.equal(r.status, "fail")
  assert.match(r.detail.join(" "), /stays hidden/)
})

test("the exercise's own answers are held to the deployed version too", async () => {
  const site = edgeSite()
  const fetch = async (input, init) => {
    const res = await site.fetch(input, init)
    const path = new URL(input).pathname
    const r = new Response(res.body, res)
    if (/^\/(api|place|media|__dev)\//.test(path))
      r.headers.set("X-Worker-Version", /^\/api\/admin\/(places\/syn-place|suppressions)/.test(path) ? "staging-old" : "staging-new")
    return r
  }
  const results = await edgeChecks("https://site.example", {
    fetch,
    purge: PURGE,
    purgeTiming: PURGE_TIMING,
    expectTag: "staging-new",
    readiness: FAST,
  })
  assert.equal(status(results).deployed_version, "fail")
  assert.match(results.find((r) => r.check === "deployed_version").detail.join(" "), /\/api\/admin\/suppressions/)
})

test("an EDGE_PURGE in a shape no exercise can use is refused before anything is asked", async () => {
  for (const purge of [
    {},
    { place: "local-1", moderator: { headers: MOD } },
    { place: "syn-place" },
    { place: "syn-place", moderator: { headers: { a: 1 } } },
  ])
    await assert.rejects(edgeChecks("https://site.example", { fetch: deployment(), purge }), /EDGE_PURGE/, JSON.stringify(purge))
})
