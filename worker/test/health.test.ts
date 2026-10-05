import { exports } from "cloudflare:workers"
import { expect, it } from "vitest"

it("answers health checks", async () => {
  const res = await exports.default.fetch("http://local/api/v1/health")
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
})
