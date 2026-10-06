// The 7 October load (spec 13): what a visitor's page asks for, at 50 requests a second with a spike to ten times
// that, against staging before each memorial season, through Access with its service token. Thresholds: p95 under
// 300 ms, more than 95% of edge-cacheable answers served from the edge cache (every answer observed: one with no cache
// status fails the run), every check holding, no 5xx and no failed request. Never against production, and only on
// synthetic data. The visit itself and its accounting are in visit.js (tested in Node); this is k6's side.
//   k6 run -e BASE_URL=https://<staging> -e CF_ACCESS_CLIENT_ID=… -e CF_ACCESS_CLIENT_SECRET=… tests/load/oct7.js
//   k6 run -e BASE_URL=http://localhost:5602 -e SMOKE=1 tests/load/oct7.js   (a short local run, no cache threshold)
import http from "k6/http"
import { check } from "k6"
import { Counter, Rate } from "k6/metrics"
import { optionsFor, visit } from "./visit.js"

const BASE = __ENV.BASE_URL
if (!BASE) throw new Error("BASE_URL is required (staging, or a local preview with SMOKE=1)")
const SMOKE = __ENV.SMOKE === "1"
const ACCESS =
  __ENV.CF_ACCESS_CLIENT_ID && __ENV.CF_ACCESS_CLIENT_SECRET
    ? { id: __ENV.CF_ACCESS_CLIENT_ID, secret: __ENV.CF_ACCESS_CLIENT_SECRET }
    : null
if (!SMOKE && !ACCESS) throw new Error("staging is behind Access: CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET are required")

const edgeHits = new Rate("edge_cache_hits")
const cacheMissing = new Counter("cache_status_missing")
const serverErrors = new Counter("server_errors")
const transportFailures = new Counter("transport_failures")

export const options = optionsFor(SMOKE)

const metrics = {
  edgeHit: (hit) => edgeHits.add(hit),
  cacheMissing: () => cacheMissing.add(1),
  serverError: () => serverErrors.add(1),
  transportFailure: () => transportFailures.add(1),
  check: (name, ok) => check(ok, { [name]: (v) => v }),
}
const get = (path, headers) => {
  const res = http.get(`${BASE}${path}`, { headers, tags: { name: path.split("?")[0] } })
  let parsed
  return {
    status: res.status,
    headers: res.headers,
    body: res.body,
    json: (key) => {
      try {
        parsed ??= JSON.parse(res.body)
        return parsed?.[key]
      } catch {
        return undefined
      }
    },
  }
}

export default function () {
  visit({ get, metrics, access: ACCESS })
}
