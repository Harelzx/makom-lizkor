// node --test scripts/edge-check.test.mjs
// The edge check's own rules, against a stand-in deployment: it must catch a wrong answer, a missing header, a cacheable
// authenticated answer, a shared HIT and one owner's private answer reaching another. Where it can't see, it says
// "incomplete" against a real deployment (which never qualifies a release), and "skip" only in the explicit local mode.
import assert from "node:assert/strict"
import { test } from "node:test"
import { CSP, SECURITY_HEADERS } from "../worker/lib/security-headers.ts"
import { edgeChecks, outcome } from "./edge-check.mjs"
import { REQUIRED_CHECKS, stagingEvidenceProblems } from "./staging-evidence.mjs"
import { receiptFor } from "./staging-receipt.mjs"

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
const PURGE_TIMING = { freshMs: 300, deadlineMs: 1200, everyMs: 20, edgeTtlMs: 5000, requestMs: 150, cleanupMs: 500 }
const MOD = { "Cf-Access-Jwt-Assertion": "synthetic-moderator" }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
/** A public place as the feed carries it (src/shared/contract.ts PublicPlace): the fields both kinds share. */
const PLACE_ROW = {
  id: "syn-place",
  kind: "bench",
  name_he: "ספסל סינתטי",
  lat: 31.42,
  lng: 34.49,
  precision: "exact",
  place_he: "בארי",
  summary_he: "ספסל סינתטי לבדיקת הקצה, לא מקום אמיתי.",
}
const OTHER_ROW = { ...PLACE_ROW, id: "other-place", name_he: "מקום סינתטי אחר" }
/** The synthetic place's own share image and photo, as its page and the feed name them. */
const SYN_OG = `/media/og/syn-place/${"a".repeat(64)}.png`
const SYN_PHOTO = "/media/public/syn-place/photo.jpg"
/** One of the site's own places, as the feed carries it (src/shared/curated.ts PublicCurated). */
const CURATED_ROW = {
  ...PLACE_ROW,
  id: "curated-place",
  kind: "community",
  name_he: "קהילה סינתטית",
  curated: { links: [], coord_source: "manual", region: "envelope", photos: [] },
}
/** A contribution with every optional field it may carry. */
const RICH_ROW = {
  ...PLACE_ROW,
  id: "rich-place",
  in_memory_of: "לזכר מישהו",
  link_url: "https://example.org/x",
  access_note: "בתיאום מראש",
  photo: { url: "/media/public/p_x.webp", alt: "ספסל", credit: "צלם" },
}
/**
 * A deployment behind an edge cache, as the Worker and Workers Caching behave: each address (its path and query, as
 * the cache key) kept until purged by tag or until its TTL passes (the version's own is shorter in the Worker: 10 s
 * against 60 s); the feed at an old version answers 409 stale_version, no-store, uncached. The options stand in for
 * what a real edge or Worker may do instead: a purge that doesn't take; entries already aged (a cache that keys by
 * path only); a hide answered late, or committed with its answer lost; an error after the hide; an admin view that
 * fails; a request that never answers; another moderator's hide on the same place meanwhile.
 */
