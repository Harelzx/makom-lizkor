import { env } from "cloudflare:workers"
import { describe, expect, it } from "vitest"
import { jerusalemDay } from "../lib/day"
import { call } from "./app"
import { decide, queued, send } from "./submission-helpers"

const hex = (bytes = 16) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("")
const tribute = (placeId: string, deviceId: string, key = hex(), at?: string, e: Env = env) =>
  call(
    "http://local/api/v1/tributes",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key, ...(at ? { "X-Test-Now": at } : {}) },
      body: JSON.stringify({ placeId, deviceId }),
    },
    e,
  )
const result = async (res: Response) => ({ status: res.status, ...(await res.json<{ counted?: boolean; reason?: string }>()) })
const totals = async () => (await (await call("http://local/api/v1/tributes")).json<{ totals: Record<string, number> }>()).totals
async function published(name: string) {
  const { id, trackingToken } = await send(name)
  await decide(id, await queued(id), "approve")
  return { id, trackingToken }
}

describe("the day an anemone is counted on", () => {
  it("is Jerusalem's date when the server receives it, summer time and winter time alike", () => {
    expect(jerusalemDay(new Date("2026-07-01T21:30:00Z"))).toBe("2026-07-02")
    expect(jerusalemDay(new Date("2026-12-01T21:30:00Z"))).toBe("2026-12-01")
    expect(jerusalemDay(new Date("2026-12-01T22:30:00Z"))).toBe("2026-12-02")
  })
})

describe("anemones", () => {
  it("one left at a published place is counted, and shows in the totals", async () => {
    const { id } = await published("ספסל דמו כלנית")
    expect(await result(await tribute(id, hex()))).toEqual({ status: 200, counted: true })
    expect((await totals())[id]).toBe(1)
  })

  it("the same anemone sent again, even at the same moment, is counted once", async () => {
    const { id } = await published("ספסל דמו כלנית כפולה")
    const device = hex()
    const key = hex()
    const both = await Promise.all([tribute(id, device, key), tribute(id, device, key)])
    expect((await Promise.all(both.map(result))).map((r) => r.counted)).toEqual([true, true])
    expect((await result(await tribute(id, device, key))).reason).toBe("replayed")
    expect((await totals())[id]).toBe(1)
  })

  it("a second anemone from the same device the same day isn't counted; the next day it is", async () => {
    const { id } = await published("ספסל דמו כלנית ביום")
    const device = hex()
    expect((await result(await tribute(id, device, hex(), "2026-12-01T10:00:00Z"))).counted).toBe(true)
    expect(await result(await tribute(id, device, hex(), "2026-12-01T21:59:00Z"))).toEqual({
      status: 200,
      counted: false,
      reason: "already_today",
    })
    expect((await result(await tribute(id, device, hex(), "2026-12-01T22:01:00Z"))).counted).toBe(true)
    expect((await totals())[id]).toBe(2)
  })

  it("an anemone sent again after midnight is still the one counted before it", async () => {
    const { id } = await published("ספסל דמו כלנית בחצות")
    const device = hex()
    const key = hex()
    await tribute(id, device, key, "2026-12-01T21:59:00Z")
    expect((await result(await tribute(id, device, key, "2026-12-01T22:01:00Z"))).reason).toBe("replayed")
    expect((await totals())[id]).toBe(1)
  })

  it("a key reused for another place is refused", async () => {
    const a = await published("ספסל דמו מפתח א")
    const b = await published("ספסל דמו מפתח ב")
    const key = hex()
    await tribute(a.id, hex(), key)
    expect((await tribute(b.id, hex(), key)).status).toBe(409)
  })

  it("a place that isn't published gets none: pending, withdrawn, curated (not in D1 yet) or unknown", async () => {
    const pending = await send("ספסל דמו ממתין לכלנית")
    const gone = await published("ספסל דמו נמשך עם כלנית")
    await tribute(gone.id, hex())
    await call(`http://local/api/v1/submissions/${gone.id}/withdraw`, {
      method: "POST",
      headers: { Authorization: `Bearer ${gone.trackingToken}` },
    })
    for (const id of [pending.id, gone.id, "kibbutz-beeri-memorial", "p_01ZZZZZZZZZZZZZZZZZZZZZZZZ"])
      expect(await result(await tribute(id, hex()))).toEqual({ status: 200, counted: false, reason: "not_published" })
    const t = await totals()
    expect(t[pending.id]).toBeUndefined()
    expect(t[gone.id]).toBeUndefined()
  })

  it("stores no device id: only a keyed hash that differs from day to day", async () => {
    const { id } = await published("ספסל דמו בלי מזהה")
    const device = hex()
    await tribute(id, device, hex(), "2026-12-01T10:00:00Z")
    await tribute(id, device, hex(), "2026-12-02T10:00:00Z")
    const { results } = await env.DB.prepare("SELECT * FROM tribute_events WHERE place_id = ?").bind(id).all<Record<string, string>>()
    expect(results).toHaveLength(2)
    expect(JSON.stringify(results)).not.toContain(device)
    expect(results[0].device_key).not.toBe(results[1].device_key)
  })

  it("refuses malformed input, and counts nothing without its secret", async () => {
    const { id } = await published("ספסל דמו קלט פגום")
    expect((await tribute(id, "not-hex")).status).toBe(400)
    expect((await tribute(id, hex(), "short")).status).toBe(400)
    expect((await tribute(id, hex(), hex(), undefined, { ...env, TRIBUTE_SECRET: "" })).status).toBe(503)
    expect((await totals())[id]).toBeUndefined()
  })

  it("the totals are never cached by the browser", async () => {
    const res = await call("http://local/api/v1/tributes")
    expect(res.headers.get("Cache-Control")).toBe("no-store")
  })
})
