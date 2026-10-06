// The 7 October load (spec 13): what a visitor's page asks for, at 50 requests a second with a spike to ten times
// that, against staging before each memorial season. Thresholds: p95 under 300 ms, more than 95% of edge-cacheable
// answers served from the edge cache, and no 5xx. Never against production, and only on synthetic data.
//   k6 run -e BASE_URL=https://<staging> tests/load/oct7.js
//   k6 run -e BASE_URL=http://localhost:5602 -e SMOKE=1 tests/load/oct7.js   (a short local run, no cache threshold)
import http from "k6/http"
import { check } from "k6"
import { Counter, Rate } from "k6/metrics"

const BASE = __ENV.BASE_URL
if (!BASE) throw new Error("BASE_URL is required (staging, or a local preview with SMOKE=1)")
const SMOKE = __ENV.SMOKE === "1"

const edgeHits = new Rate("edge_cache_hits")
const serverErrors = new Counter("server_errors")

export const options = SMOKE
  ? {
      scenarios: { smoke: { executor: "constant-arrival-rate", rate: 2, timeUnit: "1s", duration: "10s", preAllocatedVUs: 4 } },
      thresholds: { server_errors: ["count==0"] },
    }
  : {
      scenarios: {
        steady: { executor: "constant-arrival-rate", rate: 50, timeUnit: "1s", duration: "5m", preAllocatedVUs: 50, maxVUs: 200 },
        spike: {
          executor: "ramping-arrival-rate",
          startTime: "5m",
          startRate: 50,
          timeUnit: "1s",
          preAllocatedVUs: 200,
          maxVUs: 1000,
          stages: [
            { target: 500, duration: "30s" },
            { target: 500, duration: "2m" },
            { target: 50, duration: "30s" },
          ],
        },
      },
      thresholds: {
        http_req_duration: ["p(95)<300"],
        edge_cache_hits: ["rate>0.95"],
        server_errors: ["count==0"],
      },
    }

/** An answer the edge is meant to keep: count whether it came from there. */
const cacheable = (res) => {
  const status = res.headers["Cf-Cache-Status"]
  if (status) edgeHits.add(status === "HIT")
}
const get = (path, edge) => {
  const res = http.get(`${BASE}${path}`, { tags: { name: path.split("?")[0] } })
  if (res.status >= 500) serverErrors.add(1)
  if (edge) cacheable(res)
  return res
}

// One visit: the page, its icon, the feed's version, the feed at that version, the anemone totals.
export default function () {
  get("/", true)
  get("/favicon.svg", true)
  const version = get("/api/v1/version", true)
  const v = version.status === 200 ? version.json("v") : ""
  const feed = get(`/api/v1/feed?v=${encodeURIComponent(v)}`, true)
  check(feed, { "feed answers at its version": (r) => r.status === 200 })
  get("/api/v1/tributes", true)
}
