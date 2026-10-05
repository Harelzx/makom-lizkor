import { env } from "cloudflare:workers"
import { expect, it } from "vitest"
import { CURRENT_SUBMISSION_NOTICE } from "@/shared/contract"
import { call } from "./app"
import { decide, queued, send } from "./submission-helpers"

/** A limiter that records the keys it is asked about, and lets everything through. */
const recording = () => {
  const keys: string[] = []
  return { keys, limiter: { limit: async ({ key }: { key: string }) => (keys.push(key), { success: true }) } as unknown as RateLimit }
}
const IP = "203.0.113.7"

it("the submission limiter is asked about a code derived from the address, never the address", async () => {
  const { keys, limiter } = recording()
  await call(
    "http://local/api/v1/submissions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""),
        "Turnstile-Token": "pass",
        "CF-Connecting-IP": IP,
      },
      body: JSON.stringify({
        kind: "bench",
        name_he: "ספסל דמו מגבלה",
        lat: 31.42,
        lng: 34.49,
        consent_version: CURRENT_SUBMISSION_NOTICE,
      }),
    },
    { ...env, SUBMIT_LIMIT: limiter },
  )
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toContain(IP)
  expect(keys[0]).toMatch(/^[0-9a-f]{64}$/)
})

it("the anemone limiter is asked about a code derived from the address, never the address", async () => {
  const { id } = await send("ספסל דמו מגבלת כלניות")
  await decide(id, await queued(id), "approve")
  const { keys, limiter } = recording()
  const hex = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("")
  await call(
    "http://local/api/v1/tributes",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": hex(), "CF-Connecting-IP": IP },
      body: JSON.stringify({ placeId: id, deviceId: hex() }),
    },
    { ...env, TRIBUTE_LIMIT: limiter },
  )
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toContain(IP)
  expect(keys[0]).toMatch(/^[0-9a-f]{64}$/)
})
