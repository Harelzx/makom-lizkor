import { env } from "cloudflare:workers"
import { call } from "./app"
import { describe, expect, it } from "vitest"
import { CURRENT_SUBMISSION_NOTICE } from "@/shared/contract"
import { approve } from "./helpers"

const send = async (name: string, extra: Record<string, unknown> = {}) => {
  const res = await call("http://local/api/v1/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""), "Turnstile-Token": "pass" },
    body: JSON.stringify({ kind: "bench", name_he: name, lat: 31.42, lng: 34.49, consent_version: CURRENT_SUBMISSION_NOTICE, ...extra }),
  })
  return res.json<{ id: string; trackingToken: string }>()
}
const as = (token: string) => ({ Authorization: `Bearer ${token}` })
const status = (id: string, token: string) => call(`http://local/api/v1/submissions/${id}`, { headers: as(token) })
const withdraw = (id: string, token: string) =>
  call(`http://local/api/v1/submissions/${id}/withdraw`, { method: "POST", headers: as(token) })
const feedVersion = () => env.DB.prepare("SELECT n FROM feed_state WHERE id = 1").first<number>("n")

describe("tracking a submission", () => {
  it("shows its status and name to the token's holder only", async () => {
    const { id, trackingToken } = await send("ספסל דמו למעקב")
    const ok = await status(id, trackingToken)
    expect(ok.headers.get("Cache-Control")).toBe("private, no-store")
    expect(await ok.json()).toMatchObject({ status: "pending", name_he: "ספסל דמו למעקב" })
    expect((await status(id, "nope")).status).toBe(404)
  })
})

describe("withdrawing", () => {
  it("erases the content and the sender's name at once, and leaves a tombstone", async () => {
    const { id, trackingToken } = await send("ספסל דמו למשיכה", { submitter_name: "שם פרטי דמו", story_he: "סיפור דמו" })
    const res = await withdraw(id, trackingToken)
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("private, no-store")
    expect(await (await status(id, trackingToken)).json()).toMatchObject({ status: "withdrawn", name_he: null })
    const rev = await env.DB.prepare("SELECT state, name_he, story_he, lat, lng FROM revisions WHERE place_id = ?").bind(id).first()
    expect(rev).toEqual({ state: "withdrawn", name_he: null, story_he: null, lat: null, lng: null })
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM contacts WHERE place_id = ?").bind(id).first("n")).toBe(0)
    const audit = await env.DB.prepare("SELECT actor, action FROM audit_log WHERE entity_id = ?").bind(id).all()
    expect(audit.results).toContainEqual({ actor: "submitter", action: "withdraw" })
  })
  it("takes a published place off the feed", async () => {
    const { id, trackingToken } = await send("ספסל דמו שפורסם ונמשך")
    await approve(id)
    const before = await feedVersion()
    await withdraw(id, trackingToken)
    expect(await feedVersion()).toBe((before ?? 0) + 1)
    const v = (await (await call("http://local/api/v1/version")).json<{ v: string }>()).v
    const feed = await (await call(`http://local/api/v1/feed?v=${v}`)).json<{ places: { id: string }[] }>()
    expect(feed.places.some((p) => p.id === id)).toBe(false)
  })
  it("is safe to send twice, and moves the feed only for a published place", async () => {
    const { id, trackingToken } = await send("ספסל דמו נמשך פעמיים")
    const before = await feedVersion()
    expect((await withdraw(id, trackingToken)).status).toBe(200)
    expect((await withdraw(id, trackingToken)).status).toBe(200)
    expect(await feedVersion()).toBe(before)
    const audit = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id = ? AND action = 'withdraw'")
      .bind(id)
      .first("n")
    expect(audit).toBe(1)
  })
  it("refuses without the token", async () => {
    const { id } = await send("ספסל דמו בלי טוקן")
    expect((await withdraw(id, "nope")).status).toBe(404)
    expect(await env.DB.prepare("SELECT status FROM places WHERE id = ?").bind(id).first("status")).toBe("pending")
  })
  it("leaves the moderator's queue", async () => {
    const { id, trackingToken } = await send("ספסל דמו יוצא מהתור")
    await withdraw(id, trackingToken)
    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM places p JOIN revisions r ON r.place_id = p.id WHERE p.id = ? AND p.status = 'pending'",
    )
      .bind(id)
      .first("n")
    expect(rows).toBe(0)
  })
})
