// The milestone on staging (L-FLOW): one synthetic submission, its approval by staging's machine moderator (H1), its
// publication and its removal, each step checked and its answer kept. The submission's name carries the synthetic mark
// (worker/lib/synthetic.ts), so it can never pass for a real memorial and the machine may act on it; its Turnstile token
// is the test keys' dummy one, which staging alone accepts (HAREL-STAGING-TURNSTILE-20261007). Every request goes with
// the machine moderator's own Access pair, which Access lets through to staging. A run on test keys shows the flow,
// never the real bot check.
//
// A step that fails stops the run there, and the run still returns its evidence: the run id, the place it knows and the
// steps so far (L-FLOW-RECEIPT-1). A request with no answer, or whose answer can't be read, fails its step with the
// outcome on the server unknown: an approval or a hide may have committed. So the place is known hidden only once the
// removal step passed; after any earlier failure it may be pending, published or hidden.
//   FLOW_HEADERS='{"CF-Access-Client-Id":…,"CF-Access-Client-Secret":…}' FLOW_TURNSTILE_TOKEN=… \
//   node scripts/staging-flow.mjs <base-url> [--expect-tag <tag>] [--report <file>]
//   --expect-tag: the tag the deploy gave the version (staging-<sha12>); an answer naming another fails the run.
// Exit: 0 every step passed; 1 a step failed, the report written all the same. The report names the run, the place's
// id, the versions that answered, each step's status, time and a short detail; never a credential, the tracking token
// or a body.
import { writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { CURRENT_SUBMISSION_NOTICE, Feed } from "../src/shared/contract.ts"
import { SYNTHETIC_MARK } from "../worker/lib/synthetic.ts"

/** How often a step that waits for the deployment asks again, for how long, and how long one request may take. */
const TIMING = { everyMs: 1_000, deadlineMs: 75_000, requestMs: 10_000 }
/** What a step records when its request got no answer, or one that couldn't be read. */
const UNKNOWN = "no answer: the outcome on the server is unknown"

/** A request that got no answer, or whose answer couldn't be read. */
class NoAnswer extends Error {}

export async function stagingFlow(
  base,
  { fetch: send = globalThis.fetch, headers, turnstileToken, timing = TIMING, expectTag = null } = {},
) {
  // On staging, the machine moderator's Access pair, whole; against a local Worker (its tests), the signed assertion
  // Access would pass on instead.
  const pair = new Headers(headers ?? {})
  const whole = !!pair.get("CF-Access-Client-Id") && !!pair.get("CF-Access-Client-Secret")
  const half = pair.has("CF-Access-Client-Id") !== pair.has("CF-Access-Client-Secret")
  if (half || (!whole && !pair.get("Cf-Access-Jwt-Assertion")))
    throw new Error("FLOW_HEADERS must give the machine moderator's Access pair (CF-Access-Client-Id and CF-Access-Client-Secret)")
  if (!turnstileToken) throw new Error("FLOW_TURNSTILE_TOKEN must give the Turnstile test keys' dummy token")
  const run = globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 12)
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const parse = (text) => {
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }
  // The version tag of every Worker answer, kept for the record and held to --expect-tag.
  const versions = new Set()
  let versionFailure = null
  const ask = async (path, init = {}) => {
    let res, text
    try {
      res = await send(new URL(path, base).toString(), {
        redirect: "manual",
        ...init,
        headers: { ...Object.fromEntries(pair), ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(timing.requestMs),
      })
      text = await res.text()
    } catch {
      throw new NoAnswer(UNKNOWN)
    }
    const tag = res.headers.get("X-Worker-Version")
    versions.add(tag ?? "none")
    if (expectTag !== null && tag !== expectTag && versionFailure === null)
      versionFailure = `${path.split("?")[0]} answered by ${tag ?? "a version naming none"}, not ${expectTag}`
    return { status: res.status, body: parse(text) }
  }
  const change = (path, body) =>
    ask(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" },
      body: JSON.stringify(body),
    })
  // Asks until `ok` holds or the deadline passes; the last answer is kept for the record. A lost answer is asked again.
  const until = async (look, ok) => {
    const end = Date.now() + timing.deadlineMs
    let last = null
    while (Date.now() < end) {
      last = await look().catch((err) => ({ error: err.message }))
      if (!last?.error && ok(last)) return { ok: true, last }
      await sleep(timing.everyMs)
    }
    return { ok: false, last }
  }
  // The feed at its current version, with this run's own address (a nonce in the query), or no places if it isn't valid.
  const feed = async () => {
    const version = await ask(`/api/v1/version?flow=${run}`)
    const v = version.status === 200 ? version.body?.v : null
    if (typeof v !== "string") return { status: version.status, places: null }
    const r = await ask(`/api/v1/feed?v=${encodeURIComponent(v)}&flow=${run}`)
    const parsed = r.status === 200 ? Feed.safeParse(r.body) : null
    return { status: r.status, places: parsed?.success ? parsed.data.places.map((p) => p.id) : null }
  }
  const page = async () => ({ status: (await ask(`/place/${place}?flow=${run}`)).status })

  const steps = []
  const started = Date.now()
  const step = (name, ok, detail) => {
    steps.push({ step: name, status: ok ? "pass" : "fail", at_ms: Date.now() - started, detail })
    return ok
  }
  let place = null
  const result = () => {
    const failed = !steps.every((s) => s.status === "pass") || versionFailure !== null
    return {
      run,
      place,
      outcome: failed ? "fail" : "pass",
      expect_tag: expectTag,
      versions: [...versions].sort(),
      ...(versionFailure ? { version_failure: versionFailure } : {}),
      steps,
    }
  }
  // Each step's own requests: one with no answer fails that step, the outcome unknown, and ends the run.
  const at = async (name, body) => {
    try {
      return await body()
    } catch (err) {
      if (!(err instanceof NoAnswer)) throw err
      step(name, false, UNKNOWN)
      return false
    }
  }

  // 1. A synthetic submission, through the real route and its Turnstile check (test keys on staging).
  const submitted = await at("submitted", async () => {
    const r = await ask("/api/v1/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": `staging-flow-${run}-${run}`, "Turnstile-Token": turnstileToken },
      body: JSON.stringify({
        kind: "bench",
        name_he: `${SYNTHETIC_MARK}ספסל לבדיקת הזרימה ${run}`,
        lat: 31.42,
        lng: 34.49,
        consent_version: CURRENT_SUBMISSION_NOTICE,
      }),
    })
    place = typeof r.body?.id === "string" && /^p_[0-9A-Z]{26}$/.test(r.body.id) ? r.body.id : null
    // The tracking token in the answer is the submission's own secret: it is never kept.
    return step("submitted", r.status === 201 && place !== null, `answered ${r.status}`)
  })
  if (!submitted) return result()

  // 2. In the machine moderator's queue (synthetic places only), at a rev.
  let item = null
  const queued = await at("queued", async () => {
    const q = await until(
      () => ask("/api/admin/queue"),
      (r) => r.status === 200 && Array.isArray(r.body?.items) && r.body.items.some((i) => i.id === place),
    )
    item = q.ok ? q.last.body.items.find((i) => i.id === place) : null
    const ok = !!item && Number.isInteger(item.rev)
    return step("queued", ok, ok ? `rev ${item.rev}` : q.last?.error ? UNKNOWN : `not in the queue (last: ${q.last?.status})`)
  })
  if (!queued) return result()

  // 3. Approved, naming the rev the queue showed.
  const approved = await at("approved", async () => {
    const r = await change(`/api/admin/places/${place}/transitions`, {
      action: "approve",
      revisionId: item.revisionId,
      expectedRev: item.rev,
    })
    return step("approved", r.status === 200, `answered ${r.status}`)
  })
  if (!approved) return result()

  // 4. Published: in the feed, and its share page answering.
  const inFeed = await until(feed, (f) => f.places?.includes(place) === true)
  const pageUp = inFeed.ok ? await until(page, (p) => p.status === 200) : { ok: false, last: null }
  if (
    !step(
      "published",
      inFeed.ok && pageUp.ok,
      `feed ${inFeed.ok ? "names it" : `doesn't (last: ${inFeed.last?.error ? UNKNOWN : inFeed.last?.status})`}; share page ${pageUp.last?.status ?? "not asked"}`,
    )
  )
    return result()

  // 5. Hidden whole by the machine moderator, naming the rev its view showed. Only the hide's own answer passes it.
  const hidden = await at("hidden", async () => {
    const view = await ask(`/api/admin/places/${place}`)
    if (view.status !== 200 || !Number.isInteger(view.body?.rev))
      return step("hidden", false, `the moderator's view answered ${view.status} without a rev: no hide sent`)
    const r = await change("/api/admin/suppressions", {
      placeId: place,
      fields: ["whole"],
      expectedRev: view.body.rev,
      reason: `בדיקת זרימה ב־staging, מקום סינתטי (flow:${run})`,
    })
    return step("hidden", r.status === 200, `answered ${r.status}`)
  })
  if (!hidden) return result()

  // 6. Removed: gone from the feed, and its share page 410.
  const outOfFeed = await until(feed, (f) => Array.isArray(f.places) && !f.places.includes(place))
  const pageGone = await until(page, (p) => p.status === 410)
  step(
    "removed",
    outOfFeed.ok && pageGone.ok,
    `feed ${outOfFeed.ok ? "without it" : `still names it (last: ${outOfFeed.last?.error ? UNKNOWN : outOfFeed.last?.status})`}; share page ${pageGone.last?.status}`,
  )
  return result()
}

