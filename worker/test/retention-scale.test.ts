import { env } from "cloudflare:workers"
import { beforeAll, describe, expect, it } from "vitest"
import { RETENTION } from "@/config"
import { setReportStatus } from "../db/moderation"
import { runJobs } from "../jobs"
import { durations } from "../lib/durations"
import { REPORT_GUARDS } from "../lib/guards"
import { sendMail } from "../lib/mail"
import { call } from "./app"
import { approve, submit } from "./helpers"

// The staging scale end to end (L-RET A2, a87): with RETENTION_DAY_SECONDS=7200 on staging, every deadline the routes
// write and every cutoff the jobs read is in two-hour days and five-minute hours, so spec 7's staging test can watch
// them pass; the same request on a real day keeps real deadlines, and any other environment refuses the value before
// anything is written. X-Test-Now is off outside development, so the routes here run on the real clock.
const DAY = 7_200_000
const HOUR = 300_000
const STAGED = { ...env, ENVIRONMENT: "staging", RETENTION_DAY_SECONDS: "7200" } as Env
const REFUSED = { ...env, ENVIRONMENT: "production", RETENTION_DAY_SECONDS: "7200" } as Env
const deps = { sendMail, purge: async () => true }
const ms = (iso: unknown) => new Date(iso as string).getTime()
const count = (table: string) => env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<number>("n")

const submitIn = (e: Env, name: string) =>
  call(
    "http://local/api/v1/submissions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""),
        "Turnstile-Token": "pass",
      },
      body: JSON.stringify({
        kind: "bench",
        name_he: name,
        lat: 31.42,
        lng: 34.49,
        consent_version: "notice.submission@2026-10-2",
        submitter_name: "שולח דמו",
        email: "dev@example.test",
      }),
    },
    e,
  )
const reportIn = (e: Env, placeId: string) =>
  call(
    "http://local/api/v1/reports",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""),
        "Turnstile-Token": "pass-report",
        "CF-Connecting-IP": "198.51.100.7",
      },
      body: JSON.stringify({
        placeId,
        elements: ["name_he"],
        requesterType: "family",
        relationship: "אח",
        explanation: `שם אחי מופיע כאן בלי רשות, נבקש להסיר אותו. ${crypto.randomUUID()}`,
        noticeVersion: "notice.report@2026-10-1",
        email: "dev@example.test",
      }),
    },
    e,
  )
const reportRow = (ticket: string) =>
  env.DB.prepare("SELECT * FROM reports WHERE id = ?").bind(ticket).first<Record<string, string | number | null>>()

let place = ""
beforeAll(async () => {
  const { id } = await submit("גינת דמו לשעון המקוצר")
  await approve(id)
  place = id
})