function edgeSite({
  purgeWorks = true,
  cached = true,
  ttlMs = 5000,
  versionTtlMs = ttlMs,
  ignoreQuery = false,
  preAgedMs = 0,
  hideStatus = 200,
  hideDelayMs = 0,
  hideLost = false,
  liftStatus = 200,
  liftNoop = false,
  viewDelayMs = 0,
  versionAnswer = null,
  extraRow = null,
  viewAfterHide = null,
  feedAfterHide = null,
  stall = null,
  otherHide = false,
  // The place's own media: the share image its page names and the photo the feed gives; and a route that keeps
  // serving them after the hide.
  media = false,
  staleMedia = false,
} = {}) {
  const state = { rev: 3, v: 7, hiddenOnce: false, suppressions: [], calls: [] }
  const cache = new Map()
  // Another row the feed carries throughout, before and after the hide.
  const extra = extraRow ? [extraRow] : []
  const active = () => state.suppressions.filter((s) => !s.lifted)
  const html = { "Content-Type": "text/html" }
  const json = { "Content-Type": "application/json" }
  const row = media ? { ...PLACE_ROW, photo: { url: SYN_PHOTO, alt: "ספסל סינתטי" } } : PLACE_ROW
  const page = media
    ? `<!doctype html><meta property="og:image" content="https://site.example${SYN_OG}"><p>page</p>`
    : "<!doctype html><p>page</p>"
  const origin = (path, v) => {
    if (path === "/place/syn-place")
      return active().some((s) => s.field === "whole")
        ? { status: 410, body: "gone", headers: html, tag: "place:syn-place" }
        : { status: 200, body: page, headers: html, tag: "place:syn-place" }
    if (media && (path === SYN_OG || path === SYN_PHOTO))
      return active().some((s) => s.field === "whole") && !staleMedia
        ? { status: 404, body: JSON.stringify({ code: "not_found" }), headers: json, tag: "place:syn-place" }
        : { status: 200, body: "image", headers: { "Content-Type": path === SYN_OG ? "image/png" : "image/jpeg" }, tag: "place:syn-place" }
    if (path === "/api/v1/version")
      return versionAnswer
        ? { headers: json, ...versionAnswer, uncached: true }
        : { status: 200, body: JSON.stringify({ v: `0.${state.v}` }), headers: json, tag: "feed" }
    if (path === "/api/v1/feed") {
      if (feedAfterHide && state.hiddenOnce) return { headers: {}, ...feedAfterHide, uncached: true }
      return v === `0.${state.v}`
        ? {
            status: 200,
            body: JSON.stringify({
              v,
              places: active().some((s) => s.field === "whole") ? [OTHER_ROW, ...extra] : [row, OTHER_ROW, ...extra],
            }),
            headers: json,
            tag: "feed",
          }
        : {
            status: 409,
            body: JSON.stringify({ code: "stale_version", v: `0.${state.v}` }),
            headers: { ...json, "Cache-Control": "no-store" },
            uncached: true,
          }
    }
    return null
  }
  const keyOf = (u) => (ignoreQuery ? u.pathname : u.pathname + u.search)
  // purgeWorks "feed": only the feed's tag is purged, the page's isn't.
  const purgeTags = () => {
    const tags = purgeWorks === "feed" ? ["feed"] : purgeWorks ? ["feed", "place:syn-place"] : []
    for (const [k, c] of cache) if (tags.includes(c.tag)) cache.delete(k)
  }
  // Entries that were already there, near the end of their life, before the exercise came.
  if (preAgedMs)
    for (const path of ["/place/syn-place", "/api/v1/feed"]) {
      const u = new URL(path, "https://site.example")
      cache.set(keyOf(u), { ...origin(path, `0.${state.v}`), at: Date.now() - preAgedMs })
    }
  const respond = (status, body, headers = {}) => new Response(body, { status, headers: { ...json, ...headers } })
  const fetch = async (input, init = {}) => {
    const u = new URL(input)
    const auth = new Headers(init.headers).get("Cf-Access-Jwt-Assertion")
    state.calls.push(`${init.method ?? "GET"} ${u.pathname}`)
    // A request that never answers: only its own bound ends it.
    if (stall?.(u.pathname, state))
      return new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal.reason)))
    if (u.pathname.startsWith("/api/admin/")) {
      if (auth !== MOD["Cf-Access-Jwt-Assertion"]) return respond(403, "{}")
      if (u.pathname === "/api/admin/places/syn-place") {
        if (viewAfterHide && state.hiddenOnce) return respond(viewAfterHide.status, viewAfterHide.body)
        // The moderator's view is slow to come before the hide (a cold database, a busy Access).
        if (viewDelayMs && !state.hiddenOnce) await sleep(viewDelayMs)
        return respond(
          200,
          JSON.stringify({ rev: state.rev, suppressions: active().map(({ id, field, reason }) => ({ id, field, reason })) }),
        )
      }
      if (u.pathname === "/api/admin/suppressions" && init.method === "POST") {
        const body = JSON.parse(init.body)
        if (hideStatus !== 200) return respond(hideStatus, "{}")
        if (body.expectedRev !== state.rev) return respond(409, JSON.stringify({ code: "changed_meanwhile" }))
        state.suppressions.push({ id: `s_${state.suppressions.length}`, field: "whole", reason: body.reason, lifted: false })
        state.hiddenOnce = true
        state.rev++
        state.v++
        if (otherHide) {
          state.suppressions.push({ id: "s_other", field: "photo", reason: "הסתרה של מנחה אחר", lifted: false })
          state.rev++
          state.v++
        }
        purgeTags()
        // Committed, and then the answer never arrives, or arrives late.
        if (hideLost) throw new TypeError("fetch failed")
        if (hideDelayMs) await sleep(hideDelayMs)
        return respond(200, JSON.stringify({ ok: true }))
      }
      const lift = /^\/api\/admin\/suppressions\/(s_\w+)\/lift$/.exec(u.pathname)
      if (lift && init.method === "POST") {
        if (liftStatus !== 200) return respond(liftStatus, "{}")
        // Says it lifted, and didn't.
        if (liftNoop) return respond(200, JSON.stringify({ ok: true }))
        if (JSON.parse(init.body).expectedRev !== state.rev) return respond(409, JSON.stringify({ code: "changed_meanwhile" }))
        const s = active().find((x) => x.id === lift[1])
        if (!s) return respond(404, "{}")
        s.lifted = true
        state.rev++
        state.v++
        purgeTags()
        return respond(200, JSON.stringify({ ok: true }))
      }
    }
    const o = origin(u.pathname, u.searchParams.get("v"))
    if (!o) return deployment()(input, init)
    const key = keyOf(u)
    const hit = cached && cache.get(key)
    const ttl = u.pathname === "/api/v1/version" ? versionTtlMs : ttlMs
    if (hit && Date.now() - hit.at < ttl) return respond(hit.status, hit.body, { ...hit.headers, "CF-Cache-Status": "HIT" })
    if (cached && !o.uncached) cache.set(key, { ...o, at: Date.now() })
    return respond(o.status, o.body, { ...o.headers, ...(cached && !o.uncached ? { "CF-Cache-Status": "MISS" } : {}) })
  }
  return { fetch, state, owned: () => state.suppressions.filter((s) => s.id !== "s_other") }
}
const PURGE = { place: "syn-place", moderator: { headers: MOD } }

test("the purge exercise passes when a hide reaches the page and the feed within seconds, and lifts its hide (spec 13)", async () => {
  const site = edgeSite()
  const results = await edgeChecks("https://site.example", { fetch: site.fetch, purge: PURGE, purgeTiming: PURGE_TIMING })
  const r = results.find((x) => x.check === "purge_freshness")
  assert.equal(r.status, "pass", JSON.stringify(r))
  assert.match(r.detail, /page fresh after \d+ ms, feed after \d+ ms/)
  assert.deepEqual(
    site.owned().map((s) => [s.id, s.lifted]),
    [["s_0", true]],
  )
})

test("a purge that doesn't take fails once the bound passes, and the hide is still lifted (spec 13)", async () => {
  const site = edgeSite({ purgeWorks: false })
  const results = await edgeChecks("https://site.example", { fetch: site.fetch, purge: PURGE, purgeTiming: PURGE_TIMING })
  const r = results.find((x) => x.check === "purge_freshness")
  assert.equal(r.status, "fail")
  assert.match(r.detail.join(" "), /still served|not fresh/)
  assert.deepEqual(
    site.owned().map((s) => [s.id, s.lifted]),
    [["s_0", true]],
  )
  assert.equal(outcome(results), "fail")
})

