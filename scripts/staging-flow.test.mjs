// node --test scripts/staging-flow.test.mjs
import assert from "node:assert/strict"
import { test } from "node:test"
import { SYNTHETIC_MARK } from "../worker/lib/synthetic.ts"
import { stagingFlow } from "./staging-flow.mjs"

// The milestone on staging (L-FLOW): one synthetic submission, its approval by the machine moderator (H1), its
// publication (in the feed, its share page answering) and its removal (a whole hide: gone from the feed, the share page
// 410), each step's answer kept. These run it against a stand-in for the deployment.

const MACHINE = { "CF-Access-Client-Id": "machine.access", "CF-Access-Client-Secret": "machine-secret" }
const TIMING = { everyMs: 5, deadlineMs: 300, requestMs: 200 }
const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } })

/**
 * Staging as the Worker answers: a submission enters the queue, an approval publishes it, a whole hide takes it down.
 * The options stand in for what may go wrong: a refused submission or approval, a queue that never shows it, a feed or a
 * share page that doesn't follow the approval or the hide, a refused hide.
 */
function stagingSite({
  submitStatus = 201,
  queueShows = true,
  approveStatus = 200,
  feedFollowsApproval = true,
  pageAfterApproval = 200,
  hideStatus = 200,
  feedFollowsHide = true,
  pageAfterHide = 410,
} = {}) {
  const state = { places: new Map(), v: 1, calls: [], bodies: [] }
  const auth = (init) => new Headers(init.headers).get("CF-Access-Client-Id") === MACHINE["CF-Access-Client-Id"]
  const fetch = async (input, init = {}) => {
    const u = new URL(input)
    const method = init.method ?? "GET"
    state.calls.push(`${method} ${u.pathname}`)
    if (init.body) state.bodies.push(JSON.parse(init.body))
    if (!auth(init)) return json(403, { code: "forbidden" })
    if (method === "POST" && u.pathname === "/api/v1/submissions") {
      if (submitStatus !== 201) return json(submitStatus, { code: "turnstile_failed" })
      const id = `p_${String(state.places.size).padStart(26, "0")}`
      state.places.set(id, { id, name: JSON.parse(init.body).name_he, rev: 1, status: "pending", hidden: false })
      return json(201, { id, trackingToken: "a-tracking-token-never-kept" })
    }
    if (u.pathname === "/api/admin/queue")
      return json(200, {
        items: queueShows
          ? [...state.places.values()].filter((p) => p.status === "pending").map((p) => ({ id: p.id, rev: p.rev, revisionId: `r_${p.id}` }))
          : [],
      })
    const view = /^\/api\/admin\/places\/(p_\w+)$/.exec(u.pathname)
    if (view) return json(200, { rev: state.places.get(view[1]).rev, suppressions: [] })
    const transition = /^\/api\/admin\/places\/(p_\w+)\/transitions$/.exec(u.pathname)
    if (transition && method === "POST") {
      if (approveStatus !== 200) return json(approveStatus, { code: "changed_meanwhile" })
      const p = state.places.get(transition[1])
      if (JSON.parse(init.body).expectedRev !== p.rev) return json(409, { code: "changed_meanwhile" })
      p.status = "published"
      p.rev++
      if (feedFollowsApproval) state.v++
      return json(200, { ok: true })
    }
    if (method === "POST" && u.pathname === "/api/admin/suppressions") {
      if (hideStatus !== 200) return json(hideStatus, { code: "forbidden" })
      const p = state.places.get(JSON.parse(init.body).placeId)
      p.hidden = true
      p.rev++
      if (feedFollowsHide) state.v++
      return json(200, { ok: true })
    }
    if (u.pathname === "/api/v1/version") return json(200, { v: `0.${state.v}` })
    if (u.pathname === "/api/v1/feed") {
      if (u.searchParams.get("v") !== `0.${state.v}`)
        return json(409, { code: "stale_version", v: `0.${state.v}` }, { "Cache-Control": "no-store" })
      const shown = [...state.places.values()].filter(
        (p) => p.status === "published" && (!p.hidden || !feedFollowsHide) && (feedFollowsApproval || p.rev < 2),
      )
      return json(200, {
        v: `0.${state.v}`,
        places: shown.map((p) => ({
          id: p.id,
          kind: "bench",
          name_he: p.name,
          lat: 31.42,
          lng: 34.49,
          precision: "exact",
          place_he: "בארי",
          summary_he: "ספסל סינתטי לבדיקת הזרימה, לא מקום אמיתי.",
        })),
      })
    }
    const page = /^\/place\/(p_\w+)$/.exec(u.pathname)
    if (page) {
      const p = state.places.get(page[1])
      const status = !p || p.status !== "published" ? 404 : p.hidden ? pageAfterHide : pageAfterApproval
      return new Response("<!doctype html>", { status, headers: { "Content-Type": "text/html" } })
    }
    return json(404, { code: "not_found" })
  }
  return { fetch, state }
}
const run = (site) =>
  stagingFlow("https://staging.example", { fetch: site.fetch, headers: MACHINE, turnstileToken: "dummy", timing: TIMING })

