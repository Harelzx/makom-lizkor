import { call } from "./app"
import { env } from "cloudflare:workers"
import { describe, expect, it } from "vitest"

it("answers health checks", async () => {
  const res = await call("http://local/api/v1/health")
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
})

// The deploy tags each version with its commit or release (staging.yml, release.yml); every answer the Worker gives
// names it, so a check after a deploy can tell the new version's answers from the previous one's (a61).
describe("the serving version", () => {
  const tagged = (tag: string): Env => ({ ...env, CF_VERSION_METADATA: { id: "00000000-0000-0000-0000-000000000000", tag, timestamp: "" } })

  it("is named on every answer the Worker gives, with health's body unchanged", async () => {
    const health = await call("http://local/api/v1/health", {}, tagged("staging-201f873bf99a"))
    expect(health.headers.get("X-Worker-Version")).toBe("staging-201f873bf99a")
    expect(await health.json()).toEqual({ ok: true })
    const missing = await call("http://local/api/v1/no-such-route", {}, tagged("staging-201f873bf99a"))
    expect(missing.status).toBe(404)
    expect(missing.headers.get("X-Worker-Version")).toBe("staging-201f873bf99a")
    const page = await call("http://local/place/p_00000000000000000000000000", {}, tagged("v2026.10.1"))
    expect(page.headers.get("X-Worker-Version")).toBe("v2026.10.1")
  })

  it("is left out when the version has no tag: an untagged deploy names nothing", async () => {
    const res = await call("http://local/api/v1/health", {}, tagged(""))
    expect(res.headers.has("X-Worker-Version")).toBe(false)
  })
})