test("an unpurged feed fails even once the version's own short TTL has turned it over: the warmed address is watched", async () => {
  // The version answer expires well inside the bound, so a fresh read of the version names a new, uncached feed: that
  // is the TTL at work, not a purge. Only the address the edge was holding shows whether the purge reached it.
  const site = edgeSite({ purgeWorks: false, versionTtlMs: 50 })
  const results = await edgeChecks("https://site.example", { fetch: site.fetch, purge: PURGE, purgeTiming: PURGE_TIMING })
  const r = results.find((x) => x.check === "purge_freshness")
  assert.equal(r.status, "fail", JSON.stringify(r))
  assert.match(r.detail.join(" "), /the feed (still served|was not fresh)/)
  assert.deepEqual(
    site.owned().map((s) => [s.id, s.lifted]),
    [["s_0", true]],
  )
})

const purgeOf = async (site, timing = PURGE_TIMING) =>
  (await edgeChecks("https://site.example", { fetch: site.fetch, purge: PURGE, purgeTiming: timing })).find(
    (x) => x.check === "purge_freshness",
  )
const liftedAll = (site) => site.owned().length > 0 && site.owned().every((s) => s.lifted)

test("after the hide, only a genuine fresh feed counts: errors, refusals, redirects and malformed answers never do (STG-PURGE-RESPONSE-1)", async () => {
  const stale = (v, headers = { "Cache-Control": "no-store" }) => ({
    status: 409,
    body: JSON.stringify({ code: "stale_version", v }),
    headers,
  })
  for (const [what, answer] of [
    ["a Worker error naming the version", { status: 503, body: JSON.stringify({ code: "unavailable", v: "0.8" }) }],
    ["Access's sign-in page", { status: 403, body: "<html>sign in</html>", headers: { "Content-Type": "text/html" } }],
    ["a redirect", { status: 302, body: "", headers: { Location: "/cdn-cgi/access/login" } }],
    ["a body that isn't JSON", { status: 200, body: "<html>oops</html>" }],
    ["a feed without its places", { status: 200, body: JSON.stringify({ v: "0.7" }) }],
    ["a 409 that names the same version", stale("0.7")],
    ["a 409 the edge may keep", stale("0.8", {})],
  ]) {
    const site = edgeSite({ feedAfterHide: answer })
    const r = await purgeOf(site)
    assert.equal(r.status, "fail", `${what}: ${JSON.stringify(r)}`)
    assert.match(r.detail.join(" "), /the feed/, what)
    assert.ok(liftedAll(site), what)
  }
})

test("entries the edge already held, near their end, can't pass through expiry: the run's own addresses must be new (STG-PURGE-TIMING-1)", async () => {
  // A cache that ignores the query serves what was there before; with purge broken, those entries would expire
  // inside the bound and look like a purge.
  const site = edgeSite({ purgeWorks: false, ignoreQuery: true, preAgedMs: 4850 })
  const r = await purgeOf(site)
  assert.equal(r.status, "incomplete", JSON.stringify(r))
  assert.match(r.detail, /edge cache/)
  assert.ok(!site.state.calls.some((c) => c.startsWith("POST")), "nothing is hidden when nothing can be told apart")
})

test("a hide answered late can't pass through expiry: freshness is timed from the hide's dispatch (STG-PURGE-TIMING-1)", async () => {
  // The entries live 450 ms; the hide is committed at once and answered 350 ms later; purge is broken. Timed from the
  // answer, expiry would look fresh within 100 ms.
  const site = edgeSite({ purgeWorks: false, ttlMs: 450, hideDelayMs: 350 })
  const r = await purgeOf(site, { ...PURGE_TIMING, edgeTtlMs: 450 })
  assert.equal(r.status, "fail", JSON.stringify(r))
  assert.ok(liftedAll(site))
})

test("a window longer than the entries' life is incomplete, and nothing is hidden (STG-PURGE-TIMING-1)", async () => {
  const site = edgeSite({ ttlMs: 200 })
  const r = await purgeOf(site, { ...PURGE_TIMING, edgeTtlMs: 200 })
  assert.equal(r.status, "incomplete", JSON.stringify(r))
  assert.ok(!site.state.calls.some((c) => c.startsWith("POST")))
})

test("a hide committed with its answer lost is found by this run's marker and lifted (STG-PURGE-CLEANUP-1)", async () => {
  const site = edgeSite({ hideLost: true })
  const r = await purgeOf(site)
  assert.equal(r.status, "fail", JSON.stringify(r))
  assert.match(r.detail.join(" "), /edge-purge:[0-9a-f]+/)
  assert.ok(liftedAll(site), JSON.stringify(site.state.suppressions))
})

test("another moderator's hide on the same place is left as it was; only this run's is lifted (STG-PURGE-CLEANUP-1)", async () => {
  const site = edgeSite({ otherHide: true })
  const r = await purgeOf(site)
  assert.equal(r.status, "pass", JSON.stringify(r))
  assert.ok(liftedAll(site))
  assert.equal(site.state.suppressions.find((s) => s.id === "s_other").lifted, false)
})

test("an admin view that fails or is malformed is never taken for a clean lift (STG-PURGE-CLEANUP-1)", async () => {
  for (const view of [
    { status: 500, body: "{}" },
    { status: 200, body: "{}" },
    { status: 200, body: "not json" },
    { status: 200, body: JSON.stringify({ rev: 5, suppressions: "none" }) },
  ]) {
    const site = edgeSite({ viewAfterHide: view })
    const r = await purgeOf(site)
    assert.equal(r.status, "fail", JSON.stringify(r))
    // The failure says which place and which hide to look for, and nothing secret.
    assert.match(
      r.detail.join(" "),
      /unresolved[^]*edge-purge:[0-9a-f]+[^]*syn-place|syn-place[^]*edge-purge:[0-9a-f]+[^]*unresolved/,
      JSON.stringify(view),
    )
    assert.doesNotMatch(JSON.stringify(r), /synthetic-moderator/)
  }
})