test("one synthetic submission is approved, published and removed, every step answered and kept", async () => {
  const site = stagingSite()
  const r = await run(site)
  assert.equal(r.outcome, "pass", JSON.stringify(r))
  assert.deepEqual(
    r.steps.map((s) => [s.step, s.status]),
    [
      ["submitted", "pass"],
      ["queued", "pass"],
      ["approved", "pass"],
      ["published", "pass"],
      ["hidden", "pass"],
      ["removed", "pass"],
    ],
  )
  assert.match(r.place, /^p_/)
  // The name says it is synthetic, as the machine moderator requires and wherever it shows.
  assert.ok(site.state.places.get(r.place).name.startsWith(SYNTHETIC_MARK))
  // The tracking token is a secret of the submission's own: never in the receipt.
  assert.doesNotMatch(JSON.stringify(r), /a-tracking-token-never-kept/)
  // Every request went with the machine's own Access pair, and every change named the rev it saw.
  assert.ok(site.state.bodies.filter((b) => "expectedRev" in b).every((b) => Number.isInteger(b.expectedRev)))
})

test("each way the flow can break fails at its own step, and nothing after it is attempted", async () => {
  for (const [options, failed, notAttempted] of [
    [{ submitStatus: 403 }, "submitted", "POST /api/admin/suppressions"],
    [{ queueShows: false }, "queued", "POST /api/admin/suppressions"],
    [{ approveStatus: 409 }, "approved", "POST /api/admin/suppressions"],
    [{ feedFollowsApproval: false }, "published", "POST /api/admin/suppressions"],
    [{ pageAfterApproval: 404 }, "published", "POST /api/admin/suppressions"],
    [{ hideStatus: 403 }, "hidden", null],
    [{ feedFollowsHide: false }, "removed", null],
    [{ pageAfterHide: 200 }, "removed", null],
  ]) {
    const site = stagingSite(options)
    const r = await run(site)
    assert.equal(r.outcome, "fail", JSON.stringify(options))
    const step = r.steps.find((s) => s.status === "fail")
    assert.equal(step?.step, failed, JSON.stringify({ options, steps: r.steps }))
    if (notAttempted) assert.ok(!site.state.calls.includes(notAttempted), JSON.stringify(options))
  }
})

test("the machine's Access pair is required, whole", async () => {
  await assert.rejects(
    stagingFlow("https://staging.example", {
      fetch: stagingSite().fetch,
      headers: { "CF-Access-Client-Id": "x" },
      turnstileToken: "dummy",
    }),
    /FLOW_HEADERS/,
  )
  await assert.rejects(
    stagingFlow("https://staging.example", { fetch: stagingSite().fetch, headers: MACHINE, turnstileToken: "" }),
    /FLOW_TURNSTILE_TOKEN/,
  )
})
