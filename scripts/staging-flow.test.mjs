// node --test scripts/staging-flow.test.mjs
import assert from "node:assert/strict"
import { test } from "node:test"
import { SYNTHETIC_MARK } from "../worker/lib/synthetic.ts"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCli, stagingFlow } from "./staging-flow.mjs"

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
  // Transport faults: the approval committed and its answer lost; a body that can't be read at one address; a
  // moderator's view answering 200 without a rev; the version tag every Worker answer names. `unreadableAt` is a path,
  // or a function of the path and the site's state.
  loseApprovalAnswer = false,
  unreadableAt = null,
  viewWithoutRev = false,
  tag = "staging-abc",
} = {}) {
  const state = { places: new Map(), v: 1, calls: [], bodies: [] }
  const auth = (init) => new Headers(init.headers).get("CF-Access-Client-Id") === MACHINE["CF-Access-Client-Id"]
  const fetch = async (input, init = {}) => {
    const u = new URL(input)
    const method = init.method ?? "GET"
    state.calls.push(`${method} ${u.pathname}`)
    if (init.body) state.bodies.push(JSON.parse(init.body))
    if (!auth(init)) return json(403, { code: "forbidden" })
    const res = await answer(u, method, init)
    if (typeof unreadableAt === "function" ? unreadableAt(u.pathname, state) : unreadableAt === u.pathname) {
      const broken = new Response(null, { status: res.status, headers: res.headers })
      broken.text = async () => {
        throw new TypeError("terminated")
      }
      return broken
    }
    res.headers.set("X-Worker-Version", tag)
    return res
  }
  const answer = async (u, method, init) => {
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
    if (view) return json(200, viewWithoutRev ? { suppressions: [] } : { rev: state.places.get(view[1]).rev, suppressions: [] })
    const transition = /^\/api\/admin\/places\/(p_\w+)\/transitions$/.exec(u.pathname)
    if (transition && method === "POST") {
      if (approveStatus !== 200) return json(approveStatus, { code: "changed_meanwhile" })
      const p = state.places.get(transition[1])
      if (JSON.parse(init.body).expectedRev !== p.rev) return json(409, { code: "changed_meanwhile" })
      p.status = "published"
      p.rev++
      if (feedFollowsApproval) state.v++
      if (loseApprovalAnswer) throw new TypeError("fetch failed")
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

// L-FLOW-RECEIPT-1 (a86): a request that gets no answer, or whose body can't be read, fails its own step with the
// outcome unknown, and the run still returns its evidence: the run, the place it knows and the steps so far. Nothing
// after that step is attempted. The command writes its report and exits nonzero.
test("an approval whose answer is lost after it committed fails 'approved', with the evidence kept and nothing after it", async () => {
  const site = stagingSite({ loseApprovalAnswer: true })
  const r = await run(site)
  assert.equal(r.outcome, "fail")
  assert.match(r.place, /^p_/)
  assert.deepEqual(
    r.steps.map((s) => [s.step, s.status]),
    [
      ["submitted", "pass"],
      ["queued", "pass"],
      ["approved", "fail"],
    ],
  )
  assert.match(r.steps[2].detail, /no answer: the outcome on the server is unknown/)
  // The place was published by the approval that committed; the flow attempts nothing after it.
  assert.equal(site.state.places.get(r.place).status, "published")
  assert.ok(!site.state.calls.some((c) => c.includes("/api/v1/version") || c.includes("/api/admin/suppressions")))
})

test("a body that can't be read fails its own step the same way", async () => {
  const r = await run(stagingSite({ unreadableAt: "/api/admin/queue" }))
  assert.equal(r.outcome, "fail")
  const failed = r.steps.find((s) => s.status === "fail")
  assert.equal(failed.step, "queued")
  assert.match(failed.detail, /no answer: the outcome on the server is unknown/)
})

// a88's note: a share page with no readable answer says so, at publication and at removal, never "not asked" or
// "undefined".
test("a share page with no readable answer is named unknown, at publication and at removal", async () => {
  const published = await run(stagingSite({ unreadableAt: (path) => path.startsWith("/place/") }))
  const atPublish = published.steps.find((s) => s.step === "published")
  assert.equal(atPublish.status, "fail")
  assert.match(atPublish.detail, /share page no answer: the outcome on the server is unknown/)

  const hidden = (path, state) => path.startsWith("/place/") && [...state.places.values()].some((p) => p.hidden)
  const removed = (await run(stagingSite({ unreadableAt: hidden }))).steps.find((s) => s.step === "removed")
  assert.equal(removed.status, "fail")
  assert.match(removed.detail, /share page no answer: the outcome on the server is unknown/)
})

// L-FLOW-HIDE-1 (a86): only the hide's own successful answer passes 'hidden'.
test("a moderator's view without a rev fails 'hidden' at once: no hide is sent and removal isn't checked", async () => {
  const site = stagingSite({ viewWithoutRev: true })
  const r = await run(site)
  assert.equal(r.outcome, "fail")
  assert.equal(r.steps.at(-1).step, "hidden")
  assert.equal(r.steps.at(-1).status, "fail")
  assert.ok(!site.state.calls.includes("POST /api/admin/suppressions"))
  const afterView = site.state.calls.slice(site.state.calls.lastIndexOf(`GET /api/admin/places/${r.place}`) + 1)
  assert.deepEqual(afterView, [])
})

// The deployment that answered (a86): every Worker answer's version tag is kept, and with --expect-tag one from another
// version fails the run.
test("the report names the version tags that answered, and an unexpected one fails the run", async () => {
  const r = await run(stagingSite())
  assert.deepEqual(r.versions, ["staging-abc"])
  const held = await stagingFlow("https://staging.example", {
    fetch: stagingSite({ tag: "staging-old" }).fetch,
    headers: MACHINE,
    turnstileToken: "dummy",
    timing: TIMING,
    expectTag: "staging-abc",
  })
  assert.equal(held.outcome, "fail")
  assert.match(held.version_failure, /staging-old/)
})

test("the command writes its report when a step fails, and exits nonzero", async () => {
  const dir = mkdtempSync(join(tmpdir(), "flow-"))
  const file = join(dir, "flow.json")
  const lines = []
  const code = await runCli(["https://staging.example", "--report", file, "--expect-tag", "staging-abc"], {
    env: { FLOW_HEADERS: JSON.stringify(MACHINE), FLOW_TURNSTILE_TOKEN: "dummy" },
    fetch: stagingSite({ loseApprovalAnswer: true }).fetch,
    log: (line) => lines.push(line),
    timing: TIMING,
  })
  assert.equal(code, 1)
  const report = JSON.parse(readFileSync(file, "utf8"))
  assert.equal(report.outcome, "fail")
  assert.equal(report.expect_tag, "staging-abc")
  assert.match(report.place, /^p_/)
  assert.deepEqual(
    report.steps.map((s) => s.step),
    ["submitted", "queued", "approved"],
  )
  assert.doesNotMatch(JSON.stringify(report), /machine-secret|a-tracking-token-never-kept/)
})
