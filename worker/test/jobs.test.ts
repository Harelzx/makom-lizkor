import { env } from "cloudflare:workers"
import { beforeEach, describe, expect, it } from "vitest"
import type { ReportInput } from "@/shared/contract"
import { runJobs } from "../jobs"
import { RETENTION } from "@/config"
import { REPORT_GUARDS } from "../lib/guards"
import { sendMail } from "../lib/mail"
import { call, purges } from "./app"
import { approve, submit } from "./helpers"

const HOUR = 3600_000
let day = 0
const start = () => new Date(Date.UTC(2027, 5, 1 + day, 9, 0, 0))
const after = (hours: number) => new Date(start().getTime() + hours * HOUR)
beforeEach(async () => {
  day += 3
  purges.splice(0)
  // Each test watches its own requests: the earlier tests' requests are closed, or the job would remind about them too.
  await env.DB.prepare("UPDATE reports SET status = 'closed', backstop_at = NULL").run()
})

const deps = { sendMail, purge: async (_e: Env, _c: unknown, tags: string[]) => (purges.push(tags), true) }
const jobs = (at: Date, e: Env = env) => runJobs(e, deps, undefined, at)

async function published() {
  const { id } = await submit("גינת דמו")
  await approve(id)
  return id
}
async function report(body: Partial<ReportInput> & { placeId: string }, at = start()) {
  const res = await call("http://local/api/v1/reports", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""),
      "Turnstile-Token": "pass-report",
      "X-Test-Now": at.toISOString(),
    },
    body: JSON.stringify({
      elements: ["name_he"],
      requesterType: "family",
      relationship: "אח",
      explanation: `שם אחי מופיע כאן בלי רשות, נבקש להסיר אותו. ${crypto.randomUUID()}`,
      noticeVersion: "notice.report@2026-10-1",
      ...body,
    }),
  })
  return res.json<{ ticket: string; outcome: string }>()
}
const row = (ticket: string) =>
  env.DB.prepare("SELECT * FROM reports WHERE id = ?").bind(ticket).first<Record<string, string | number | null>>()
const hidden = async (placeId: string) =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM field_suppressions WHERE place_id = ? AND lifted_at IS NULL")
    .bind(placeId)
    .first<number>("n"))! > 0
const mails = async () =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM dev_outbox WHERE to_address = 'dev@example.test'").first<number>("n"))!
const handle = (ticket: string, note = "פניתי למשפחה") =>
  env.DB.prepare("UPDATE reports SET status = 'in_review', handling_note = ? WHERE id = ?").bind(note, ticket).run()

/** A complete request the automatic path held back: the place had a precautionary hide earlier the same day. */
async function heldBack() {
  const id = await published()
  await report({ placeId: id, elements: ["story_he"] }, after(-1))
  const r = await report({ placeId: id })
  expect(r.outcome).toBe("received")
  return { id, ...r }
}

describe("the 24-hour backstop (spec 6)", () => {
  it("does nothing before 24 hours", async () => {
    const { ticket } = await heldBack()
    await jobs(after(REPORT_GUARDS.backstopHours - 1))
    expect((await row(ticket))!.outcome).toBe("received")
  })

  it("at 24 hours, hides the element if the safeguards allow it then", async () => {
    const { id, ticket } = await heldBack()
    // The per-place limit counts the last 24 hours: by now the earlier hide is older than that.
    await jobs(after(REPORT_GUARDS.backstopHours))
    expect((await row(ticket))!).toMatchObject({ outcome: "hidden_for_review", backstop_at: null })
    expect(await hidden(id)).toBe(true)
  })

  it("respects the safeguards at the moment it runs, and looks once: held back again, it leaves the request to people", async () => {
    const { ticket } = await heldBack()
    // At 24 hours the breaker is open: enough complete requests in the past hour.
    const others = []
    for (let i = 0; i < REPORT_GUARDS.breakerPerHour; i++) others.push(await published())
    for (const p of others) await report({ placeId: p, requesterType: "other" }, after(REPORT_GUARDS.backstopHours - 0.5))
    await env.DB.prepare("UPDATE reports SET complete = 1 WHERE received_at = ?")
      .bind(after(REPORT_GUARDS.backstopHours - 0.5).toISOString())
      .run()
    await jobs(after(REPORT_GUARDS.backstopHours))
    expect((await row(ticket))!).toMatchObject({ outcome: "received", backstop_at: null })
    // An hour later the breaker would allow it, but the backstop has had its look.
    await jobs(after(REPORT_GUARDS.backstopHours + 2))
    expect((await row(ticket))!.outcome).toBe("received")
  })

  it("never acts on a request a moderator closed", async () => {
    const { ticket } = await heldBack()
    await env.DB.prepare("UPDATE reports SET status = 'closed' WHERE id = ?").bind(ticket).run()
    await jobs(after(REPORT_GUARDS.backstopHours))
    expect((await row(ticket))!.outcome).toBe("received")
  })
})

