// The 7 October load script's accounting (tests/load/visit.js, run by tests/load/oct7.js under k6; adviser a51,
// P6-LOAD-1), tested here without k6: the request rates spec 13 sets, the Access headers, and metrics that never
// count a missing observation or an invalid answer as a success. k6 itself is not installed here and the script has
// never run under it; no load result is claimed.
import assert from "node:assert/strict"
import { test } from "node:test"
import { optionsFor, REQUESTS_PER_VISIT, visit } from "../tests/load/visit.js"

test("asks spec 13's 50 requests a second, and 500 at the spike, counting every request of a visit", () => {
  const { scenarios, thresholds } = optionsFor(false)
  assert.equal(scenarios.steady.rate * REQUESTS_PER_VISIT, 50)
  assert.equal(Math.max(...scenarios.spike.stages.map((s) => s.target)) * REQUESTS_PER_VISIT, 500)
  assert.equal(scenarios.spike.startRate * REQUESTS_PER_VISIT, 50)
  // Every observation must be there for a cache rate to mean anything, every check must hold, nothing may fail on the way.
  assert.deepEqual(thresholds.cache_status_missing, ["count==0"])
  assert.deepEqual(thresholds.checks, ["rate==1"])
  assert.deepEqual(thresholds.transport_failures, ["count==0"])
  assert.deepEqual(thresholds.server_errors, ["count==0"])
})

/** A stand-in for k6: answers by path, and records what was asked and what the metrics got. */
function harness(answer) {
  const asked = []
  const metrics = { edgeHits: [], cacheMissing: 0, serverErrors: 0, transportFailures: 0, checks: [] }
  const get = (path, headers) => {
    asked.push({ path, headers })
    return answer(path)
  }
  const sink = {
    edgeHit: (v) => metrics.edgeHits.push(v),
    cacheMissing: () => metrics.cacheMissing++,
    serverError: () => metrics.serverErrors++,
    transportFailure: () => metrics.transportFailures++,
    check: (name, ok) => metrics.checks.push([name, ok]),
  }
  return { asked, metrics, run: (access) => visit({ get, metrics: sink, access }) }
}
const good = (path) => ({
  status: 200,
  headers: { "Cf-Cache-Status": "HIT" },
  json: (k) =>
    (path.startsWith("/api/v1/version") ? { v: "3" } : path.startsWith("/api/v1/feed") ? { v: "3", places: [] } : { totals: {} })[k],
  body: "{}",
})

test("a visit asks for its five addresses, each with the Access service token when one is given", () => {
  const h = harness(good)
  h.run({ id: "id.access", secret: "s" })
  assert.equal(h.asked.length, REQUESTS_PER_VISIT)
  assert.ok(h.asked.every((a) => a.headers["CF-Access-Client-Id"] === "id.access" && a.headers["CF-Access-Client-Secret"] === "s"))
  assert.deepEqual(h.metrics.edgeHits, [true, true, true, true, true])
  assert.ok(h.metrics.checks.every(([, ok]) => ok))
})

test("a missing cache header counts as a miss and is counted missing, never left out of the rate", () => {
  const h = harness((p) => ({ ...good(p), headers: {} }))
  h.run(null)
  assert.deepEqual(h.metrics.edgeHits, [false, false, false, false, false])
  assert.equal(h.metrics.cacheMissing, REQUESTS_PER_VISIT)
})

test("an invalid feed, a failed request and a server error each fail their metric", () => {
  const invalid = harness((p) => (p.startsWith("/api/v1/feed") ? { ...good(p), json: () => undefined } : good(p)))
  invalid.run(null)
  assert.ok(invalid.metrics.checks.some(([name, ok]) => name === "feed answers at its version" && !ok))
  const down = harness((p) => (p === "/favicon.svg" ? { status: 0, headers: {}, json: () => undefined, body: "" } : good(p)))
  down.run(null)
  assert.equal(down.metrics.transportFailures, 1)
  const broken = harness((p) => (p === "/" ? { ...good(p), status: 502 } : good(p)))
  broken.run(null)
  assert.equal(broken.metrics.serverErrors, 1)
  assert.ok(broken.metrics.checks.some(([name, ok]) => name === "the page answers" && !ok))
})

test("a feed at another version, and totals that aren't a record of counts, fail their checks (a52)", () => {
  const failed = (answer, name) => {
    const h = harness(answer)
    h.run(null)
    return h.metrics.checks.some(([n, ok]) => n === name && !ok)
  }
  const feedAt = (v) => (p) => (p.startsWith("/api/v1/feed") ? { ...good(p), json: (k) => ({ v, places: [] })[k] } : good(p))
  assert.equal(failed(feedAt("2"), "feed answers at its version"), true)
  assert.equal(failed(feedAt("3"), "feed answers at its version"), false)
  const totals = (value) => (p) => (p === "/api/v1/tributes" ? { ...good(p), json: (k) => ({ totals: value })[k] } : good(p))
  for (const bad of [null, [], { a: -1 }, { a: 1.5 }, { a: "3" }])
    assert.equal(failed(totals(bad), "the anemone totals answer"), true, JSON.stringify(bad))
  for (const ok of [{}, { "community-beeri": 3, p_01J0000000000000000000000A: 0 }])
    assert.equal(failed(totals(ok), "the anemone totals answer"), false, JSON.stringify(ok))
})