/** The command: runs the flow, prints each step, writes the report whatever the outcome, and answers the exit code. */
export async function runCli(args, { env = process.env, fetch, log = console.log, timing } = {}) {
  const base = args.find((a) => /^https?:\/\//.test(a))
  const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
  if (!base) {
    log("usage: node scripts/staging-flow.mjs <base-url> [--expect-tag <tag>] [--report <file>]")
    return 2
  }
  const result = await stagingFlow(base, {
    ...(fetch ? { fetch } : {}),
    ...(timing ? { timing } : {}),
    headers: env.FLOW_HEADERS ? JSON.parse(env.FLOW_HEADERS) : null,
    turnstileToken: env.FLOW_TURNSTILE_TOKEN,
    expectTag: option("--expect-tag"),
  })
  for (const s of result.steps) log(`${s.status.padEnd(6)}  ${s.step} (${s.at_ms} ms): ${s.detail}`)
  log(`synthetic place ${result.place ?? "none"}; versions ${result.versions.join(", ")}: ${result.outcome}`)
  if (result.version_failure) log(`version: ${result.version_failure}`)
  if (option("--report")) writeFileSync(option("--report"), JSON.stringify({ base, ...result }, null, 2))
  return result.outcome === "pass" ? 0 : 1
}

// Run as a command only: imported (by the Worker's tests, inside workerd) there is no script path to compare.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await runCli(process.argv.slice(2)))
