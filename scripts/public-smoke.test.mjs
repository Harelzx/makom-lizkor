import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { parse } from "yaml"
import { publicSmoke, PUBLIC_ORIGIN } from "./public-smoke.mjs"
function fake({ rootStatus = 200, privateStatus = 302, csp = "object-src 'none'", stale = false, large = false } = {}) {
  const calls = []
  const fetcher = async (url, options) => {
    calls.push({ url, options })
    const path = new URL(url).pathname
    if (path === "/")
      return new Response('<html lang="he"></html>', {
        status: rootStatus,
        headers: { "content-type": "text/html", "content-security-policy": csp },
      })
    if (path === "/api/v1/version") return Response.json({ v: "epoch.1" }, { headers: { "cache-control": "no-store" } })
    if (path === "/api/v1/feed") {
      if (stale) {
        stale = false
        return Response.json({ v: "epoch.2" }, { status: 409 })
      }
      return Response.json(
        { places: [{ id: "synthetic", story: large ? "x".repeat(2 * 1024 * 1024) : "" }] },
        { headers: { "cache-control": "no-store" } },
      )
    }
    return new Response(null, { status: privateStatus, headers: { location: "https://unit.cloudflareaccess.com/cdn-cgi/access/login" } })
  }
  return { calls, fetcher }
}
test("checks public readiness and private denials with seven bounded GETs and no credentials", async () => {
  const { fetcher, calls } = fake()
  assert.equal((await publicSmoke(fetcher)).public_count, 1)
  assert.equal(calls.length, 7)
  for (const { url, options } of calls) {
    assert(url.startsWith(PUBLIC_ORIGIN + "/"))
    assert.deepEqual(Object.keys(options).sort(), ["redirect", "signal"])
    assert.equal(options.redirect, "manual")
  }
})
test("a real publication handoff is followed only once, rather than retrying errors", async () => {
  const { fetcher, calls } = fake({ stale: true })
  assert.equal((await publicSmoke(fetcher)).ok, true)
  assert.equal(calls.length, 8)
})
for (const [name, options] of Object.entries({
  unavailable: { rootStatus: 503 },
  private_exposed: { privateStatus: 200 },
  missing_csp: { csp: "" },
  excessive_body: { large: true },
})) {
  test("fails closed: " + name, async () => {
    await assert.rejects(publicSmoke(fake(options).fetcher))
  })
}

test("scheduled probe is bounded, read-only and needs no cloud or mail credentials", () => {
  const workflow = parse(readFileSync(new URL("../.github/workflows/availability.yml", import.meta.url), "utf8"))
  assert.deepEqual(workflow.permissions, { contents: "read" })
  assert.deepEqual(workflow.on.schedule, [{ cron: "23 */6 * * *" }])
  assert.equal(workflow.jobs.public["timeout-minutes"], 2)
  assert.equal(
    workflow.jobs.public.steps
      .filter((s) => s.run)
      .map((s) => s.run)
      .join("\n"),
    "node scripts/public-smoke.mjs",
  )
  const text = JSON.stringify(workflow)
  assert(!text.includes("secrets."))
  assert(!text.includes("npm ci"))
  assert(!text.includes("id-token"))
})
