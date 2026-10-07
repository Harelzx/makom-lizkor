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
//   node scripts/edge-check.mjs <base-url> [--local [--dev]] [--workers-dev <url>] [--expect-tag <tag>] [--report <file>]
//   --local: a local preview; what needs the edge is skipped, and labelled so.
//   --dev:   with --local, sign in through the development stand-in (/__dev/login), as a moderator and as a stranger.
//   --expect-tag: the tag the deploy just gave its version. The previous version may answer for a while after a deploy,
//   so the run first waits, bounded, for health to answer 200 under that tag (X-Worker-Version), then holds every Worker
//   answer it measures to it; one from another version, or naming none, fails (a61, DEPLOY-VERSION-1). The static
//   files and Access's own answers carry no version and aren't counted. Without it a deployment's version is unknown:
//   incomplete. This shows which version answered these requests, not that the rollout reached everywhere.
// Behind Access (staging), CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET in the environment, a service token's, go
// with every request. EDGE_PURGE (JSON: { place, moderator: { headers } }) is the staging purge exercise's synthetic place
// and moderator: without it, or without an edge cache to see, purge_freshness is incomplete. EDGE_PLACE names a published place whose share page must answer: since phase 7 every place is in
// the database, so a deployment names one that is there (a60); unnamed, that check is incomplete. Locally it is the
// place the e2e seed imports. EDGE_IDENTITIES (JSON: [{ name, path, headers, marker }], two or more synthetic owners,
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
  // A place that was never public: the share route's own 404 page, whatever place is named below.
  "/place/p_00000000000000000000000000": { status: [404] },
  "/api/v1/no-such-route": { status: [404] },
}
/** Addresses behind a credential: each answer, a refusal too, must stay out of shared caches. */
const AUTHENTICATED = ["/api/admin/queue", "/api/ops/summary", "/api/v1/submissions/p_00000000000000000000000000"]
const IDENTITIES = { moderator: "dev@example.test", stranger: "not-a-moderator@example.test" }
const refused = (status) => status >= 400 && status < 500
/** The place the local seed imports (fixtures/curated.json), checked when no place is named locally. */
const SEEDED_PLACE = "car-wall-tkuma"
/** A contribution's id or one of the site's own slugs, as the share route takes them; a visitor's local- id never is. */
const PLACE_ID = /^(?!local-)(p_[0-9A-HJKMNP-TV-Z]{26}|[a-z0-9][a-z0-9-]{0,63})$/
/** The addresses the Worker answers itself (run_worker_first); everything else is a static file. */
const WORKER_PATH = /^\/(api|place|media|__dev)\//
/** A version tag as the deploys give them: staging-<sha12>, or the release's tag. */
const TAG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
/**
 * The purge exercise's bounds (spec 5, 13): after a hide, the place's page and the feed must be fresh within freshMs
 * (a purge that took: seconds); past it the edge kept serving the old copy (the TTL, not the purge, ended it). It
 * watches until deadlineMs, asking every everyMs.
 */
const PURGE_TIMING = { freshMs: 15_000, deadlineMs: 75_000, everyMs: 1_000 }
/** How long a deploy's version gets to answer, how often health is asked, and how long one request may take. */
const READINESS = { deadlineMs: 90_000, everyMs: 3_000, fetchMs: 10_000 }

