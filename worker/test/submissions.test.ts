import { env, exports } from "cloudflare:workers"
import { describe, expect, it } from "vitest"

const valid = { kind: "bench", name_he: "ספסל דמו", lat: 31.42, lng: 34.49, consent_version: "notice.submission@2026-10-1" }
const post = (body: unknown) =>
  exports.default.fetch("http://local/api/v1/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

describe("POST /api/v1/submissions", () => {
  it("accepts a place without any email, and stores only the token's hash", async () => {
    const res = await post(valid)
    expect(res.status).toBe(201)
    expect(res.headers.get("Cache-Control")).toBe("private, no-store")
    const { id, trackingToken } = await res.json<{ id: string; trackingToken: string }>()
    expect(id).toMatch(/^p_/)
    const row = await env.DB.prepare("SELECT status, tracking_token_hash FROM places WHERE id = ?")
      .bind(id)
      .first<{ status: string; tracking_token_hash: string }>()
    expect(row?.status).toBe("pending")
    expect(row?.tracking_token_hash).not.toContain(trackingToken)
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM contacts WHERE place_id = ?").bind(id).first("n")).toBe(0)
  })
  it("strips bidi controls from the name", async () => {
    const { id } = await (await post({ ...valid, name_he: "ספסל‮ דמו" })).json<{ id: string }>()
    expect(await env.DB.prepare("SELECT name_he FROM revisions WHERE place_id = ?").bind(id).first("name_he")).toBe("ספסל דמו")
  })
  it("refuses unknown fields, a place outside Israel and a community", async () => {
    for (const body of [
      { ...valid, extra: 1 },
      { ...valid, lat: 40 },
      { ...valid, kind: "community" },
    ]) {
      const res = await post(body)
      expect(res.status).toBe(400)
      expect(res.headers.get("Content-Type")).toContain("application/problem+json")
    }
  })
})

describe("GET /api/v1/submissions/:id", () => {
  it("shows the status only to the holder of the tracking token", async () => {
    const { id, trackingToken } = await (await post(valid)).json<{ id: string; trackingToken: string }>()
    const ok = await exports.default.fetch(`http://local/api/v1/submissions/${id}`, {
      headers: { Authorization: `Bearer ${trackingToken}` },
    })
    expect(ok.status).toBe(200)
    expect(ok.headers.get("Cache-Control")).toBe("private, no-store")
    expect(await ok.json()).toEqual({ status: "pending" })
    const wrong = await exports.default.fetch(`http://local/api/v1/submissions/${id}`, { headers: { Authorization: "Bearer nope" } })
    expect(wrong.status).toBe(404)
    expect(wrong.headers.get("Cache-Control")).toBe("private, no-store")
  })
})
