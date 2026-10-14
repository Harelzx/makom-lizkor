import { env } from "cloudflare:workers"
import { expect, it } from "vitest"
import { CURRENT_SUBMISSION_NOTICE } from "@/shared/contract"
import { call } from "./app"
import { SUBMISSIONS_PER_DAY } from "../routes/submissions"
import { EXPORT_TABLES } from "../db/exports"
import { pruneCounters } from "../lib/metrics"

// The per-minute cap is set aside, so what refuses is the day's.
const e = { ...env, SUBMIT_LIMIT: { limit: async () => ({ success: true }) } } as unknown as Env
const at = (minutes: number) => new Date(Date.UTC(2027, 2, 1, 9, minutes)).toISOString()
const submit = (address: string, when: string, token = "pass") =>
  call(
    "http://local/api/v1/submissions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""),
        "Turnstile-Token": token,
        "CF-Connecting-IP": address,
        "X-Test-Now": when,
      },
      body: JSON.stringify({ kind: "bench", name_he: "ספסל דמו", lat: 31.42, lng: 34.49, consent_version: CURRENT_SUBMISSION_NOTICE }),
    },
    e,
  )

it("refuses a visitor's submissions past the day's ceiling, before the browser check, so one address can't fill the review queue", async () => {
  // The queue holds QUEUE_LIMIT (200) for everyone; without this, one address solving checks could fill it and every
  // other sender would be told the queue is full. A community adding its corners in one day stays well under.
  const address = "198.51.100.90"
  for (let i = 0; i < SUBMISSIONS_PER_DAY; i++) expect((await submit(address, at(i))).status).toBe(201)
  const refused = await submit(address, at(30), "fail")
  expect(refused.status).toBe(429)
  expect((await refused.json<{ code: string }>()).code).toBe("daily_limit")
  expect(refused.headers.get("Retry-After")).toBe("3600")
  // Another address is not held up, and the first may send again the next day.
  expect((await submit("198.51.100.91", at(31))).status).toBe(201)
  expect((await submit(address, new Date(Date.UTC(2027, 2, 2, 10, 0)).toISOString())).status).toBe(201)
})

it("keeps only a keyed code of the address with the place id, never in a backup, and for two days at most", async () => {
  await submit("198.51.100.92", at(40))
  const rows = (await env.DB.prepare("SELECT * FROM submission_senders").all<Record<string, string>>()).results
  expect(JSON.stringify(rows)).not.toContain("198.51.100")
  expect(EXPORT_TABLES).not.toContain("submission_senders")
  await pruneCounters(env, new Date(Date.UTC(2027, 2, 10)))
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM submission_senders").first<number>("n")).toBe(0)
})
