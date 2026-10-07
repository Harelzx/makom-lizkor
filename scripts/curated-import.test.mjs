import assert from "node:assert/strict"
import { test } from "node:test"
import { importCurated } from "./curated-import.mjs"

// The importer (phase 7, task 2; adviser a50, P7-IMPORT-1) is a client of the moderators' route: it inserts only.
// A place that exists is left exactly as it is, its photos aren't even uploaded, and a create that loses a race
// counts as skipped. Its real behaviour against the Worker is in worker/test (the route's own tests and the seed).

const record = (id, photos = []) => ({ id, kind: "monument", name_he: id, photos, sources: [] })
const photo = (file) => ({ file, title: "t", author: "a", license: "CC0" })

/** The two routes as the importer sees them: places by id, uploads that hand out keys, and every call recorded. */
function stub({ existing = [], raceOn = [], fail = {} } = {}) {
  const places = new Set(existing)
  const calls = []
  let n = 0
  const fetch = async (url, init = {}) => {
    const { pathname } = new URL(url)
    const method = init.method ?? "GET"
    calls.push({ method, pathname, headers: init.headers, body: init.body })
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
    if (fail[pathname]) return json(fail[pathname], { code: "boom" })
    if (method === "GET") return places.has(pathname.split("/").pop()) ? json(200, { rev: 1 }) : json(404, { code: "not_found" })
    if (pathname === "/api/admin/curated-photos") {
      n++
      return json(201, { key: `quarantine/x/${n}.webp`, thumb_key: `quarantine/x/${n}.thumb.webp` })
    }
    const body = JSON.parse(init.body)
    if (raceOn.includes(body.id)) {
      places.add(body.id)
      return json(409, { code: "changed_meanwhile" })
    }
    places.add(body.id)
    return json(201, { id: body.id, rev: 1 })
  }
  return { fetch, calls, places }
}
const readPhoto = async (file) => ({ file: new Uint8Array([1]), thumb: new Uint8Array([2]), name: file })
const run = (s, records) =>
  importCurated({ fetch: s.fetch, base: "http://local", records, readPhoto, headers: { "Cf-Access-Jwt-Assertion": "token" } })

test("creates a new place with its photos uploaded first and sent by the keys they got, as a new record (rev 0)", async () => {
  const s = stub()
  assert.deepEqual(await run(s, [record("a", [photo("a.webp"), photo("b.webp")])]), { created: ["a"], skipped: [] })
  const sent = JSON.parse(s.calls.find((c) => c.pathname === "/api/admin/places").body)
  assert.equal(sent.expectedRev, 0)
  assert.deepEqual(
    sent.photos.map((p) => [p.key, p.thumb_key, p.file]),
    [
      ["quarantine/x/1.webp", "quarantine/x/1.thumb.webp", undefined],
      ["quarantine/x/2.webp", "quarantine/x/2.thumb.webp", undefined],
    ],
  )
  // Every change is a same-origin request with the moderator's credentials and an Idempotency-Key of its own.
  for (const c of s.calls.filter((x) => x.method === "POST")) {
    assert.equal(c.headers["Sec-Fetch-Site"], "same-origin")
    assert.equal(c.headers["Cf-Access-Jwt-Assertion"], "token")
  }
  assert.match(s.calls.find((c) => c.pathname === "/api/admin/places").headers["Idempotency-Key"], /^[0-9a-f]{32}$/)
})

test("leaves a place that exists exactly as it is: no upload, no write", async () => {
  const s = stub({ existing: ["a"] })
  assert.deepEqual(await run(s, [record("a", [photo("a.webp")]), record("b")]), { created: ["b"], skipped: ["a"] })
  assert.deepEqual(
    s.calls.filter((c) => c.method === "POST").map((c) => c.pathname),
    ["/api/admin/places"],
  )
})

test("a second run changes nothing", async () => {
  const s = stub()
  const records = [record("a", [photo("a.webp")]), record("b")]
  await run(s, records)
  const before = s.calls.length
  assert.deepEqual(await run(s, records), { created: [], skipped: ["a", "b"] })
  assert.ok(s.calls.slice(before).every((c) => c.method === "GET"))
})

test("a create that loses a race to another writer is skipped, not retried over it", async () => {
  const s = stub({ raceOn: ["a"] })
  assert.deepEqual(await run(s, [record("a")]), { created: [], skipped: ["a"] })
  assert.equal(s.calls.filter((c) => c.pathname === "/api/admin/places").length, 1)
})

test("stops at the first refusal, naming the place and the answer", async () => {
  const s = stub({ fail: { "/api/admin/places": 422 } })
  await assert.rejects(run(s, [record("a"), record("b")]), /a: 422 .*boom/)
  assert.equal(s.calls.filter((c) => c.method === "POST").length, 1)
})