describe("the staging retention scale, end to end", () => {
  it("a submission's contact gets its ceiling and its link's expiry in staged days", async () => {
    const res = await submitIn(STAGED, "ספסל דמו בשעון המקוצר")
    expect(res.status).toBe(201)
    const { id } = await res.json<{ id: string }>()
    const c = await env.DB.prepare("SELECT * FROM contacts WHERE place_id = ?").bind(id).first<Record<string, string>>()
    expect(ms(c!.ceiling_at) - ms(c!.created_at)).toBe(RETENTION.contactMaxMonths * 30 * DAY)
    expect(ms(c!.email_verify_expires) - ms(c!.created_at)).toBe(7 * DAY)

    // The same submission on a real day keeps the real deadlines.
    const real = await (await submitIn(env, "ספסל דמו ביום אמיתי")).json<{ id: string }>()
    const r = await env.DB.prepare("SELECT * FROM contacts WHERE place_id = ?").bind(real.id).first<Record<string, string>>()
    expect(ms(r!.ceiling_at) - ms(r!.created_at)).toBe(RETENTION.contactMaxMonths * 30 * 86_400_000)
  })

  it("a request and its hide get their ceilings in staged days, a held-back one its backstop in staged hours, a close its date", async () => {
    // The first complete request hides at once (the precaution); its hide keeps its notes to the same staged ceiling.
    const first = await reportIn(STAGED, place)
    expect(first.status).toBe(202)
    const hid = await first.json<{ ticket: string; outcome: string }>()
    expect(hid.outcome).toBe("hidden_for_review")
    const row = await reportRow(hid.ticket)
    expect(ms(row!.ceiling_at) - ms(row!.received_at)).toBe(RETENTION.contactMaxMonths * 30 * DAY)
    const hide = await env.DB.prepare("SELECT created_at, notes_ceiling_at FROM field_suppressions WHERE report_id = ?")
      .bind(hid.ticket)
      .first<Record<string, string>>()
    expect(ms(hide!.notes_ceiling_at) - ms(hide!.created_at)).toBe(RETENTION.contactMaxMonths * 30 * DAY)

    // A second one the same staged day is held back, and the backstop looks at it after the staged hours.
    const held = await (await reportIn(STAGED, place)).json<{ ticket: string; outcome: string }>()
    expect(held.outcome).toBe("received")
    const second = await reportRow(held.ticket)
    expect(ms(second!.backstop_at) - ms(second!.received_at)).toBe(REPORT_GUARDS.backstopHours * HOUR)

    // Closing it, as the admin route does with its env's durations (staging's Access isn't the tests' dev sign-in).
    const closed = new Date()
    expect(await setReportStatus(env.DB, held.ticket, "closed", "dev@example.test", "טופל", closed, durations(STAGED))).toBe(true)
    expect(ms((await reportRow(held.ticket))!.purge_after)).toBe(closed.getTime() + RETENTION.contactAfterCloseDays * DAY)
  })

  it("the jobs clear a request's abuse codes after the notice's staged hours, which a real day wouldn't yet", async () => {
    const { ticket } = await (await reportIn(STAGED, place)).json<{ ticket: string }>()
    const fresh = (await reportRow(ticket))!
    expect([fresh.reporter_key, fresh.explanation_hash]).not.toContain(null)
    const received = ms(fresh.received_at)
    const past = new Date(received + (RETENTION.reportAbuseCodeMaxHours - 0.5) * HOUR + 1000)

    await runJobs(env, deps, undefined, past)
    expect((await reportRow(ticket))!.reporter_key).not.toBeNull()
    await runJobs(STAGED, deps, undefined, past)
    const after = await reportRow(ticket)
    expect([after!.reporter_key, after!.explanation_hash]).toEqual([null, null])
  })

  it("the retention run deletes by the staged day, and a real day keeps the same rows", async () => {
    const now = new Date()
    const event = (key: string, agoMs: number) =>
      env.DB.prepare(
        "INSERT INTO tribute_events (idempotency_key, request_nonce, place_id, day, device_key, received_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind(key, key, place, key, key, new Date(now.getTime() - agoMs).toISOString())
        .run()
    const due = `due-${crypto.randomUUID()}`
    const kept = `kept-${crypto.randomUUID()}`
    await event(due, RETENTION.tributeDays * DAY + 60_000)
    await event(kept, RETENTION.tributeDays * DAY - 60_000)
    const left = async () =>
      (
        await env.DB.prepare("SELECT idempotency_key AS k FROM tribute_events WHERE idempotency_key IN (?, ?)")
          .bind(due, kept)
          .all<{ k: string }>()
      ).results
        .map((r) => r.k)
        .sort()

    await runJobs(env, deps, undefined, now)
    expect(await left()).toEqual([due, kept].sort())
    await runJobs(STAGED, deps, undefined, now)
    expect(await left()).toEqual([kept])
  })

  it("outside staging, the value is refused before a route or the jobs write anything", async () => {
    const before = { places: await count("places"), runs: await count("retention_runs"), exports: await count("exports") }
    expect((await submitIn(REFUSED, "ספסל דמו שנדחה")).status).toBeGreaterThanOrEqual(500)
    await expect(runJobs(REFUSED, deps, undefined, new Date())).rejects.toThrow(/RETENTION_DAY_SECONDS/)
    expect({ places: await count("places"), runs: await count("retention_runs"), exports: await count("exports") }).toEqual(before)
  })
})