test("a request that never answers is bounded, and the hide is still lifted (STG-PURGE-CLEANUP-1)", { timeout: 10_000 }, async () => {
  const site = edgeSite({ stall: (path, s) => path === "/api/v1/feed" && s.hiddenOnce })
  const r = await purgeOf(site)
  assert.equal(r.status, "fail", JSON.stringify(r))
  assert.match(r.detail.join(" "), /the feed/)
  assert.ok(liftedAll(site))
})

test(
  "a lift that never answers is bounded, and reported unresolved with the place and the marker (STG-PURGE-CLEANUP-1)",
  { timeout: 10_000 },
  async () => {
    const site = edgeSite({ stall: (path) => /\/lift$/.test(path) })
    const r = await purgeOf(site)
    assert.equal(r.status, "fail", JSON.stringify(r))
    assert.match(r.detail.join(" "), /unresolved[^]*edge-purge:[0-9a-f]+[^]*syn-place/)
  },
)

test("malformed feed data and versions are never fresh, and the version must answer (STG-PURGE-RESPONSE-1)", async () => {
  for (const [what, answer] of [
    ["a feed whose rows aren't places", { status: 200, body: JSON.stringify({ v: "0.7", places: [null] }) }],
    ["a feed with a row missing its fields", { status: 200, body: JSON.stringify({ v: "0.7", places: [{ id: "other-place" }] }) }],
    [
      "a stale_version naming no version",
      { status: 409, body: JSON.stringify({ code: "stale_version", v: "garbage" }), headers: { "Cache-Control": "no-store" } },
    ],
  ]) {
    const site = edgeSite({ feedAfterHide: answer })
    const r = await purgeOf(site)
    assert.equal(r.status, "fail", `${what}: ${JSON.stringify(r)}`)
    assert.ok(liftedAll(site), what)
  }
  for (const [what, answer] of [
    ["an unsuccessful version answer", { status: 503, body: JSON.stringify({ v: "0.7" }) }],
    ["a version that isn't epoch.n", { status: 200, body: JSON.stringify({ v: "garbage" }) }],
  ]) {
    const site = edgeSite({ versionAnswer: answer })
    const r = await purgeOf(site)
    assert.equal(r.status, "fail", `${what}: ${JSON.stringify(r)}`)
    assert.ok(!site.state.calls.some((c) => c.startsWith("POST")), what)
  }
})

test("a valid feed without the place, after the hide, is fresh (STG-PURGE-RESPONSE-1)", async () => {
  const site = edgeSite({ feedAfterHide: { status: 200, body: JSON.stringify({ v: "0.7", places: [OTHER_ROW] }) } })
  const r = await purgeOf(site)
  assert.equal(r.status, "pass", JSON.stringify(r))
})

test("a slow moderator view before the hide leaves too little life: incomplete, nothing hidden, even with the page's purge broken (STG-PURGE-TIMING-1)", async () => {
  // Entries live 600 ms; the bound is 300; the view takes 400. At warm-up there was room; at the hide there isn't, and
  // the page (its purge broken) would expire 200 ms after the hide and look purged.
  const site = edgeSite({ purgeWorks: "feed", ttlMs: 600, viewDelayMs: 400 })
  const r = await purgeOf(site, { ...PURGE_TIMING, edgeTtlMs: 600, requestMs: 1000 })
  assert.equal(r.status, "incomplete", JSON.stringify(r))
  assert.ok(!site.state.calls.some((c) => c.startsWith("POST")))
})

test(
  "a lift that says 200 but leaves the hide active ends within the cleanup budget, unresolved, and touches nothing else (STG-PURGE-CLEANUP-1)",
  { timeout: 10_000 },
  async () => {
    const site = edgeSite({ liftNoop: true, otherHide: true })
    const started = Date.now()
    const r = await purgeOf(site)
    assert.ok(Date.now() - started < 5000)
    assert.equal(r.status, "fail", JSON.stringify(r))
    assert.match(r.detail.join(" "), /unresolved[^]*edge-purge:[0-9a-f]+[^]*syn-place/)
    assert.equal(site.state.suppressions.find((s) => s.id === "s_other").lifted, false)
  },
)

// What the browser's own Feed.parse refuses (src/lib/feed.ts) is never a feed here, warm or measured.
const BAD_ROWS = [
  ["an unknown kind", { ...OTHER_ROW, kind: "bogus" }],
  ["a contribution's photo that isn't one", { ...OTHER_ROW, photo: null }],
  ["a contribution's photo without its fields", { ...OTHER_ROW, photo: { url: 1 } }],
  ["a curated-only kind without its curated data", { ...OTHER_ROW, kind: "community" }],
  ["a curated place with malformed curated data", { ...CURATED_ROW, curated: { ...CURATED_ROW.curated, coord_source: "gps" } }],
]

test("a feed row the public place schema refuses fails the exercise, warm (nothing hidden) or measured (the hide lifted) (STG-PURGE-RESPONSE-1)", async () => {
  for (const [what, row] of BAD_ROWS) {
    const warm = edgeSite({ extraRow: row })
    const w = await purgeOf(warm)
    assert.equal(w.status, "fail", `warm, ${what}: ${JSON.stringify(w)}`)
    assert.ok(!warm.state.calls.some((c) => c.startsWith("POST")), `warm, ${what}`)
    const measured = edgeSite({ feedAfterHide: { status: 200, body: JSON.stringify({ v: "0.7", places: [row] }) } })
    const m = await purgeOf(measured)
    assert.equal(m.status, "fail", `measured, ${what}: ${JSON.stringify(m)}`)
    assert.ok(liftedAll(measured), `measured, ${what}`)
  }
})

