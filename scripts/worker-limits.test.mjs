import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { parse } from "yaml"
import { workerLimits, SCRIPT, WINDOW_HOURS } from "./worker-limits.mjs"

const NOW = Date.parse("2026-10-22T12:00:00Z")
function fake(rows, { status = 200, errors } = {}) {
  const calls = []
  const fetcher = async (url, options) => {
    calls.push({ url, options })
    return Response.json({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: rows }] } }, errors }, { status })
  }
  return { calls, fetcher }
}
const row = (status, requests) => ({ dimensions: { status }, sum: { requests } })

test("counts the production Worker's invocations by status over the window, with a read-only bearer", async () => {
  const { calls, fetcher } = fake([row("success", 900), row("clientDisconnected", 4)])
  const result = await workerLimits({ token: "t", account: "a", now: NOW, fetcher })
  assert.deepEqual(result, {
    ok: true,
    since: new Date(NOW - WINDOW_HOURS * 3_600_000).toISOString(),
    stopped: 0,
    counts: { success: 900, clientDisconnected: 4 },
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, "https://api.cloudflare.com/client/v4/graphql")
  assert.equal(calls[0].options.headers.authorization, "Bearer t")
  const { variables, query } = JSON.parse(calls[0].options.body)
  assert.deepEqual(variables, { account: "a", script: SCRIPT, since: result.since })
  assert.match(query, /workersInvocationsAdaptive/)
  assert.doesNotMatch(query, /clientIP|userAgent|request\b|url/i)
})

test("an invocation stopped at a limit, or one that threw, fails the check", async () => {
  for (const status of ["exceededResources", "scriptThrewException"]) {
    const result = await workerLimits({ token: "t", account: "a", now: NOW, fetcher: fake([row("success", 10), row(status, 2)]).fetcher })
    assert.equal(result.ok, false)
    assert.equal(result.stopped, 2)
  }
})

test("fails closed when it can't read the numbers", async () => {
  await assert.rejects(workerLimits({ token: "", account: "a", fetcher: fake([]).fetcher }), /credentials_missing/)
  await assert.rejects(workerLimits({ token: "t", account: "a", fetcher: fake([], { status: 403 }).fetcher }), /analytics_unavailable/)
  await assert.rejects(
    workerLimits({ token: "t", account: "a", fetcher: fake([], { errors: [{ message: "x" }] }).fetcher }),
    /analytics_unreadable/,
  )
  await assert.rejects(workerLimits({ token: "t", account: "a", fetcher: fake(null).fetcher }), /analytics_unreadable/)
  await assert.rejects(workerLimits({ token: "t", account: "a", fetcher: fake([row("a b", 1)]).fetcher }), /analytics_unreadable/)
})

test("the scheduled job gives the read-only token to the one step that reads, and installs nothing", () => {
  const workflow = parse(readFileSync(new URL("../.github/workflows/availability.yml", import.meta.url), "utf8"))
  const job = workflow.jobs.resources
  assert.equal(job["timeout-minutes"], 2)
  assert.equal(job.env, undefined)
  const steps = job.steps.filter((s) => s.run)
  assert.deepEqual(
    steps.map((s) => s.run),
    ["node scripts/worker-limits.mjs"],
  )
  assert.deepEqual(steps[0].env, { CF_ANALYTICS_READ: "${{ secrets.CF_ANALYTICS_READ }}", CF_ACCOUNT_ID: "${{ secrets.CF_ACCOUNT_ID }}" })
  assert(!JSON.stringify(job).includes("npm "))
})
