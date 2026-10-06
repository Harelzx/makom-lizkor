// Checks against a running deployment (spec 11, 13): each address answers as it should (a healthy deployment, not
// only the right headers), the security headers on every kind of address, private and no-store on everything
// authenticated (refusals included), one owner's private answer never reaching another, no shared cache HIT, and
// workers.dev closed. release.yml runs it against production after the deploy and staging.yml against staging; locally
// it runs on the preview of the production build (e2e/edge-check.spec.ts).
//
// Against a real deployment (the default) a check that needs what wasn't supplied or can't be seen (two synthetic
// owners, the edge cache, the purge timing, a conclusive workers.dev answer) is "incomplete": the run exits 3, and an
// incomplete run never qualifies a release (a51, P6-EDGE-1). Only the explicit --local mode, for a preview with no edge,
// may "skip" them.
//   node scripts/edge-check.mjs <base-url> [--local [--dev]] [--workers-dev <url>] [--report <file>]
//   --local: a local preview; what needs the edge is skipped, and labelled so.
//   --dev:   with --local, sign in through the development stand-in (/__dev/login), as a moderator and as a stranger.
// Behind Access (staging), CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET in the environment, a service token's, go
// with every request. EDGE_IDENTITIES (JSON: [{ name, path, headers, marker }], two or more synthetic owners,
// each with a private address of its own and a marker its answer carries) names who may read what. Both are read
// from the environment only, never from an argument.
// Exit: 0 every check passed (or skipped, locally); 1 a check failed; 3 nothing failed but something is incomplete.
import { writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { CSP, SECURITY_HEADERS } from "../worker/lib/security-headers.ts"

/** Each public address and the answer it must give: its status, and what its body must be where that's known. */
const PAGES = {
  "/": { status: [200], type: "text/html" },
  "/favicon.svg": { status: [200] },
  // The moderators' page: theirs behind Access, the page itself locally.
  "/admin/": { status: [200, 302, 401, 403] },
  "/api/v1/health": { status: [200], json: { ok: true } },
  "/place/car-wall-tkuma": { status: [200], type: "text/html" },
  "/api/v1/no-such-route": { status: [404] },
}
/** Addresses behind a credential: each answer, a refusal too, must stay out of shared caches. */
const AUTHENTICATED = ["/api/admin/queue", "/api/ops/summary", "/api/v1/submissions/p_00000000000000000000000000"]
const IDENTITIES = { moderator: "dev@example.test", stranger: "not-a-moderator@example.test" }
const refused = (status) => status >= 400 && status < 500

export async function edgeChecks(
  base,
  { fetch: send = globalThis.fetch, local = false, dev = false, workersDev = null, access = null, identities = null } = {},
) {
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
  // What can't be shown here: skipped on a local preview, incomplete on a real deployment.
  const unseen = (check, why) => results.push({ check, status: local ? "skip" : "incomplete", detail: why })

  const answerFailures = []
  const headerFailures = []
  for (const [path, want] of Object.entries(PAGES)) {
    const res = await fetch(url(path), { redirect: "manual" })
    const body = await res.text()
    if (!want.status.includes(res.status)) answerFailures.push(`${path}: ${res.status}, not ${want.status.join(" or ")}`)
    else if (want.type && !(res.headers.get("Content-Type") ?? "").startsWith(want.type))
      answerFailures.push(`${path}: ${res.headers.get("Content-Type")}, not ${want.type}`)
    else if (want.json) {
      let parsed = null
      try {
        parsed = JSON.parse(body)
      } catch {
        // Not JSON: wrong.
      }
      if (JSON.stringify(parsed) !== JSON.stringify(want.json)) answerFailures.push(`${path}: not ${JSON.stringify(want.json)}`)
    }
    const h = res.headers
    for (const [name, value] of Object.entries(SECURITY_HEADERS))
      if (h.get(name) !== value) headerFailures.push(`${path}: ${name} is ${h.get(name)}`)
    if (h.get("Content-Security-Policy-Report-Only") !== CSP) headerFailures.push(`${path}: the page policy differs`)
  }

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
  // The owners' own probes, and whether each passed through the edge cache: only they can show no shared HIT (a52).
  const ownerProbes = { total: 0, seen: 0 }
  const ask = async (path, headers, who, round, owner = false) => {
    const res = await fetch(url(path), { headers })
    // Read here and compared in memory only: never logged, never in the report.
    const body = await res.text()
    if (res.headers.get("Cache-Control") !== "private, no-store")
      privateFailures.push(`${path} as ${who}: Cache-Control is ${res.headers.get("Cache-Control")}`)
    const status = res.headers.get("CF-Cache-Status")
    if (status) cacheStatuses.push(status)
    if (status === "HIT") hits.push(`${path} as ${who}, round ${round + 1}`)
    if (owner) {
      ownerProbes.total++
      if (status) ownerProbes.seen++
    }
    return { status: res.status, body }
  }
  for (const path of AUTHENTICATED)
    for (const [who, headers] of Object.entries(askers))
      for (let round = 0; round < 2; round++) {
        const { status } = await ask(path, headers, who, round)
        // Without a credential that admits it, an answer is a refusal: never the private content, never a crash.
        if ((who === "anonymous" || who === "wrong_bearer") && !refused(status)) answerFailures.push(`${path} as ${who}: ${status}`)
      }

  // Synthetic owners: each reads its own private address, its answer carrying its own marker and no other's, and is
  // refused at the others' (a cache keyed without the credential would hand one's answer to the next). Against a
  // deployment: two or more, each with an address and a marker of its own (a52). Locally (--dev), the moderator and
  // the stranger at the queue, by status alone: the local partial mode.
  const isolation = []
  const owners =
    identities ??
    (local && dev
      ? [
          { name: "moderator", path: "/api/admin/queue", headers: askers.moderator },
          { name: "stranger", path: null, headers: askers.stranger },
        ]
      : [])
  const readers = owners.filter((o) => o.path)
  const marked =
    !identities ||
    (readers.length === owners.length &&
      owners.every((o) => o.marker) &&
      new Set(owners.map((o) => o.marker)).size === owners.length &&
      new Set(owners.map((o) => o.path)).size === owners.length)
  if (owners.length < 2 || !readers.length || !marked)
    unseen("private_isolation", "needs two synthetic owners, each with its own private address and marker (EDGE_IDENTITIES)")
  else {
    for (const owner of readers) {
      const found = { own: true, others: new Set() }
      for (let round = 0; round < 2; round++) {
        const { status, body } = await ask(owner.path, owner.headers, owner.name, round, true)
        if (status !== 200) isolation.push(`${owner.name} could not read its own private address (${status})`)
        else if (owner.marker) {
          if (!body.includes(owner.marker)) found.own = false
          for (const other of owners) if (other !== owner && body.includes(other.marker)) found.others.add(other.name)
        }
      }
      if (!found.own) isolation.push(`${owner.name}'s own answer didn't carry its marker`)
      for (const name of found.others) isolation.push(`${owner.name}'s own answer carried ${name}'s marker`)
    }
    for (const owner of readers)
      for (const other of owners.filter((o) => o !== owner)) {
        const { status, body } = await ask(owner.path, other.headers, other.name, 0)
        if (!refused(status)) isolation.push(`${other.name} read ${owner.name}'s private address (${status})`)
        else if (owner.marker && body.includes(owner.marker))
          isolation.push(`${other.name} was refused at ${owner.name}'s address with its answer`)
      }
    record("private_isolation", isolation, `${owners.length} owners, each with its own answer, refused at the others' addresses`)
  }
  results.unshift(
    {
      check: "responses",
      status: answerFailures.length ? "fail" : "pass",
      detail: answerFailures.length ? answerFailures : `${Object.keys(PAGES).length} addresses and every refusal`,
    },
    {
      check: "headers",
      status: headerFailures.length ? "fail" : "pass",
      detail: headerFailures.length ? headerFailures : `${Object.keys(PAGES).length} addresses`,
    },
    {
      check: "private_no_store",
      status: privateFailures.length ? "fail" : "pass",
      detail: privateFailures.length ? privateFailures : `${AUTHENTICATED.length} addresses × ${Object.keys(askers).length} askers × 2`,
    },
  )
  // Shown only by the owners' own probes, each seen through the edge cache (a52); locally, by whatever passed through.
  if (hits.length) record("no_shared_hit", hits, "")
  else if (local ? !cacheStatuses.length : !ownerProbes.total || ownerProbes.seen < ownerProbes.total)
    unseen("no_shared_hit", "the owners' own probes weren't all seen through the edge cache (CF-Cache-Status)")
  else record("no_shared_hit", [], `${ownerProbes.seen} owner probes through the edge cache, no HIT`)

  unseen("purge_freshness", "needs the edge cache and a moderator's action on a synthetic place: the staging purge exercise")

  if (!workersDev) unseen("workers_dev_closed", "no workers.dev address given (--workers-dev)")
  else {
    let res = null
    try {
      res = await send(new URL("/api/v1/health", workersDev).toString(), { redirect: "manual" })
    } catch {
      // Unreachable proves nothing: a network fault looks the same.
    }
    // Closed is shown only by a refusal (401, 403) or a redirect to Cloudflare Access's sign-in (a52).
    let toAccess = false
    try {
      toAccess =
        !!res &&
        res.status >= 300 &&
        res.status < 400 &&
        new URL(res.headers.get("Location") ?? "").hostname.endsWith(".cloudflareaccess.com")
    } catch {
      // No Location, or not an address: not Access.
    }
    if (!res) unseen("workers_dev_closed", `${workersDev} gave no answer: inconclusive`)
    else if (res.status < 300) record("workers_dev_closed", [`${workersDev} answered ${res.status}`], "")
    else if (res.status === 401 || res.status === 403 || toAccess) record("workers_dev_closed", [], `${workersDev} refused (${res.status})`)
    else unseen("workers_dev_closed", `${workersDev} answered ${res.status}, not a recognized refusal: inconclusive`)
  }
  return results
}

/** The run as a whole: any failure fails it; otherwise anything incomplete leaves it incomplete. */
export const outcome = (results) =>
  results.some((r) => r.status === "fail") ? "fail" : results.some((r) => r.status === "incomplete") ? "incomplete" : "pass"

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
  const base = args.find((a, i) => /^https?:\/\//.test(a) && args[i - 1] !== "--workers-dev")
  const local = args.includes("--local")
  if (!base || (args.includes("--dev") && !local)) {
    console.error("usage: node scripts/edge-check.mjs <base-url> [--local [--dev]] [--workers-dev <url>] [--report <file>]")
    process.exit(2)
  }
  const { CF_ACCESS_CLIENT_ID: id, CF_ACCESS_CLIENT_SECRET: secret, EDGE_IDENTITIES } = process.env
  const results = await edgeChecks(base, {
    local,
    dev: args.includes("--dev"),
    workersDev: option("--workers-dev"),
    access: id && secret ? { id, secret } : null,
    identities: EDGE_IDENTITIES ? JSON.parse(EDGE_IDENTITIES) : null,
  })
  for (const r of results) console.log(`${r.status.padEnd(10)}  ${r.check}: ${Array.isArray(r.detail) ? r.detail.join("; ") : r.detail}`)
  const result = outcome(results)
  // The report names checks and statuses only; never a credential or an answer's body.
  if (option("--report"))
    writeFileSync(option("--report"), JSON.stringify({ mode: local ? "local" : "deployment", outcome: result, results }, null, 2))
  process.exit({ pass: 0, fail: 1, incomplete: 3 }[result])
}
