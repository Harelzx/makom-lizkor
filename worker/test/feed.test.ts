import { exports } from "cloudflare:workers"
import { expect, it } from "vitest"
import { approve, submit } from "./helpers"

const get = (path: string) => exports.default.fetch(`http://local${path}`)
const version = async () => (await (await get("/api/v1/version")).json<{ v: string }>()).v

it("publishes only approved places, under the version that was read with them", async () => {
  const { id } = await submit("גן דמו")
  const v0 = await version()
  const feed0 = await (await get(`/api/v1/feed?v=${v0}`)).json<{ places: { id: string }[] }>()
  expect(feed0.places.some((p) => p.id === id)).toBe(false)

  expect((await approve(id)).status).toBe(200)

  const stale = await get(`/api/v1/feed?v=${v0}`)
  expect(stale.status).toBe(409)
  expect(stale.headers.get("Cache-Control")).toBe("no-store")
  const v1 = await version()
  expect(v1).not.toBe(v0)
  const res = await get(`/api/v1/feed?v=${v1}`)
  expect(res.headers.get("Cache-Control")).toBe("no-store")
  expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBe("max-age=60")
  expect(res.headers.get("Cache-Tag")).toBe("feed")
  const feed1 = await res.json<{ v: string; places: { id: string; name_he: string; precision: string; place_he: string }[] }>()
  expect(feed1.v).toBe(v1)
  expect(feed1.places.find((p) => p.id === id)).toMatchObject({ name_he: "גן דמו", precision: "exact", place_he: "" })
})

it("never carries the submitter's name or the tracking hash", async () => {
  const res = await exports.default.fetch("http://local/api/v1/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID().replaceAll("-", "") },
    body: JSON.stringify({
      kind: "grove",
      name_he: "חורשת דמו",
      lat: 31.4,
      lng: 34.5,
      submitter_name: "שם פרטי דמו",
      consent_version: "notice.submission@2026-10-2",
    }),
  })
  const { id } = await res.json<{ id: string }>()
  await approve(id)
  const body = await (await get(`/api/v1/feed?v=${await version()}`)).text()
  expect(body).toContain(id)
  expect(body).not.toContain("שם פרטי דמו")
  expect(body).not.toContain("tracking")
})

it("answers an unknown API path with a problem, not the site's page", async () => {
  const res = await get("/api/v1/nope")
  expect(res.status).toBe(404)
  expect(res.headers.get("Content-Type")).toContain("application/problem+json")
})

it("turns an unexpected failure into a problem without details", async () => {
  const res = await exports.default.fetch("http://local/__dev/login", { method: "POST", body: "{not json" })
  expect(res.status).toBe(500)
  expect(await res.json()).toEqual({ type: "about:blank", status: 500, code: "internal" })
})
