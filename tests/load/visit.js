// One visitor's page load for the 7 October load script (spec 13), with no k6 import, so its accounting is tested in
// Node (scripts/load-visit.test.mjs); tests/load/oct7.js runs it under k6. A visit is REQUESTS_PER_VISIT requests,
// so k6's iteration rates are spec 13's request rates divided by that (a51, P6-LOAD-1).

/** The page, its icon, the feed's version, the feed at that version, the anemone totals. */
export const REQUESTS_PER_VISIT = 5
/** Spec 13's request rates: steady, and the spike at ten times that. */
const STEADY_RPS = 50
const SPIKE_RPS = 500

export function optionsFor(smoke) {
  const always = { server_errors: ["count==0"], transport_failures: ["count==0"], checks: ["rate==1"] }
  if (smoke)
    return {
      scenarios: { smoke: { executor: "constant-arrival-rate", rate: 1, timeUnit: "1s", duration: "10s", preAllocatedVUs: 4 } },
      thresholds: always,
    }
  const steady = STEADY_RPS / REQUESTS_PER_VISIT
  const spike = SPIKE_RPS / REQUESTS_PER_VISIT
  return {
    scenarios: {
      steady: { executor: "constant-arrival-rate", rate: steady, timeUnit: "1s", duration: "5m", preAllocatedVUs: 20, maxVUs: 100 },
      spike: {
        executor: "ramping-arrival-rate",
        startTime: "5m",
        startRate: steady,
        timeUnit: "1s",
        preAllocatedVUs: 100,
        maxVUs: 500,
        stages: [
          { target: spike, duration: "30s" },
          { target: spike, duration: "2m" },
          { target: steady, duration: "30s" },
        ],
      },
    },
    thresholds: {
      ...always,
      http_req_duration: ["p(95)<300"],
      edge_cache_hits: ["rate>0.95"],
      // A rate over answers that carried no cache status would claim what wasn't seen.
      cache_status_missing: ["count==0"],
    },
  }
}

/** A record of counts by place: an object (not null, not a list) whose every value is a whole number from 0. */
const isCounts = (t) =>
  typeof t === "object" && t !== null && !Array.isArray(t) && Object.values(t).every((n) => Number.isInteger(n) && n >= 0)

/**
 * One visit. `get(path, headers)` answers { status, headers, json(key), body }; `metrics` records; `access` is the
 * Access service token ({ id, secret }) for staging, or null. Every answer is edge-cacheable: each counts toward the
 * cache rate, and one without a cache status counts as a miss and as missing.
 */
export function visit({ get, metrics, access }) {
  const headers = access ? { "CF-Access-Client-Id": access.id, "CF-Access-Client-Secret": access.secret } : {}
  const ask = (path) => {
    const res = get(path, headers)
    if (res.status === 0) metrics.transportFailure()
    else if (res.status >= 500) metrics.serverError()
    const cache = res.headers["Cf-Cache-Status"]
    if (!cache) metrics.cacheMissing()
    metrics.edgeHit(cache === "HIT")
    return res
  }
  metrics.check("the page answers", ask("/").status === 200)
  metrics.check("the icon answers", ask("/favicon.svg").status === 200)
  const version = ask("/api/v1/version")
  const v = version.status === 200 ? version.json("v") : undefined
  metrics.check("the version answers", typeof v === "string" && v.length > 0)
  const feed = ask(`/api/v1/feed?v=${encodeURIComponent(v ?? "")}`)
  // At the version asked for: a stale answer kept somewhere on the way is not a valid one (a52).
  metrics.check("feed answers at its version", feed.status === 200 && feed.json("v") === v && Array.isArray(feed.json("places")))
  const totals = ask("/api/v1/tributes")
  metrics.check("the anemone totals answer", totals.status === 200 && isCounts(totals.json("totals")))
}