export async function edgeChecks(
  base,
  {
    fetch: send = globalThis.fetch,
    local = false,
    dev = false,
    workersDev = null,
    access = null,
    identities = null,
    place = null,
    expectTag = null,
    readiness = READINESS,
    purge = null,
    purgeTiming = PURGE_TIMING,
  } = {},
) {
  // A named place or an expected tag in a shape none has is a configuration mistake, refused before anything is asked.
  const named = place ?? (local ? SEEDED_PLACE : null)
  if (named !== null && !PLACE_ID.test(named)) throw new Error(`EDGE_PLACE is not a place's id: ${JSON.stringify(named)}`)
  if (expectTag !== null && !TAG.test(expectTag)) throw new Error(`--expect-tag is not a version tag: ${JSON.stringify(expectTag)}`)
  const headersOk = (h) => !!h && typeof h === "object" && Object.keys(h).length > 0 && Object.values(h).every((v) => typeof v === "string")
  if (purge !== null && !(typeof purge?.place === "string" && PLACE_ID.test(purge.place) && headersOk(purge.moderator?.headers)))
    throw new Error("EDGE_PURGE must name a synthetic place's id and a moderator's headers")
  const url = (path) => new URL(path, base).toString()
  // Once the expected version has answered, every Worker answer measured must name it.
  const version = { holding: false, answers: 0, failures: [] }
  // Past Access with a service token, on every request but the workers.dev probe (which must be refused on its own).
  const fetch = async (u, init = {}) => {
    const res = await send(
      u,
      access ? { ...init, headers: { ...init.headers, "CF-Access-Client-Id": access.id, "CF-Access-Client-Secret": access.secret } } : init,
    )
    const path = new URL(u).pathname
    if (version.holding && WORKER_PATH.test(path)) {
      version.answers++
      const tag = res.headers.get("X-Worker-Version")
      if (tag !== expectTag) version.failures.push(`${path}: answered by ${tag ?? "a version naming none"}`)
    }
    return res
  }
  // Readiness only: health is asked until it answers 200 under the expected tag, within the deadline, each request
  // bounded by what is left of it and at its own address (no cache answers one probe for another). Nothing else is
  // retried: the checks below run once.
  if (expectTag !== null) {
    const end = Date.now() + readiness.deadlineMs
    let last = "no answer"
    for (let n = 1; Date.now() < end; n++) {
      try {
        const res = await fetch(url(`/api/v1/health?ready=${n}`), {
          cache: "no-store",
          signal: AbortSignal.timeout(Math.max(1, Math.min(readiness.fetchMs, end - Date.now()))),
        })
        await res.text()
        const tag = res.headers.get("X-Worker-Version")
        if (res.status === 200 && tag === expectTag) {
          version.holding = true
          break
        }
        last = `${res.status} from ${tag ?? "a version naming none"}`
      } catch {
        last = "no answer in time"
      }
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(readiness.everyMs, end - Date.now()))))
    }
    if (!version.holding)
      return [
        {
          check: "deployed_version",
          status: "fail",
          detail: [`${expectTag} didn't answer /api/v1/health within ${readiness.deadlineMs / 1000} s (last: ${last})`],
        },
      ]
  }
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

  // The named place's share page: there, and the site's page, with the same headers. A named place that is missing,
  // hidden or broken fails: only an unnamed one is a check this run couldn't make (a60).
  if (named === null) unseen("place_page", "no published place named (EDGE_PLACE): its share page wasn't checked")
  else {
    const path = `/place/${named}`
    const res = await fetch(url(path), { redirect: "manual" })
    await res.text()
    const failures = []
    if (res.status !== 200) failures.push(`${path}: ${res.status}, not 200`)
    else if (!(res.headers.get("Content-Type") ?? "").startsWith("text/html"))
      failures.push(`${path}: ${res.headers.get("Content-Type")}, not text/html`)
    for (const [name, value] of Object.entries(SECURITY_HEADERS))
      if (res.headers.get(name) !== value) headerFailures.push(`${path}: ${name} is ${res.headers.get(name)}`)
    if (res.headers.get("Content-Security-Policy-Report-Only") !== CSP) headerFailures.push(`${path}: the page policy differs`)
    record("place_page", failures, `${path} answered`)
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

  if (!purge) unseen("purge_freshness", "needs a synthetic place and a moderator (EDGE_PURGE): the staging purge exercise")
  else await purgeExercise()

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
  /**
   * The staging purge exercise: the place's page and the current feed are read until the edge serves them from its
   * cache; the moderator hides the place whole; both must turn fresh (the page 410, the feed without it) within
   * freshMs. The hide is lifted again whatever happened, and a lift that fails leaves the place hidden: a failure.
   * Every answer goes through the same wrapper, so it is held to the deployed version too.
   */
  async function purgeExercise() {
    const { place: id, moderator } = purge
    const page = `/place/${id}`
    const feedPath = async () => `/api/v1/feed?v=${encodeURIComponent((await (await fetch(url("/api/v1/version"))).json()).v)}`
    const read = async (path, headers = {}) => {
      const res = await fetch(url(path), { redirect: "manual", headers })
      return { status: res.status, cache: res.headers.get("CF-Cache-Status"), body: await res.text() }
    }
    const asModerator = { ...moderator.headers, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" }
    const view = async () => (await fetch(url(`/api/admin/places/${id}`), { headers: asModerator })).json()
    // Warm: the second read of each must come from the edge cache, or nothing here can show a purge.
    const warm = []
    for (const path of [page, await feedPath()]) {
      await read(path)
      warm.push(await read(path))
    }
    if (warm.some((w) => w.cache !== "HIT"))
      return unseen("purge_freshness", "the edge cache didn't serve the place's page and the feed (no HIT): nothing to purge")
    if (warm[0].status !== 200 || !warm[1].body.includes(`"${id}"`))
      return record("purge_freshness", [`${id} isn't published: its page answered ${warm[0].status}`], "")
    const failures = []
    const before = new Set(((await view()).suppressions ?? []).map((s) => s.id))
    const hidden = await fetch(url("/api/admin/suppressions"), {
      method: "POST",
      headers: asModerator,
      body: JSON.stringify({
        placeId: id,
        fields: ["whole"],
        expectedRev: (await view()).rev,
        reason: "תרגיל purge ב־staging, מקום סינתטי",
      }),
    })
    if (hidden.status !== 200) return record("purge_freshness", [`the moderator's hide was refused (${hidden.status})`], "")
    const started = Date.now()
    const fresh = { page: null, feed: null }
    try {
      while (Date.now() - started < purgeTiming.deadlineMs && (fresh.page === null || fresh.feed === null)) {
        if (fresh.page === null && (await read(page)).status === 410) fresh.page = Date.now() - started
        if (fresh.feed === null && !(await read(await feedPath())).body.includes(`"${id}"`)) fresh.feed = Date.now() - started
        if (fresh.page === null || fresh.feed === null) await new Promise((r) => setTimeout(r, purgeTiming.everyMs))
      }
      for (const [what, ms] of Object.entries(fresh))
        if (ms === null) failures.push(`the ${what} still served the place ${purgeTiming.deadlineMs} ms after the hide`)
        else if (ms > purgeTiming.freshMs) failures.push(`the ${what} was not fresh until ${ms} ms (bound ${purgeTiming.freshMs} ms)`)
    } finally {
      const added = ((await view()).suppressions ?? []).filter((s) => !before.has(s.id))
      for (const s of added) {
        const lifted = await fetch(url(`/api/admin/suppressions/${s.id}/lift`), {
          method: "POST",
          headers: asModerator,
          body: JSON.stringify({
            expectedRev: (await view()).rev,
            basisCode: "hidden_in_error",
            basisNote: "תרגיל purge ב־staging: ההסתרה נעשתה לבדיקה בלבד.",
            confirm: { affirmativeBasis: true, notNonresponseOrDispute: true },
          }),
        })
        if (lifted.status !== 200)
          failures.push(`the exercise's hide ${s.id} couldn't be lifted (${lifted.status}): the place stays hidden`)
      }
    }
    record("purge_freshness", failures, `page fresh after ${fresh.page} ms, feed after ${fresh.feed} ms (bound ${purgeTiming.freshMs} ms)`)
  }

  if (expectTag !== null) record("deployed_version", version.failures, `${version.answers} Worker answers named ${expectTag}`)
  else if (!local) unseen("deployed_version", "no version expected (--expect-tag): which version answered is unknown")
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
  const expectTag = args.includes("--expect-tag") ? (option("--expect-tag") ?? "") : null
  if (!base || (args.includes("--dev") && !local)) {
    console.error(
      "usage: node scripts/edge-check.mjs <base-url> [--local [--dev]] [--workers-dev <url>] [--expect-tag <tag>] [--report <file>]",
    )
    process.exit(2)
  }
  const { CF_ACCESS_CLIENT_ID: id, CF_ACCESS_CLIENT_SECRET: secret, EDGE_IDENTITIES, EDGE_PLACE, EDGE_PURGE } = process.env
  const results = await edgeChecks(base, {
    local,
    dev: args.includes("--dev"),
    workersDev: option("--workers-dev"),
    access: id && secret ? { id, secret } : null,
    identities: EDGE_IDENTITIES ? JSON.parse(EDGE_IDENTITIES) : null,
    // An unset repository variable arrives as an empty string: not named.
    place: EDGE_PLACE || null,
    // An unset secret arrives as an empty string: no exercise.
    purge: EDGE_PURGE ? JSON.parse(EDGE_PURGE) : null,
    expectTag,
  })
  for (const r of results) console.log(`${r.status.padEnd(10)}  ${r.check}: ${Array.isArray(r.detail) ? r.detail.join("; ") : r.detail}`)
  const result = outcome(results)
  // The report names checks and statuses only; never a credential or an answer's body.
  if (option("--report"))
    writeFileSync(
      option("--report"),
      JSON.stringify({ mode: local ? "local" : "deployment", outcome: result, expect_tag: expectTag, results }, null, 2),
    )
  process.exit({ pass: 0, fail: 1, incomplete: 3 }[result])
}
