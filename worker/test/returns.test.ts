import { env } from "cloudflare:workers"
import { call } from "./app"
import { describe, expect, it } from "vitest"
import { CURRENT_SUBMISSION_NOTICE } from "@/shared/contract"
import { admin } from "./helpers"

type Item = { id: string; rev: number; revisionId: string; name_he: string; correction: number }

const send = async (name: string) => {
  const res = await call("http://local/api/v1/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""), "Turnstile-Token": "pass" },
    body: JSON.stringify({ kind: "bench", name_he: name, lat: 31.42, lng: 34.49, consent_version: CURRENT_SUBMISSION_NOTICE }),
  })
  return res.json<{ id: string; trackingToken: string }>()
}
const queued = async (id: string) =>
  ((await (await admin("/api/admin/queue")).json<{ items: Item[] }>()).items as Item[]).find((i) => i.id === id)
const decide = async (id: string, action: string, note?: string) => {
  const item = (await queued(id))!
  return admin(`/api/admin/places/${id}/transitions`, {
    method: "POST",
    body: JSON.stringify({ action, revisionId: item.revisionId, expectedRev: item.rev, ...(note ? { note } : {}) }),
  })
}
const tracked = async (id: string, token: string) =>
  (await call(`http://local/api/v1/submissions/${id}`, { headers: { Authorization: `Bearer ${token}` } })).json<{
    status: string
    rev: number
    name_he: string | null
    note?: string
    revision_state?: string
  }>()
const revise = (id: string, token: string, body: Record<string, unknown>) =>
  call(`http://local/api/v1/submissions/${id}/revisions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "Turnstile-Token": "pass-revise" },
    body: JSON.stringify({ consent_version: CURRENT_SUBMISSION_NOTICE, ...body }),
  })
const feed = async () => {
  const v = (await (await call("http://local/api/v1/version")).json<{ v: string }>()).v
  return (await (await call(`http://local/api/v1/feed?v=${v}`)).json<{ places: { id: string; name_he: string }[] }>()).places
}

describe("returning a submission", () => {
  it("needs a note, and the sender sees it", async () => {
    const { id, trackingToken } = await send("ספסל דמו להחזרה")
    expect((await decide(id, "return")).status).toBe(400)
    expect((await decide(id, "return", "חסר שם היישוב")).status).toBe(200)
    expect(await tracked(id, trackingToken)).toMatchObject({ status: "returned", note: "חסר שם היישוב" })
    expect(await queued(id)).toBeUndefined()
  })
  it("comes back to the queue as a new revision once the sender corrects it", async () => {
    const { id, trackingToken } = await send("ספסל דמו לתיקון")
    await decide(id, "return", "נא להוסיף יישוב")
    const { rev } = await tracked(id, trackingToken)
    const res = await revise(id, trackingToken, { expectedRev: rev, name_he: "ספסל דמו מתוקן", place_he: "בארי" })
    expect(res.status).toBe(200)
    const t = await tracked(id, trackingToken)
    expect(t).toMatchObject({ status: "pending", name_he: "ספסל דמו מתוקן" })
    expect(t.note).toBeUndefined()
    expect(await queued(id)).toMatchObject({ name_he: "ספסל דמו מתוקן", correction: 0 })
    const states = await env.DB.prepare("SELECT n, state FROM revisions WHERE place_id = ? ORDER BY n").bind(id).all()
    expect(states.results).toEqual([
      { n: 1, state: "superseded" },
      { n: 2, state: "pending" },
    ])
  })
  it("refuses a correction from a stale view, without the token, or while the place waits for review", async () => {
    const { id, trackingToken } = await send("ספסל דמו לבדיקת תיקון")
    expect((await revise(id, trackingToken, { expectedRev: 1, name_he: "שם אחר" })).status).toBe(409)
    await decide(id, "return", "הערה")
    expect((await revise(id, "nope", { expectedRev: 2, name_he: "שם אחר" })).status).toBe(404)
    expect((await revise(id, trackingToken, { expectedRev: 1, name_he: "שם אחר" })).status).toBe(409)
  })
})

describe("correcting a published place", () => {
  it("keeps the published version live until the correction is approved", async () => {
    const { id, trackingToken } = await send("ספסל דמו מפורסם")
    await decide(id, "approve")
    const { rev } = await tracked(id, trackingToken)
    expect((await revise(id, trackingToken, { expectedRev: rev, name_he: "ספסל דמו מפורסם ומתוקן" })).status).toBe(200)
    expect((await feed()).find((p) => p.id === id)?.name_he).toBe("ספסל דמו מפורסם")
    expect(await queued(id)).toMatchObject({ correction: 1 })
    expect((await decide(id, "approve")).status).toBe(200)
    expect((await feed()).find((p) => p.id === id)?.name_he).toBe("ספסל דמו מפורסם ומתוקן")
    const states = await env.DB.prepare("SELECT n, state FROM revisions WHERE place_id = ? ORDER BY n").bind(id).all()
    expect(states.results).toEqual([
      { n: 1, state: "superseded" },
      { n: 2, state: "approved" },
    ])
  })
  it("stays published when a correction is rejected", async () => {
    const { id, trackingToken } = await send("ספסל דמו שנשאר")
    await decide(id, "approve")
    const { rev } = await tracked(id, trackingToken)
    await revise(id, trackingToken, { expectedRev: rev, name_he: "שם שלא אושר" })
    expect((await decide(id, "reject")).status).toBe(200)
    expect(await tracked(id, trackingToken)).toMatchObject({ status: "published", name_he: "ספסל דמו שנשאר", revision_state: "rejected" })
    expect((await feed()).find((p) => p.id === id)?.name_he).toBe("ספסל דמו שנשאר")
  })
})