test("valid contributions with their optional fields and valid curated places are feeds, warm and measured (STG-PURGE-RESPONSE-1)", async () => {
  for (const extraRow of [RICH_ROW, CURATED_ROW]) {
    // Warm with the row, then the genuine uncached 409.
    const r = await purgeOf(edgeSite({ extraRow }))
    assert.equal(r.status, "pass", `${extraRow.id}: ${JSON.stringify(r)}`)
  }
  const measured = await purgeOf(
    edgeSite({ feedAfterHide: { status: 200, body: JSON.stringify({ v: "0.7", places: [OTHER_ROW, RICH_ROW, CURATED_ROW] }) } }),
  )
  assert.equal(measured.status, "pass", JSON.stringify(measured))
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
  assert.match(r.detail.join(" "), /unresolved[^]*may stay hidden/)
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

test("the purge exercise moderates with its own Access pair; every other probe goes with the deployment's, and workers.dev with none (H1-PROBE-IDENTITY-1)", async () => {
  const site = edgeSite()
  const seen = []
  const fetch = async (input, init = {}) => {
    const u = new URL(input)
    const h = new Headers(init.headers)
    seen.push({ host: u.host, path: u.pathname, id: h.get("CF-Access-Client-Id"), secret: h.get("CF-Access-Client-Secret") })
    return site.fetch(input, init)
  }
  const moderator = {
    headers: { ...MOD, "CF-Access-Client-Id": "staging-moderator.access", "CF-Access-Client-Secret": "moderator-secret" },
  }
  const results = await edgeChecks("https://site.example", {
    fetch,
    access: { id: "deploy.access", secret: "deploy-secret" },
    workersDev: "https://w.example.workers.dev",
    purge: { place: "syn-place", moderator },
    purgeTiming: PURGE_TIMING,
  })
  assert.equal(status(results).purge_freshness, "pass", JSON.stringify(results.find((r) => r.check === "purge_freshness")))
  const admin = seen.filter((s) => s.host === "site.example" && s.path.startsWith("/api/admin/places/syn-place"))
  const mutations = seen.filter((s) => s.host === "site.example" && /^\/api\/admin\/suppressions/.test(s.path))
  assert.ok(admin.length > 0 && mutations.length >= 2, "views, the hide and the lift were made")
  for (const s of [...admin, ...mutations]) assert.deepEqual([s.id, s.secret], ["staging-moderator.access", "moderator-secret"], s.path)
  const ordinary = seen.filter(
    (s) => s.host === "site.example" && !s.path.startsWith("/api/admin/places/syn-place") && !/^\/api\/admin\/suppressions/.test(s.path),
  )
  assert.ok(ordinary.length > 0)
  for (const s of ordinary) assert.deepEqual([s.id, s.secret], ["deploy.access", "deploy-secret"], s.path)
  const closed = seen.filter((s) => s.host === "w.example.workers.dev")
  assert.ok(closed.length > 0)
  for (const s of closed) assert.deepEqual([s.id, s.secret], [null, null], s.path)
})

test("an EDGE_PURGE moderator with half an Access pair is refused before anything is asked", async () => {
  for (const half of [{ "CF-Access-Client-Id": "x.access" }, { "cf-access-client-secret": "s" }])
    await assert.rejects(
      edgeChecks("https://site.example", {
        fetch: deployment(),
        purge: { place: "syn-place", moderator: { headers: { ...MOD, ...half } } },
      }),
      /EDGE_PURGE/,
    )
})

// The production purge probe (L-PURGE; a73, Q2): production has no synthetic place to hide, so its purge_freshness is
// shown by a content-free generation the edge keeps under its own tag. The run warms its own address (MISS, then HIT),
// moves the generation with the probe's own token, and must see the new one within the bound, timed from dispatch;
// the edge locations are recorded. Natural expiry never counts, a retry never moves twice, and nothing else is touched.
const PROBE = { headers: { "CF-Access-Client-Id": "probe-id.access", "CF-Access-Client-Secret": "probe-secret" } }
/**
 * A deployment with the probe behind an edge cache, as the Worker (worker/routes/purge-probe.ts) and Workers Caching
 * behave. The options stand in for what may go wrong: a purge that doesn't take, no cache, entries already aged, a
 * move whose answer is lost, purges the edge refuses (503 purge_failed) a number of times, a refused token, another
 * exercise moving the generation first, an invalid answer after the move.
 */
function probeSite({
  purgeWorks = true,
  cached = true,
  ttlMs = 5000,
  ignoreQuery = false,
  preAgedMs = 0,
  loseFirstAnswer = false,
  refusePurges = 0,
  tokenOk = true,
  movedByOther = false,
  invalidAfterMove = false,
  // Which edge location answers the nth read of the probe's address (each keeps its own cache), whether the purge
  // reaches a location, whether the answer names its location at all, and another exercise moving right after ours.
  coloOf = () => "TLV",
  purgeReaches = () => true,
  noRay = false,
  movedByOtherAfter = false,
  // Another exercise moving the generation on once this many ms have passed since our move (and clearing every copy).
  otherMovesAfterMs = null,
} = {}) {
  const state = { generation: 4, exercise: null, moves: 0, purges: 0, posts: [], reads: 0 }
  const cache = new Map()
  const json = { "Content-Type": "application/json" }
  const respond = (status, body, headers = {}) => new Response(body, { status, headers: { ...json, ...headers } })
  const keyOf = (u) => (ignoreQuery ? u.pathname : u.pathname + u.search)
  const origin = () =>
    invalidAfterMove && state.moves
      ? { status: 200, body: "<html>not the probe</html>" }
      : { status: 200, body: JSON.stringify({ generation: state.generation }) }
  if (preAgedMs)
    cache.set(`TLV ${keyOf(new URL("/api/v1/purge-probe?run=x", "https://site.example"))}`, { ...origin(), at: Date.now() - preAgedMs })
  let answersLost = 0
  const fetch = async (input, init = {}) => {
    const u = new URL(input)
    if (u.pathname === "/api/ops/purge-probe" && init.method === "POST") {
      const h = new Headers(init.headers)
      state.posts.push({ id: h.get("CF-Access-Client-Id"), secret: h.get("CF-Access-Client-Secret") })
      if (!tokenOk || h.get("CF-Access-Client-Id") !== PROBE.headers["CF-Access-Client-Id"]) return respond(403, "{}")
      const { exercise, expected } = JSON.parse(init.body)
      if (movedByOther && !state.moves) {
        state.generation++
        state.moves++
      }
      const replay = state.exercise === exercise && state.generation === expected + 1
      if (!replay) {
        if (state.generation !== expected) return respond(409, JSON.stringify({ code: "changed_meanwhile" }))
        state.generation++
        state.exercise = exercise
        state.moves++
      }
      if (state.purges < refusePurges) {
        state.purges++
        return respond(503, JSON.stringify({ code: "purge_failed", generation: expected + 1 }))
      }
      state.purges++
      state.movedAt ??= Date.now()
      if (purgeWorks) for (const k of [...cache.keys()]) if (purgeReaches(k.split(" ")[0])) cache.delete(k)
      if (movedByOtherAfter && !replay) {
        state.generation++
        state.moves++
        cache.clear()
      }
      if (loseFirstAnswer && !answersLost++) throw new TypeError("fetch failed")
      return respond(200, JSON.stringify({ generation: expected + 1, purged: true }))
    }
    if (u.pathname !== "/api/v1/purge-probe") return deployment()(input, init)
    if (otherMovesAfterMs !== null && state.movedAt && !state.otherMoved && Date.now() - state.movedAt >= otherMovesAfterMs) {
      state.generation++
      state.moves++
      state.otherMoved = true
      cache.clear()
    }
    const colo = coloOf(state.reads++)
    const key = `${colo} ${keyOf(u)}`
    const hit = cached && cache.get(key)
    const ray = noRay ? {} : { "CF-Ray": `8c0ffee000000000-${colo}` }
    if (hit && Date.now() - hit.at < ttlMs) return respond(hit.status, hit.body, { ...ray, "CF-Cache-Status": "HIT" })
    const o = origin()
    if (cached) cache.set(key, { ...o, at: Date.now() })
    return respond(o.status, o.body, { ...ray, ...(cached ? { "CF-Cache-Status": "MISS" } : {}) })
  }
  return { fetch, state }
}
const probeOf = async (site, extra = {}) =>
  (
    await edgeChecks("https://site.example", { fetch: site.fetch, probe: PROBE, probeFreshness: true, purgeTiming: PURGE_TIMING, ...extra })
  ).find((x) => x.check === "purge_freshness")

test("production's purge_freshness: the probe's own address turns to the new generation within the bound (L-PURGE)", async () => {
  const site = probeSite()
  const r = await probeOf(site, { access: { id: "deploy-id.access", secret: "deploy-secret" } })
  assert.equal(r.status, "pass", JSON.stringify(r))
  assert.match(r.detail, /content-free probe at TLV: generation 4 → 5, fresh after \d+ ms from the move's dispatch/)
  assert.equal(site.state.moves, 1)
  // The probe's own Access pair, whole; never the deployment's.
  assert.deepEqual(site.state.posts, [{ id: "probe-id.access", secret: "probe-secret" }])
})

test("a probe purge that doesn't take fails once the bound passes, expiry notwithstanding", async () => {
  const r = await probeOf(probeSite({ purgeWorks: false }))
  assert.equal(r.status, "fail")
  assert.match(r.detail.join(" "), /still served generation 4|not fresh until/)
})

test("without an edge cache to see, or with entries too near their end, the probe moves nothing and stays incomplete", async () => {
  for (const site of [probeSite({ cached: false }), probeSite({ ignoreQuery: true, preAgedMs: 4850 })]) {
    const r = await probeOf(site)
    assert.equal(r.status, "incomplete", JSON.stringify(r))
    assert.match(r.detail, /didn't store this run's own address afresh|would expire within the bound/)
    assert.equal(site.state.moves, 0)
  }
})

test("a move whose answer is lost is sent again as the same exercise: it moves once and purges again", async () => {
  const site = probeSite({ loseFirstAnswer: true })
  const r = await probeOf(site)
  assert.equal(r.status, "pass", JSON.stringify(r))
  assert.equal(site.state.moves, 1)
  assert.equal(site.state.purges, 2)
})

test("a purge the edge refuses is retried as the same exercise; refused every time, the probe fails", async () => {
  const once = probeSite({ refusePurges: 1 })
  assert.equal((await probeOf(once)).status, "pass")
  assert.equal(once.state.moves, 1)
  const always = probeSite({ refusePurges: 99 })
  const r = await probeOf(always)
  assert.equal(r.status, "fail")
  assert.match(r.detail.join(" "), /didn't move and purge \(last: 503 purge_failed\)/)
  assert.equal(always.state.moves, 1)
})

test("a refused token fails; another exercise moving first leaves it incomplete; an invalid answer after the move fails", async () => {
  const refused = await probeOf(probeSite({ tokenOk: false }))
  assert.equal(refused.status, "fail")
  assert.match(refused.detail.join(" "), /refused \(403\)/)
  const other = await probeOf(probeSite({ movedByOther: true }))
  assert.equal(other.status, "incomplete", JSON.stringify(other))
  const invalid = await probeOf(probeSite({ invalidAfterMove: true }))
  assert.equal(invalid.status, "fail")
  assert.match(invalid.detail.join(" "), /without a generation/)
})

test("the probe's headers must be an Access pair, whole", async () => {
  await assert.rejects(
    edgeChecks("https://site.example", { fetch: probeSite().fetch, probe: { headers: { "CF-Access-Client-Id": "x" } } }),
    /EDGE_PROBE/,
  )
})

test("with both the staging exercise and the probe, the probe is checked on its own as purge_probe", async () => {
  const results = await edgeChecks("https://site.example", {
    fetch: probeSite().fetch,
    purge: PURGE,
    probe: PROBE,
    purgeTiming: PURGE_TIMING,
  })
  const r = results.find((x) => x.check === "purge_probe")
  assert.equal(r?.status, "pass", JSON.stringify(r))
  assert.doesNotMatch(String(results.find((x) => x.check === "purge_freshness").detail), /content-free probe/)
})

// L-PURGE-OBSERVATION-1 (a82): the purge is shown only where the copy was warmed, and only by the generation this
// exercise moved to. A fresh answer from elsewhere, a location the answers don't name, or a generation another exercise
// moved to never passes.
test("a copy left uncleared at the warmed location, with fresh answers only from elsewhere, never passes", async () => {
  // TLV warms (MISS, HIT); the purge doesn't reach TLV; every later read comes from FRA, which misses and answers 5.
  const elsewhere = probeSite({ coloOf: (n) => (n < 2 ? "TLV" : "FRA"), purgeReaches: (c) => c !== "TLV" })
  const r = await probeOf(elsewhere)
  assert.equal(r.status, "incomplete", JSON.stringify(r))
  assert.match(r.detail, /warmed location TLV/)
  // And when TLV answers again, still with 4, past the bound: that stale copy fails.
  const stale = probeSite({ coloOf: (n) => (n < 2 || n % 2 ? "TLV" : "FRA"), purgeReaches: (c) => c !== "TLV" })
  const s = await probeOf(stale)
  assert.equal(s.status, "fail", JSON.stringify(s))
  assert.match(s.detail.join(" "), /TLV still served generation 4/)
})

test("answers that don't name their edge location, or warm at two, leave the probe incomplete with nothing moved", async () => {
  for (const site of [probeSite({ noRay: true }), probeSite({ coloOf: (n) => (n === 0 ? "TLV" : "FRA") })]) {
    const r = await probeOf(site)
    assert.equal(r.status, "incomplete", JSON.stringify(r))
    assert.match(r.detail, /edge location/)
    assert.equal(site.state.moves, 0)
  }
})

test("a generation past the one this exercise moved to is another exercise's: incomplete, never this one's pass", async () => {
  const site = probeSite({ movedByOtherAfter: true })
  const r = await probeOf(site)
  assert.equal(r.status, "incomplete", JSON.stringify(r))
  assert.match(r.detail, /generation 6/)
})

// L-PURGE-STAGING-1 (a82): the probe answers purge_freshness only through production's explicit path
// (--probe-freshness, release.yml). Staging's purge_freshness needs its synthetic exercise; without it, the probe is
// purge_probe and purge_freshness stays incomplete, so the receipt can't qualify a release.
test("without the explicit production path, the probe is purge_probe and purge_freshness stays incomplete", async () => {
  const results = await edgeChecks("https://site.example", { fetch: probeSite().fetch, probe: PROBE, purgeTiming: PURGE_TIMING })
  assert.equal(status(results).purge_probe, "pass")
  assert.equal(status(results).purge_freshness, "incomplete")
  const production = await edgeChecks("https://site.example", {
    fetch: probeSite().fetch,
    probe: PROBE,
    probeFreshness: true,
    purgeTiming: PURGE_TIMING,
  })
  assert.equal(status(production).purge_freshness, "pass")
  assert.equal(status(production).purge_probe, undefined)
})

test("a staging run with the probe and no synthetic exercise can't qualify a release: its receipt fails the evidence check", async () => {
  const purges = (await edgeChecks("https://site.example", { fetch: probeSite().fetch, probe: PROBE, purgeTiming: PURGE_TIMING })).filter(
    (r) => r.check.startsWith("purge_"),
  )
  // Every other check passing, as on a staging run where only the exercise is missing.
  const results = [
    ...REQUIRED_CHECKS.filter((c) => c !== "purge_freshness").map((check) => ({ check, status: "pass", detail: "" })),
    ...purges,
  ]
  const SHA = "b".repeat(40)
  const report = { mode: "deployment", outcome: outcome(results), expect_tag: `staging-${SHA.slice(0, 12)}`, results }
  const receipt = receiptFor(report, { SHA, GITHUB_RUN_ID: "9" })
  assert.equal(receipt.checks.purge_probe, "pass")
  assert.equal(receipt.checks.purge_freshness, "incomplete")
  const artifacts = { artifacts: [{ name: `staging-receipt-${SHA}`, expired: false, created_at: "x", workflow_run: { id: 9 } }] }
  const run = { id: 9, path: ".github/workflows/staging.yml", status: "completed", conclusion: "success" }
  const problems = stagingEvidenceProblems({ sha: SHA, artifacts, run, receipt })
  assert.ok(
    problems.some((p) => p.includes("purge_freshness was incomplete")),
    problems.join("; "),
  )
})

test("a stale copy already seen past the bound still fails when another exercise's generation comes after it", async () => {
  // TLV keeps 4 past the bound (300 ms); then another exercise moves to 6 and TLV answers that.
  const site = probeSite({ purgeWorks: false, otherMovesAfterMs: 400 })
  const r = await probeOf(site)
  assert.equal(r.status, "fail", JSON.stringify(r))
  assert.match(r.detail.join(" "), /TLV still served generation 4/)
})

// C-CACHE: the launch runs with the Worker's cache off (EDGE_CACHE=off). Cloudflare then stores none of the Worker's
// answers, so a deployment that says off and answers from a cache fails, and a removal must be fresh at once: the
// page, the feed, and the place's own share image and photo, read straight after the hide.
const OFF = { edgeCache: "off" }

test("an edge cache mode other than on or off is refused before anything is asked (C-CACHE)", async () => {
  const asked = []
  for (const edgeCache of ["", "OFF", "none"])
    await assert.rejects(
      edgeChecks("https://site.example", { fetch: deployment((u) => asked.push(u.pathname)), edgeCache }),
      /edge cache mode/,
    )
  assert.deepEqual(asked, [])
})

test("with no Worker cache, no_shared_hit passes when no Worker answer carries CF-Cache-Status, and fails on any that does (C-CACHE)", async () => {
  const none = (await edgeChecks("https://site.example", { fetch: deployment(), identities: OWNERS, ...OFF })).find(
    (x) => x.check === "no_shared_hit",
  )
  assert.equal(none.status, "pass", JSON.stringify(none))
  assert.match(none.detail, /no Worker cache \(EDGE_CACHE=off\): \d+ Worker answers, none from a cache/)
  // DYNAMIC, BYPASS, MISS or HIT: any of them means a cache this deployment says it doesn't have.
  for (const seen of ["DYNAMIC", "MISS", "HIT"]) {
    const fetch = deployment((u, _i, res) => u.pathname === "/api/admin/queue" && res.headers.set("CF-Cache-Status", seen))
    const r = (await edgeChecks("https://site.example", { fetch, identities: OWNERS, ...OFF })).find((x) => x.check === "no_shared_hit")
    assert.equal(r.status, "fail", seen)
    assert.match(r.detail.join(" "), new RegExp(`/api/admin/queue.*${seen}`))
  }
  // Static files carry what the asset layer gives them, and aren't the Worker's answers.
  const statics = deployment((u, _i, res) => u.pathname === "/favicon.svg" && res.headers.set("CF-Cache-Status", "HIT"))
  assert.equal(status(await edgeChecks("https://site.example", { fetch: statics, identities: OWNERS, ...OFF })).no_shared_hit, "pass")
})

test("locally, the mode changes nothing: what needs the edge is still skipped (C-CACHE)", async () => {
  const results = await edgeChecks("https://site.example", { fetch: deployment(), local: true, dev: true, ...OFF })
  assert.equal(status(results).no_shared_hit, "skip")
  assert.equal(status(results).purge_freshness, "skip")
})

const offPurge = async (site, timing = PURGE_TIMING) =>
  (await edgeChecks("https://site.example", { fetch: site.fetch, purge: PURGE, purgeTiming: timing, ...OFF })).find(
    (x) => x.check === "purge_freshness",
  )

test("with no Worker cache, the removal exercise passes when the page, the feed, the share image and the photo are gone straight after the hide, and lifts its hide (C-CACHE)", async () => {
  const site = edgeSite({ cached: false, media: true })
  const r = await offPurge(site)
  assert.equal(r.status, "pass", JSON.stringify(r))
  assert.match(
    r.detail,
    /^no Worker cache \(EDGE_CACHE=off\): page fresh after \d+ ms, feed after \d+ ms, share image after \d+ ms, photo after \d+ ms/,
  )
  assert.ok(liftedAll(site))
  // Each was served before the hide, and read again after it.
  for (const path of [SYN_OG, SYN_PHOTO]) assert.ok(site.state.calls.filter((c) => c === `GET ${path}`).length >= 2, path)
})

test("with no Worker cache, a share image or photo still served past the bound fails, and the hide is still lifted (C-CACHE)", async () => {
  const site = edgeSite({ cached: false, media: true, staleMedia: true })
  const r = await offPurge(site)
  assert.equal(r.status, "fail")
  assert.match(r.detail.join(" "), /the share image still served/)
  assert.match(r.detail.join(" "), /the photo still served/)
  assert.ok(liftedAll(site))
})

test("with no Worker cache, a page or feed that comes from a cache fails the exercise before anything is hidden (C-CACHE)", async () => {
  const site = edgeSite({ media: true })
  const r = await offPurge(site)
  assert.equal(r.status, "fail")
  assert.match(r.detail.join(" "), /EDGE_CACHE=off.*CF-Cache-Status/)
  assert.equal(site.owned().length, 0)
})

test("with no Worker cache, no expiry window applies: entries' life doesn't make the exercise incomplete (C-CACHE)", async () => {
  // A cache's timing rule (STG-PURGE-TIMING-1) has nothing to time without a cache: a slow view still runs the exercise.
  const site = edgeSite({ cached: false, viewDelayMs: 200 })
  const r = await offPurge(site, { ...PURGE_TIMING, edgeTtlMs: 100 })
  assert.equal(r.status, "pass", JSON.stringify(r))
  assert.ok(liftedAll(site))
})

test("with no Worker cache and no media of its own, the exercise says the place's media weren't watched (C-CACHE)", async () => {
  const r = await offPurge(edgeSite({ cached: false }))
  assert.equal(r.status, "pass", JSON.stringify(r))
  assert.match(r.detail, /no share image or photo of its own to watch/)
})

test("with no Worker cache, production's probe passes when the new generation is read straight after the move (C-CACHE)", async () => {
  const site = probeSite({ cached: false })
  const r = await probeOf(site, OFF)
  assert.equal(r.status, "pass", JSON.stringify(r))
  assert.match(
    r.detail,
    /^no Worker cache \(EDGE_CACHE=off\): content-free probe, generation 4 → 5, fresh after \d+ ms from the move's dispatch/,
  )
  assert.equal(site.state.moves, 1)
})

test("with no Worker cache, a probe answered from a cache fails, and one never fresh fails once the bound passes (C-CACHE)", async () => {
  const cachedSite = probeSite()
  const r = await probeOf(cachedSite, OFF)
  assert.equal(r.status, "fail")
  assert.match(r.detail.join(" "), /EDGE_CACHE=off.*CF-Cache-Status/)
  assert.equal(cachedSite.state.moves, 0)
  // The generation never turns: the database or the route keeps answering the old one.
  const stuck = probeSite({ cached: false, invalidAfterMove: false })
  const stuckFetch = async (input, init) => {
    const res = await stuck.fetch(input, init)
    return new URL(input).pathname === "/api/v1/purge-probe" && stuck.state.moves
      ? new Response(JSON.stringify({ generation: 4 }), { status: 200, headers: res.headers })
      : res
  }
  const s = await probeOf({ fetch: stuckFetch, state: stuck.state }, OFF)
  assert.equal(s.status, "fail")
  assert.match(s.detail.join(" "), /still served generation 4/)
})