describe("urgent review reminders", () => {
  it("every 6 hours until a moderator records handling, then never again", async () => {
    const id = await published()
    const { ticket } = await report({ placeId: id, requesterType: "other" })
    const first = await mails()
    await jobs(after(REPORT_GUARDS.reminderHours - 1))
    expect(await mails()).toBe(first)
    await jobs(after(REPORT_GUARDS.reminderHours))
    expect(await mails()).toBe(first + 1)
    await jobs(after(REPORT_GUARDS.reminderHours + 1))
    expect(await mails()).toBe(first + 1)
    await handle(ticket)
    await jobs(after(REPORT_GUARDS.reminderHours * 3))
    expect(await mails()).toBe(first + 1)
    expect((await row(ticket))!.alerts).toBe(2)
  })

  it("two runs at the same moment send one reminder", async () => {
    const id = await published()
    await report({ placeId: id, requesterType: "other" })
    const first = await mails()
    await Promise.all([jobs(after(REPORT_GUARDS.reminderHours)), jobs(after(REPORT_GUARDS.reminderHours))])
    expect(await mails()).toBe(first + 1)
  })

  it("an alert no mail could carry at intake is sent by the next run", async () => {
    const id = await published()
    const { ticket } = await report({ placeId: id, requesterType: "other" })
    // The intake's delivery failed (the provider refused it): left for the next run.
    await env.DB.prepare("UPDATE report_alerts SET state = 'failed', claimed_at = NULL WHERE report_id = ?").bind(ticket).run()
    const before = await mails()
    await jobs(after(0.25))
    expect(await mails()).toBe(before + 1)
  })
})

describe("housekeeping", () => {
  it("clears the two abuse codes (keyed hashes of the address and the explanation) after RETENTION.reportAbuseCodeHours, and nothing else", async () => {
    const id = await published()
    await call("http://local/api/v1/reports", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""),
        "Turnstile-Token": "pass-report",
        "X-Test-Now": start().toISOString(),
        "CF-Connecting-IP": "198.51.100.7",
      },
      body: JSON.stringify({
        placeId: id,
        elements: ["name_he"],
        requesterType: "other",
        explanation: "טעות בשם",
        noticeVersion: "notice.report@2026-10-1",
      }),
    })
    const ticket = (await env.DB.prepare("SELECT id FROM reports WHERE place_id = ?").bind(id).first<string>("id"))!
    expect((await row(ticket))!.reporter_key).not.toBeNull()
    // Cleared at the job's hours, which leave room for a late run within what the notice promises.
    expect(RETENTION.reportAbuseCodeHours).toBeLessThan(RETENTION.reportAbuseCodeMaxHours)
    await jobs(after(RETENTION.reportAbuseCodeHours - 1))
    expect((await row(ticket))!.reporter_key).not.toBeNull()
    await jobs(after(RETENTION.reportAbuseCodeHours))
    const cleared = (await row(ticket))!
    expect(cleared).toMatchObject({ reporter_key: null, explanation_hash: null })
    // Replay detection and the request itself stay with it until its own deletion date.
    expect(cleared.body_hash).not.toBeNull()
    expect(cleared.submit_key_hash).not.toBeNull()
    expect(cleared.explanation).toBe("טעות בשם")
  })

  it("finishes operations left unfinished, and retries a failed purge", async () => {
    const id = await published()
    await env.DB.prepare("UPDATE visibility_ops SET purge = 'failed', purge_tries = 1 WHERE place_id = ?").bind(id).run()
    await jobs(after(1))
    expect(purges).toContainEqual(["feed", "tributes", `place:${id}`])
    expect(await env.DB.prepare("SELECT purge FROM visibility_ops WHERE place_id = ?").bind(id).first("purge")).toBe("done")
  })
})

