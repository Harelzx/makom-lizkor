// The milestone on staging (L-FLOW): one synthetic submission, its approval by staging's machine moderator (H1), its
// publication and its removal, each step checked and its answer kept. The submission's name carries the synthetic mark
// (worker/lib/synthetic.ts), so it can never pass for a real memorial and the machine may act on it; its Turnstile token
// is the test keys' dummy one, which staging alone accepts (HAREL-STAGING-TURNSTILE-20261007). Every request goes with
// the machine moderator's own Access pair, which Access lets through to staging. The place stays hidden at the end:
// removal is the last step. A run on test keys shows the flow, never the real bot check.
//   FLOW_HEADERS='{"CF-Access-Client-Id":…,"CF-Access-Client-Secret":…}' FLOW_TURNSTILE_TOKEN=… \
//   node scripts/staging-flow.mjs <base-url> [--report <file>]
// Exit: 0 every step passed; 1 a step failed (the steps after it aren't attempted). The report names steps, statuses,
// times and the synthetic place's id; never a credential, a token or a body beyond those.
import { writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { CURRENT_SUBMISSION_NOTICE, Feed } from "../src/shared/contract.ts"
import { SYNTHETIC_MARK } from "../worker/lib/synthetic.ts"

/** How often a step that waits for the deployment asks again, for how long, and how long one request may take. */
const TIMING = { everyMs: 1_000, deadlineMs: 75_000, requestMs: 10_000 }

export async function stagingFlow(base, { fetch: send = globalThis.fetch, headers, turnstileToken, timing = TIMING } = {}) {
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
  const ask = async (path, init = {}) => {
    const res = await send(new URL(path, base).toString(), {
      redirect: "manual",
      ...init,
      headers: { ...Object.fromEntries(pair), ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(timing.requestMs),
    })
    const text = await res.text()
    return { status: res.status, type: res.headers.get("Content-Type") ?? "", body: parse(text) }
  }
  const change = (path, body) =>
    ask(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" },
      body: JSON.stringify(body),
    })
  // Asks until `ok` holds or the deadline passes; the last answer is kept for the record.
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
  // The feed at its current version, with this run's own address (a nonce in the query), or null if it isn't valid.
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
  const result = () => ({ run, place, outcome: steps.every((s) => s.status === "pass") ? "pass" : "fail", steps })

  // 1. A synthetic submission, through the real route and its Turnstile check (test keys on staging).
  const submitted = await ask("/api/v1/submissions", {
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
  place = typeof submitted.body?.id === "string" && /^p_[0-9A-Z]{26}$/.test(submitted.body.id) ? submitted.body.id : null
  // The tracking token in the answer is the submission's own secret: it is never kept.
  if (!step("submitted", submitted.status === 201 && place !== null, `answered ${submitted.status}`)) return result()

  // 2. In the machine moderator's queue (synthetic places only), at a rev.
  const queued = await until(
    () => ask("/api/admin/queue"),
    (r) => r.status === 200 && Array.isArray(r.body?.items) && r.body.items.some((i) => i.id === place),
  )
  const item = queued.ok ? queued.last.body.items.find((i) => i.id === place) : null
  if (
    !step(
      "queued",
      !!item && Number.isInteger(item.rev),
      queued.ok ? `rev ${item?.rev}` : `not in the queue (last: ${queued.last?.status})`,
    )
  )
    return result()

  // 3. Approved, naming the rev the queue showed.
  const approved = await change(`/api/admin/places/${place}/transitions`, {
    action: "approve",
    revisionId: item.revisionId,
    expectedRev: item.rev,
  })
  if (!step("approved", approved.status === 200, `answered ${approved.status}`)) return result()

  // 4. Published: in the feed, and its share page answering.
  const inFeed = await until(feed, (f) => f.places?.includes(place) === true)
  const pageUp = inFeed.ok ? await until(page, (p) => p.status === 200) : { ok: false, last: null }
  if (
    !step(
      "published",
      inFeed.ok && pageUp.ok,
      `feed ${inFeed.ok ? "names it" : `doesn't (last: ${inFeed.last?.status})`}; share page ${pageUp.last?.status ?? "not asked"}`,
    )
  )
    return result()

  // 5. Hidden whole by the machine moderator, naming the rev it saw.
  const view = await ask(`/api/admin/places/${place}`)
  const hidden =
    view.status === 200 && Number.isInteger(view.body?.rev)
      ? await change("/api/admin/suppressions", {
          placeId: place,
          fields: ["whole"],
          expectedRev: view.body.rev,
          reason: `בדיקת זרימה ב־staging, מקום סינתטי (flow:${run})`,
        })
      : { status: view.status }
  if (!step("hidden", hidden.status === 200, `answered ${hidden.status}`)) return result()

  // 6. Removed: gone from the feed, and its share page 410.
  const outOfFeed = await until(feed, (f) => Array.isArray(f.places) && !f.places.includes(place))
  const pageGone = await until(page, (p) => p.status === 410)
  step(
    "removed",
    outOfFeed.ok && pageGone.ok,
    `feed ${outOfFeed.ok ? "without it" : `still names it (last: ${outOfFeed.last?.status})`}; share page ${pageGone.last?.status}`,
  )
  return result()
}

// Run as a command only: imported (by the Worker's tests, inside workerd) there is no script path to compare.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const base = args.find((a) => /^https?:\/\//.test(a))
  const at = args.indexOf("--report")
  if (!base) {
    console.error("usage: node scripts/staging-flow.mjs <base-url> [--report <file>]")
    process.exit(2)
  }
  const { FLOW_HEADERS, FLOW_TURNSTILE_TOKEN } = process.env
  const result = await stagingFlow(base, { headers: FLOW_HEADERS ? JSON.parse(FLOW_HEADERS) : null, turnstileToken: FLOW_TURNSTILE_TOKEN })
  for (const s of result.steps) console.log(`${s.status.padEnd(6)}  ${s.step} (${s.at_ms} ms): ${s.detail}`)
  console.log(`synthetic place ${result.place ?? "none"}: ${result.outcome}`)
  if (at >= 0) writeFileSync(args[at + 1], JSON.stringify({ base, ...result }, null, 2))
  process.exit(result.outcome === "pass" ? 0 : 1)
}
