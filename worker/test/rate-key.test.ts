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

it("counts an IPv6 visitor by their /64, which one connection usually holds whole, and IPv4 by the address", async () => {
  const { rateKey } = await import("../lib/ids")
  const s = "secret"
  // Every address inside one /64 (however it is written) is one visitor to the limiter.
  const same = ["2001:db8:aa:bb::1", "2001:db8:aa:bb:ffff:1:2:3", "2001:0db8:00aa:00bb:0:0:0:9", "2001:DB8:AA:BB::"]
  const keys = await Promise.all(same.map((a) => rateKey(s, a)))
  expect(new Set(keys).size).toBe(1)
  expect(await rateKey(s, "2001:db8:aa:bc::1")).not.toBe(keys[0])
  expect(await rateKey(s, "2001:db8::1")).not.toBe(await rateKey(s, "2001:db8:0:1::1"))
  expect(await rateKey(s, "203.0.113.7")).not.toBe(await rateKey(s, "203.0.113.8"))
})

it("reads a mapped IPv4 address as IPv4, and never fails on an address it can't parse", async () => {
  const { rateKey } = await import("../lib/ids")
  expect(await rateKey("s", "::ffff:203.0.113.7")).toBe(await rateKey("s", "203.0.113.7"))
  for (const odd of ["1:2:3:4:5:6:7:8::9", "1::2::3", "zz::1", "1:2:3:4:5:6:7:8:9", "fe80::1%eth0", ""])
    expect(await rateKey("s", odd)).toMatch(/^[0-9a-f]{64}$/)
  // Distinct unparseable strings stay distinct visitors rather than collapsing into one.
  expect(await rateKey("s", "1::2::3")).not.toBe(await rateKey("s", "1::2::4"))
})
