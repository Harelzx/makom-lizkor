// Checks against a running deployment (spec 11, 13): the security headers on every kind of address, private and
// no-store on everything authenticated (refusals included), no shared cache HIT for two different authorizations,
// and workers.dev closed. release.yml runs it against production after the deploy; locally it runs on the preview of
// the production build (e2e/edge-check.spec.ts). A check that needs what isn't there (the edge cache, a workers.dev
// address, a moderator action for the purge timing) says so and is skipped, never counted as passed.
//   node scripts/edge-check.mjs <base-url> [--dev] [--workers-dev <url>]
//   --dev: sign in through the development stand-in (/__dev/login), as a moderator and as a stranger.
// Behind Access (staging), CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET in the environment, a service token's, go
// with every request; they are read from the environment only, never from an argument.
import { pathToFileURL } from "node:url"
import { CSP, SECURITY_HEADERS } from "../worker/lib/security-headers.ts"

const PAGES = ["/", "/favicon.svg", "/admin/", "/api/v1/health", "/place/car-wall-tkuma", "/api/v1/no-such-route"]
/** Addresses behind a credential: each answer, a refusal too, must stay out of shared caches. */
const AUTHENTICATED = ["/api/admin/queue", "/api/ops/summary", "/api/v1/submissions/p_00000000000000000000000000"]
const IDENTITIES = { moderator: "dev@example.test", stranger: "not-a-moderator@example.test" }

export async function edgeChecks(base, { fetch: send = globalThis.fetch, dev = false, workersDev = null, access = null } = {}) {
  const url = (path) => new URL(path, base).toString()
  // Past Access with a service token, on every request but the workers.dev probe (which must be refused on its own).
  const fetch = (u, init = {}) =>
    send(
      u,
      access ? { ...init, headers: { ...init.headers, "CF-Access-Client-Id": access.id, "CF-Access-Client-Secret": access.secret } } : init,
    )
  const results = []
  const record = (check, failures, detail) =>
    results.push({ check, status: failures.length ? "fail" : "pass", detail: failures.length ? failures : detail })
  const skip = (check, why) => results.push({ check, status: "skip", detail: why })

  const headerFailures = []
  for (const path of PAGES) {
    const res = await fetch(url(path), { redirect: "manual" })
    const h = res.headers
    for (const [name, value] of Object.entries(SECURITY_HEADERS))
      if (h.get(name) !== value) headerFailures.push(`${path}: ${name} is ${h.get(name)}`)
    if (h.get("Content-Security-Policy-Report-Only") !== CSP) headerFailures.push(`${path}: the page policy differs`)
  }
  record("headers", headerFailures, `${PAGES.length} addresses`)

  // Who asks: no credential, a bearer that isn't one, and with --dev the two signed-in identities.
  const askers = { anonymous: {}, wrong_bearer: { Authorization: "Bearer not-a-token" } }
  if (dev)
    for (const [who, email] of Object.entries(IDENTITIES)) {
      const res = await fetch(url("/__dev/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const cookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0]
      if (!cookie.startsWith("CF_Authorization="))
        return [...results, { check: "private_no_store", status: "fail", detail: [`--dev: no sign-in for ${who}`] }]
      askers[who] = { Cookie: cookie }
    }
  const privateFailures = []
  const cacheStatuses = []
  const hits = []
  for (const path of AUTHENTICATED)
    for (const [who, headers] of Object.entries(askers))
      for (let round = 0; round < 2; round++) {
        const res = await fetch(url(path), { headers })
        await res.arrayBuffer()
        if (res.headers.get("Cache-Control") !== "private, no-store")
          privateFailures.push(`${path} as ${who}: Cache-Control is ${res.headers.get("Cache-Control")}`)
        const status = res.headers.get("CF-Cache-Status")
        if (status) cacheStatuses.push(status)
        if (status === "HIT") hits.push(`${path} as ${who}, round ${round + 1}`)
      }
  record("private_no_store", privateFailures, `${AUTHENTICATED.length} addresses × ${Object.keys(askers).length} askers × 2`)
  if (!cacheStatuses.length && !hits.length)
    skip("no_shared_hit", "no CF-Cache-Status on any answer: no edge cache here (staging and production have one)")
  else record("no_shared_hit", hits, `${cacheStatuses.length} answers through the edge cache`)

  skip("purge_freshness", "needs the edge cache and a moderator's action on a synthetic place: measured at staging")

  if (!workersDev) skip("workers_dev_closed", "no workers.dev address given (--workers-dev)")
  else {
    let open = null
    try {
      const res = await send(new URL("/api/v1/health", workersDev).toString(), { redirect: "manual" })
      if (res.status < 400) open = `answered ${res.status}`
    } catch {
      // Unreachable is closed.
    }
    record("workers_dev_closed", open ? [`${workersDev} ${open}`] : [], "no answer from workers.dev")
  }
  return results
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const base = args.find((a) => /^https?:\/\//.test(a) && args[args.indexOf(a) - 1] !== "--workers-dev")
  if (!base) {
    console.error("usage: node scripts/edge-check.mjs <base-url> [--dev] [--workers-dev <url>]")
    process.exit(2)
  }
  const at = args.indexOf("--workers-dev")
  const { CF_ACCESS_CLIENT_ID: id, CF_ACCESS_CLIENT_SECRET: secret } = process.env
  const access = id && secret ? { id, secret } : null
  const results = await edgeChecks(base, { dev: args.includes("--dev"), workersDev: at >= 0 ? args[at + 1] : null, access })
  for (const r of results) console.log(`${r.status.padEnd(4)}  ${r.check}: ${Array.isArray(r.detail) ? r.detail.join("; ") : r.detail}`)
  process.exit(results.some((r) => r.status === "fail") ? 1 : 0)
}
