import { env, exports } from "cloudflare:workers"
import { describe, expect, it } from "vitest"
import { admin, submit } from "./helpers"

const queued = async (id: string) => {
  const { items } = await (await admin("/api/admin/queue")).json<{ items: { id: string; rev: number; revisionId: string }[] }>()
  return items.find((i) => i.id === id)!
}

describe("admin", () => {
  it("refuses without a token, refuses someone not on the list, and never caches", async () => {
    const anonymous = await exports.default.fetch("http://local/api/admin/queue")
    expect(anonymous.status).toBe(401)
    expect(anonymous.headers.get("Cache-Control")).toBe("private, no-store")
    const outsider = await admin("/api/admin/queue", {}, "someone@example.test")
    expect(outsider.status).toBe(403)
    expect(outsider.headers.get("Cache-Control")).toBe("private, no-store")
  })
  it("refuses a token signed with another key", async () => {
    const res = await exports.default.fetch("http://local/api/admin/queue", { headers: { "Cf-Access-Jwt-Assertion": "e30.e30.c2ln" } })
    expect(res.status).toBe(401)
  })
  it("refuses a cross-site change", async () => {
    const res = await admin("/api/admin/places/p_x/transitions", {
      method: "POST",
      body: "{}",
      headers: { "Sec-Fetch-Site": "cross-site" },
    })
    expect(res.status).toBe(403)
  })
  it("shows the moderator every field that would be published", async () => {
    const res = await exports.default.fetch("http://local/api/v1/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID().replaceAll("-", "") },
      body: JSON.stringify({
        kind: "lookout",
        name_he: "מצפור דמו לבדיקה",
        lat: 31.4321,
        lng: 34.5432,
        link_url: "https://example.test/memorial",
        consent_version: "notice.submission@2026-10-2",
      }),
    })
    const { id } = await res.json<{ id: string }>()
    expect(await queued(id)).toMatchObject({ kind: "lookout", lat: 31.4321, lng: 34.5432, link_url: "https://example.test/memorial" })
  })
  it("lists pending submissions with what a moderator needs to decide", async () => {
    const { id } = await submit("גן דמו לתור")
    const item = await queued(id)
    expect(item).toMatchObject({ id, rev: 1, name_he: "גן דמו לתור", kind: "bench" })
    expect((await admin("/api/admin/queue")).headers.get("Cache-Control")).toBe("private, no-store")
  })
  it("approves once: the feed moves on, and a second decision on the same revision conflicts", async () => {
    const { id } = await submit()
    const item = await queued(id)
    const before = await env.DB.prepare("SELECT n FROM feed_state").first<number>("n")
    const body = JSON.stringify({ action: "approve", revisionId: item.revisionId, expectedRev: item.rev })
    const [a, b] = await Promise.all([
      admin(`/api/admin/places/${id}/transitions`, { method: "POST", body }),
      admin(`/api/admin/places/${id}/transitions`, { method: "POST", body: body.replace("approve", "reject") }),
    ])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect([a, b].map((r) => r.headers.get("Cache-Control"))).toEqual(["private, no-store", "private, no-store"])
    expect(await env.DB.prepare("SELECT n FROM feed_state").first<number>("n")).toBe((before ?? 0) + (a.status === 200 ? 1 : 0))
    const audit = await env.DB.prepare("SELECT action, fields FROM audit_log WHERE entity_id = ?").bind(id).all()
    expect(audit.results).toHaveLength(1)
    expect(await queued(id)).toBeUndefined()
  })
  it("rejects without moving the feed", async () => {
    const { id } = await submit()
    const item = await queued(id)
    const before = await env.DB.prepare("SELECT n FROM feed_state").first<number>("n")
    const res = await admin(`/api/admin/places/${id}/transitions`, {
      method: "POST",
      body: JSON.stringify({ action: "reject", revisionId: item.revisionId, expectedRev: item.rev }),
    })
    expect(res.status).toBe(200)
    expect(await env.DB.prepare("SELECT n FROM feed_state").first<number>("n")).toBe(before)
    expect(await env.DB.prepare("SELECT status FROM places WHERE id = ?").bind(id).first("status")).toBe("rejected")
  })
})

describe("dev login", () => {
  it("sets the stand-in Access cookie, which the admin accepts", async () => {
    const res = await exports.default.fetch("http://local/__dev/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID().replaceAll("-", "") },
      body: JSON.stringify({ email: "dev@example.test" }),
    })
    expect(res.status).toBe(204)
    const cookie = res.headers.get("Set-Cookie")!.split(";")[0]
    const queue = await exports.default.fetch("http://local/api/admin/queue", { headers: { Cookie: cookie } })
    expect(queue.status).toBe(200)
  })
})
