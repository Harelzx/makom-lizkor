import { env, exports } from "cloudflare:workers"
import { describe, expect, it } from "vitest"
import { CURRENT_SUBMISSION_NOTICE } from "@/shared/contract"

const body = (name: string) => ({ kind: "bench", name_he: name, lat: 31.42, lng: 34.49, consent_version: CURRENT_SUBMISSION_NOTICE })
const key = () => crypto.randomUUID().replaceAll("-", "")
const post = (b: unknown, k?: string) =>
  exports.default.fetch("http://local/api/v1/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(k ? { "Idempotency-Key": k } : {}) },
    body: JSON.stringify(b),
  })
const count = (name: string) => env.DB.prepare("SELECT COUNT(*) AS n FROM revisions WHERE name_he = ?").bind(name).first<number>("n")

describe("a retried submission", () => {
  it("is one place when the first answer never arrived", async () => {
    const k = key()
    const first = await post(body("ספסל דמו אבוד"), k) // the browser never sees this answer
    expect(first.status).toBe(201)
    const again = await post(body("ספסל דמו אבוד"), k)
    expect(again.status).toBe(200)
    const a = await first.json<{ id: string }>()
    const b = await again.json<{ id: string; trackingToken: string }>()
    expect(b.id).toBe(a.id)
    expect(await count("ספסל דמו אבוד")).toBe(1)
    // the token from the retry is the one that works now
    const status = await exports.default.fetch(`http://local/api/v1/submissions/${b.id}`, {
      headers: { Authorization: `Bearer ${b.trackingToken}` },
    })
    expect(status.status).toBe(200)
  })
  it("is one place when both tries arrive at once", async () => {
    const k = key()
    const [x, y] = await Promise.all([post(body("ספסל דמו כפול"), k), post(body("ספסל דמו כפול"), k)])
    expect([x.status, y.status].sort()).toEqual([200, 201])
    expect((await x.json<{ id: string }>()).id).toBe((await y.json<{ id: string }>()).id)
    expect(await count("ספסל דמו כפול")).toBe(1)
  })
  it("refuses the same key with different content", async () => {
    const k = key()
    expect((await post(body("ספסל דמו א"), k)).status).toBe(201)
    const other = await post(body("ספסל דמו ב"), k)
    expect(other.status).toBe(409)
    expect(await other.json()).toMatchObject({ code: "idempotency_key_reused" })
    expect(await count("ספסל דמו ב")).toBe(0)
  })
  it("requires a key", async () => {
    const res = await post(body("ספסל דמו בלי מפתח"))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: "idempotency_key_required" })
  })
  it("keeps only the key's hash", async () => {
    const k = key()
    const { id } = await (await post(body("ספסל דמו גיבוב"), k)).json<{ id: string }>()
    const row = await env.DB.prepare("SELECT submit_key_hash FROM places WHERE id = ?").bind(id).first<string>("submit_key_hash")
    expect(row).toMatch(/^[0-9a-f]{64}$/)
    expect(row).not.toContain(k)
  })
})