describe("the development trigger", () => {
  it("runs the jobs in development, and is closed in production", async () => {
    expect((await call("http://local/__dev/cron", { method: "POST", headers: { "X-Test-Now": start().toISOString() } })).status).toBe(200)
    expect((await call("http://local/__dev/cron", { method: "POST" }, { ...env, ENVIRONMENT: "production" })).status).toBe(404)
  })
})

describe("the abuse codes' ceiling holds even when the backstop can't keep up", () => {
  /** Requests stored directly, so a flood of them costs the test nothing: complete, due for the backstop, codes set. */
  async function flood(n: number) {
    const received = start().toISOString()
    const ceiling = after(12 * 30 * 24).toISOString()
    for (let i = 0; i < n; i++)
      await env.DB.prepare(
        `INSERT INTO reports (id, place_id, origin, elements, requester_type, explanation, notice_version, submit_key_hash, body_hash,
           explanation_hash, reporter_key, complete, outcome, status, backstop_at, received_at, ceiling_at, purge_after)
         VALUES (?1, 'p_flood', 'contribution', '["name_he"]', 'family', 'הסבר', 'notice.report@2026-10-2', ?1, 'b', 'e', 'r', 1,
           'received', 'open', ?2, ?3, ?4, ?4)`,
      )
        .bind(`r_flood_${day}_${i}`, after(REPORT_GUARDS.backstopHours).toISOString(), received, ceiling)
        .run()
  }
  const codesLeft = () =>
    env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE id LIKE ? AND (reporter_key IS NOT NULL OR explanation_hash IS NOT NULL)")
      .bind(`r_flood_${day}_%`)
      .first<number>("n")

  it("sixty requests due in one run: every code is gone within reportAbuseCodeMaxHours", async () => {
    await flood(60)
    await jobs(after(RETENTION.reportAbuseCodeHours))
    // The ceiling leaves half an hour for a late run: by then nothing may be left, whatever the backstop got through.
    await jobs(after(RETENTION.reportAbuseCodeMaxHours - 0.5))
    expect(await codesLeft()).toBe(0)
  })

  it("with the backstop failing on every run, the codes still go by the ceiling", async () => {
    await flood(3)
    // The backstop part throws (its query fails); the other parts carry on.
    const db = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "prepare")
          return (sql: string) => {
            if (sql.includes("WHERE backstop_at IS NOT NULL AND backstop_at <=")) throw new Error("d1 down")
            return target.prepare(sql)
          }
        const value = Reflect.get(target, prop)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    await jobs(after(RETENTION.reportAbuseCodeMaxHours - 0.5), { ...env, DB: db })
    expect(await codesLeft()).toBe(0)
  })

  it("a backstop that finds the codes already gone leaves the request to people", async () => {
    const id = await published()
    await report({ placeId: id, elements: ["story_he"] }, after(-1))
    const { ticket } = await report({ placeId: id })
    await env.DB.prepare("UPDATE reports SET reporter_key = NULL, explanation_hash = NULL WHERE id = ?").bind(ticket).run()
    await jobs(after(REPORT_GUARDS.backstopHours))
    expect((await row(ticket))!.outcome).toBe("received")
  })
})
