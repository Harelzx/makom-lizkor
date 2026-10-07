import { env } from "cloudflare:workers"
import { beforeEach, describe, expect, it } from "vitest"
import type { ReportInput } from "@/shared/contract"
import { runJobs } from "../jobs"
import { REPORT_GUARDS } from "../lib/guards"
import { sendMail, type Mail } from "../lib/mail"
import { call } from "./app"
import { admin, approve, submit } from "./helpers"

const HOUR = 3600_000
let day = 0
const start = () => new Date(Date.UTC(2028, 0, 1 + day, 9, 0, 0))
const after = (hours: number) => new Date(start().getTime() + hours * HOUR)
const TWO = "dev@example.test,mod2@example.test"
beforeEach(async () => {
  day += 3
  // Each test watches its own requests and alerts.
  await env.DB.prepare("UPDATE reports SET status = 'closed', backstop_at = NULL").run()
  await env.DB.prepare("DELETE FROM report_alerts").run()
})

async function published() {
  const { id, trackingToken } = await submit("גינת דמו")
  await approve(id)
  return { id, trackingToken }
}
type Opts = { key?: string; at?: Date; e?: Env; ip?: string }
async function report(body: Partial<ReportInput> & { placeId: string }, o: Opts = {}) {
  return call(
    "http://local/api/v1/reports",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": o.key ?? crypto.randomUUID().replaceAll("-", ""),
        "Turnstile-Token": "pass-report",
        "X-Test-Now": (o.at ?? start()).toISOString(),
        ...(o.ip ? { "CF-Connecting-IP": o.ip } : {}),
      },
      body: JSON.stringify({
        elements: ["name_he"],
        requesterType: "family",
        relationship: "אחות",
        explanation: `השם של אחי מופיע כאן בלי רשות, נבקש להסיר. ${crypto.randomUUID()}`,
        noticeVersion: "notice.report@2026-10-2",
        ...body,
      }),
    },
    o.e,
  )
}
const row = (ticket: string) =>
  env.DB.prepare("SELECT * FROM reports WHERE id = ?").bind(ticket).first<Record<string, string | number | null>>()
const hidden = async (placeId: string) =>
  ((await env.DB.prepare("SELECT COUNT(*) AS n FROM field_suppressions WHERE place_id = ? AND lifted_at IS NULL")
    .bind(placeId)
    .first<number>("n")) ?? 0) > 0

/** A bucket that runs `meanwhile` when an intent is written, so a test can change the world between check and act. */
function interleaving(meanwhile: () => Promise<unknown>): Env {
  return {
    ...env,
    LEDGER: new Proxy(env.LEDGER, {
      get(target, prop) {
        if (prop === "put")
          return async (key: string, ...rest: unknown[]) => {
            if (key.endsWith("intent.json")) await meanwhile()
            return target.put(key, ...(rest as [string]))
          }
        const value = Reflect.get(target, prop)
        return typeof value === "function" ? value.bind(target) : value
      },
    }),
  }
}

describe("F4-A1: the spam signals hold at the moment of the hide, not only when they were read", () => {
  it("a copy of the explanation arriving between the check and the hide stops the hide", async () => {
    const { id } = await published()
    const explanation = "השם של אחי מופיע כאן בלי רשות, נבקש להסיר אותו מיד בבקשה."
    const e = interleaving(async () => {
      // Another request with the same explanation lands while this one's intent is being written.
      const copy = await (await published()).id
      await report({ placeId: copy, explanation, requesterType: "other" })
    })
    const res = await report({ placeId: id, explanation }, { e })
    expect((await res.json<{ outcome: string }>()).outcome).toBe("received")
    expect(await hidden(id)).toBe(false)
  })

  it("abuse codes cleared between the check and the hide stop the hide", async () => {
    const { id } = await published()
    const e = interleaving(() =>
      env.DB.prepare("UPDATE reports SET explanation_hash = NULL, reporter_key = NULL WHERE place_id = ?").bind(id).run(),
    )
    const res = await report({ placeId: id }, { e })
    expect((await res.json<{ outcome: string }>()).outcome).toBe("received")
    expect(await hidden(id)).toBe(false)
  })
})

describe("F4-A2: a backstop that stopped midway is taken again; one that finished is not", () => {
  /** A complete request held back at intake (the place had an automatic hide an hour before). */
  async function heldBack() {
    const { id } = await published()
    await report({ placeId: id, elements: ["story_he"] }, { at: after(-1) })
    const { ticket } = await (await report({ placeId: id })).json<{ ticket: string }>()
    return { id, ticket }
  }
  const deps = { sendMail, purge: async () => true }

  it("a claim left by a run that stopped is taken again once it is stale, and the request is evaluated", async () => {
    const { id, ticket } = await heldBack()
    // As if a run claimed it at 24 h and stopped before evaluating.
    await env.DB.prepare("UPDATE reports SET backstop_claimed_at = ? WHERE id = ?").bind(after(24).toISOString(), ticket).run()
    await runJobs(env, deps, undefined, after(24 + 5 / 60))
    expect((await row(ticket))!.outcome).toBe("received")
    await runJobs(env, deps, undefined, after(24 + 20 / 60))
    expect((await row(ticket))!).toMatchObject({ outcome: "hidden_for_review", backstop_at: null })
    expect(await hidden(id)).toBe(true)
  })

  it("an evaluation that couldn't finish (the ledger refused the intent) is tried again at the next run", async () => {
    const { ticket } = await heldBack()
    const down = { ...env, LEDGER: { put: async () => Promise.reject(new Error("down")) } as unknown as R2Bucket }
    await runJobs(down, deps, undefined, after(24))
    expect((await row(ticket))!).toMatchObject({ outcome: "received" })
    expect((await row(ticket))!.backstop_at).not.toBeNull()
    await runJobs(env, deps, undefined, after(24.25))
    expect((await row(ticket))!).toMatchObject({ outcome: "hidden_for_review", backstop_at: null })
  })
})

describe("F4-A3: a retry under a known key is answered from what is stored, whatever happened to the place since", () => {
  it("after the place was withdrawn, the same request again gets its ticket; another body under the key is refused", async () => {
    const { id, trackingToken } = await published()
    const key = crypto.randomUUID().replaceAll("-", "")
    const body = { placeId: id, requesterType: "other" as const, explanation: "טעות בשם המקום, נא לתקן" }
    const first = await (await report(body, { key })).json<{ ticket: string; outcome: string }>()
    await call(`http://local/api/v1/submissions/${id}/withdraw`, { method: "POST", headers: { Authorization: `Bearer ${trackingToken}` } })
    const again = await report(body, { key })
    expect(again.status).toBe(202)
    expect(await again.json()).toEqual(first)
    expect((await report({ ...body, explanation: "משהו אחר לגמרי" }, { key })).status).toBe(409)
    expect((await report(body)).status).toBe(404)
  })
})

describe("F4-A4: urgent alerts are delivered per moderator, retried, and not resent once delivered", () => {
  const two = { ...env, MODERATORS: TWO }
  const delivered = (to: string) =>
    env.DB.prepare("SELECT COUNT(*) AS n FROM dev_outbox WHERE to_address = ? AND subject LIKE '%בדיקה דחופה%'").bind(to).first<number>("n")
  /** A mailer that fails for `failing` while `down.on` is set. */
  function flaky(failing: string, down: { on: boolean }) {
    return async (e: Env, m: Mail) => (down.on && m.to === failing ? false : sendMail(e, m))
  }

  it("one moderator's failed delivery is retried at the next run; the other's isn't sent again", async () => {
    const { id } = await published()
    const down = { on: true }
    const before = { dev: (await delivered("dev@example.test"))!, mod2: (await delivered("mod2@example.test"))! }
    // The intake's own alert: the second moderator's mail fails.
    const app = (await import("../index")).createApp({
      verifyTurnstile: (await import("./app")).fakeSiteverify,
      sendMail: flaky("mod2@example.test", down),
      purge: async () => true,
    })
    const res = await app.fetch(
      new Request("http://local/api/v1/reports", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""),
          "Turnstile-Token": "pass-report",
          "X-Test-Now": start().toISOString(),
        },
        body: JSON.stringify({
          placeId: id,
          elements: ["name_he"],
          requesterType: "other",
          explanation: "טעות",
          noticeVersion: "notice.report@2026-10-2",
        }),
      }),
      two,
      (await import("cloudflare:test")).createExecutionContext(),
    )
    expect(res.status).toBe(202)
    expect(await delivered("dev@example.test")).toBe(before.dev + 1)
    expect(await delivered("mod2@example.test")).toBe(before.mod2)
    down.on = false
    await runJobs(two, { sendMail: flaky("mod2@example.test", down), purge: async () => true }, undefined, after(0.25))
    expect(await delivered("mod2@example.test")).toBe(before.mod2 + 1)
    expect(await delivered("dev@example.test")).toBe(before.dev + 1)
  })

  it("a delivery claimed by a run that stopped before sending is sent once its claim is stale", async () => {
    const { id } = await published()
    const { ticket } = await (await report({ placeId: id, requesterType: "other" }, { e: two })).json<{ ticket: string }>()
    const before = (await delivered("mod2@example.test"))!
    // As if a run claimed mod2's delivery and stopped.
    await env.DB.prepare(
      "UPDATE report_alerts SET state = 'pending', claimed_at = ?, sent_at = NULL WHERE report_id = ? AND recipient = 'mod2@example.test'",
    )
      .bind(after(0).toISOString(), ticket)
      .run()
    await runJobs(two, { sendMail, purge: async () => true }, undefined, after(1 / 60))
    expect(await delivered("mod2@example.test")).toBe(before)
    await runJobs(two, { sendMail, purge: async () => true }, undefined, after(0.25))
    expect(await delivered("mod2@example.test")).toBe(before + 1)
  })

  it("every 6 hours a new round goes to each moderator, and recorded handling stops what is still waiting", async () => {
    const { id } = await published()
    const { ticket } = await (await report({ placeId: id, requesterType: "other" }, { e: two })).json<{ ticket: string }>()
    const before = (await delivered("mod2@example.test"))!
    await runJobs(two, { sendMail: async () => false, purge: async () => true }, undefined, after(REPORT_GUARDS.reminderHours))
    // The reminder round exists but couldn't be delivered; a moderator then records handling.
    await admin(`/api/admin/reports/${ticket}/handle`, { method: "POST", body: JSON.stringify({ note: "טיפלתי" }) })
    await runJobs(two, { sendMail, purge: async () => true }, undefined, after(REPORT_GUARDS.reminderHours + 0.25))
    expect(await delivered("mod2@example.test")).toBe(before)
    expect((await row(ticket))!.alerts).toBe(2)
  })
})

describe("F4-A5: what moderators wrote about a hide has a deadline that only moves earlier", () => {
  const sup = (placeId: string) =>
    env.DB.prepare("SELECT id, created_at, notes_ceiling_at, notes_purge_after FROM field_suppressions WHERE place_id = ?")
      .bind(placeId)
      .first<{ id: string; created_at: string; notes_ceiling_at: string; notes_purge_after: string }>()
  const DAY = 24 * HOUR

  it("a hide's notes are kept 12 months at most, lowered to 90 days when its request closes, and never raised", async () => {
    const { id } = await published()
    const { ticket } = await (await report({ placeId: id })).json<{ ticket: string }>()
    const s = (await sup(id))!
    expect(new Date(s.notes_ceiling_at).getTime()).toBe(new Date(s.created_at).getTime() + 360 * DAY)
    expect(s.notes_purge_after <= s.notes_ceiling_at).toBe(true)
    await admin(`/api/admin/reports/${ticket}/close`, {
      method: "POST",
      headers: { "X-Test-Now": after(1).toISOString() },
      body: JSON.stringify({ note: "נסגר" }),
    })
    const closed = (await sup(id))!
    expect(closed.notes_purge_after).toBe(new Date(after(1).getTime() + 90 * DAY).toISOString())
    await admin(`/api/admin/reports/${ticket}/reopen`, { method: "POST", body: "{}" })
    expect((await sup(id))!.notes_purge_after).toBe(closed.notes_purge_after)
    await expect(
      env.DB.prepare("UPDATE field_suppressions SET notes_purge_after = ? WHERE id = ?").bind(closed.notes_ceiling_at, closed.id).run(),
    ).rejects.toThrow(/suppression_notes_deadline/)
  })

  it("a manual hide's notes are kept 12 months at most, and lowered to 90 days when the hide is lifted", async () => {
    const { id } = await published()
    const view = await (await admin(`/api/admin/places/${id}`)).json<{ rev: number }>()
    await admin("/api/admin/suppressions", {
      method: "POST",
      headers: { "X-Test-Now": start().toISOString() },
      body: JSON.stringify({ placeId: id, fields: ["story_he"], expectedRev: view.rev, reason: "שיחה" }),
    })
    const s = (await sup(id))!
    expect(s.notes_purge_after).toBe(s.notes_ceiling_at)
    const rev = (await (await admin(`/api/admin/places/${id}`)).json<{ rev: number }>()).rev
    const lifted = await admin(`/api/admin/suppressions/${s.id}/lift`, {
      method: "POST",
      headers: { "X-Test-Now": after(2).toISOString() },
      body: JSON.stringify({
        expectedRev: rev,
        basisCode: "hidden_in_error",
        basisNote: "הוסתר בטעות, הסיפור תקין",
        confirm: { affirmativeBasis: true, notNonresponseOrDispute: true },
      }),
    })
    expect(lifted.status).toBe(200)
    expect((await sup(id))!.notes_purge_after).toBe(new Date(after(2).getTime() + 90 * DAY).toISOString())
  })
})

describe("follow-up bc46a39c", () => {
  const deps = { sendMail, purge: async () => true }
  const opEnv = { db: env.DB, media: env.MEDIA, ledger: env.LEDGER, purge: async () => true }
  /** Whether this request (not the earlier one that held it back) hid anything. */
  const hiddenBy = async (ticket: string) =>
    ((await env.DB.prepare("SELECT COUNT(*) AS n FROM field_suppressions WHERE report_id = ?").bind(ticket).first<number>("n")) ?? 0) > 0
  async function heldBack() {
    const { id } = await published()
    await report({ placeId: id, elements: ["story_he"] }, { at: after(-1) })
    const { ticket } = await (await report({ placeId: id })).json<{ ticket: string }>()
    return { id, ticket }
  }

  it("F4-A1: a backstop that runs after the abuse codes expired doesn't hide, even with the codes still stored", async () => {
    const { ticket } = await heldBack()
    await runJobs(env, deps, undefined, after(25))
    expect((await row(ticket))!.outcome).toBe("received")
    expect(await hiddenBy(ticket)).toBe(false)
  })

  it("F4-A1: the expiry is read again at the update, so a ledger that takes long across it stops the hide", async () => {
    const { precaution } = await import("../db/reports")
    const a = await heldBack()
    expect(await precaution(opEnv, a.ticket, after(24), { clock: () => after(25) })).toBe("refused")
    expect(await hiddenBy(a.ticket)).toBe(false)
    const b = await heldBack()
    expect(await precaution(opEnv, b.ticket, after(24), { clock: () => after(24) })).toBe("hidden")
  })

  it("F4-A2: a run whose claim went stale can neither undo nor repeat the evaluation another run finished", async () => {
    const { precaution } = await import("../db/reports")
    const { finishBackstop } = await import("../jobs")
    const { ticket } = await heldBack()
    // Run A claimed at 24 h and stalled. The request is closed meanwhile, so run B's evaluation finishes as refused.
    await env.DB.prepare("UPDATE reports SET backstop_claimed_at = ?, backstop_claim = 'A', status = 'closed' WHERE id = ?")
      .bind(after(24).toISOString(), ticket)
      .run()
    await runJobs(env, deps, undefined, after(24 + 5 / 60))
    expect((await row(ticket))!.backstop_claim).toBe("A")
    await runJobs(env, deps, undefined, after(24.25))
    expect((await row(ticket))!).toMatchObject({ backstop_at: null, backstop_claim: null })
    // Reopened later; run A wakes and tries to act on its old claim: nothing happens.
    // Its abuse codes are put back, so only the claim stands between run A and a hide.
    await env.DB.prepare("UPDATE reports SET status = 'open', explanation_hash = 'still-here' WHERE id = ?").bind(ticket).run()
    expect(await precaution(opEnv, ticket, after(24.25), { claim: "A" })).toBe("refused")
    await finishBackstop(env.DB, ticket, "A", "retry")
    expect((await row(ticket))!).toMatchObject({ backstop_at: null, backstop_claim: null, outcome: "received" })
    expect(await hiddenBy(ticket)).toBe(false)
  })

  it("F4-A4: a round whose recipient rows can't be written opens nothing, and the next run opens it whole", async () => {
    const { id } = await published()
    // A fault inside the executed batch: writing any delivery fails, after the round's own update ran.
    await env.DB.prepare(
      "CREATE TRIGGER test_alerts_fault BEFORE INSERT ON report_alerts BEGIN SELECT RAISE(ABORT, 'test_fault'); END",
    ).run()
    let ticket: string
    try {
      ;({ ticket } = await (
        await report({ placeId: id, requesterType: "other" }, { e: { ...env, MODERATORS: TWO } })
      ).json<{ ticket: string }>())
    } finally {
      await env.DB.prepare("DROP TRIGGER test_alerts_fault").run()
    }
    // The fault fired: the round's update was rolled back with the failed deliveries.
    expect((await row(ticket))!).toMatchObject({ alerts: 0, alerted_at: null })
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM report_alerts WHERE report_id = ?").bind(ticket).first<number>("n")).toBe(0)
    await runJobs({ ...env, MODERATORS: TWO }, deps, undefined, after(0.25))
    expect((await row(ticket))!.alerts).toBe(1)
    const rows = await env.DB.prepare("SELECT recipient, state FROM report_alerts WHERE report_id = ? ORDER BY recipient")
      .bind(ticket)
      .all()
    expect(rows.results).toEqual([
      { recipient: "dev@example.test", state: "sent" },
      { recipient: "mod2@example.test", state: "sent" },
    ])
  })

  it("F4-A4: runs opening the same round at once open it once, with one delivery per moderator", async () => {
    const { startAlertRound } = await import("../db/reports")
    const { id } = await published()
    const { ticket } = await (
      await report({ placeId: id, requesterType: "other" }, { e: { ...env, MODERATORS: TWO } })
    ).json<{ ticket: string }>()
    const at = after(REPORT_GUARDS.reminderHours)
    const opened = await Promise.all([1, 2, 3].map(() => startAlertRound(env.DB, { ...env, MODERATORS: TWO }, ticket, at)))
    expect(opened.filter(Boolean)).toHaveLength(1)
    expect((await row(ticket))!.alerts).toBe(2)
    const round2 = await env.DB.prepare("SELECT recipient FROM report_alerts WHERE report_id = ? AND round = 2 ORDER BY recipient")
      .bind(ticket)
      .all()
    expect(round2.results.map((r) => r.recipient)).toEqual(["dev@example.test", "mod2@example.test"])
  })

  it("F4-A4: a late failure from a send whose claim went stale can't undo another send's delivery", async () => {
    const { completeDelivery } = await import("../db/reports")
    const { id } = await published()
    const { ticket } = await (await report({ placeId: id, requesterType: "other" })).json<{ ticket: string }>()
    const key = [ticket, 1, "dev@example.test"] as const
    expect(await env.DB.prepare("SELECT state FROM report_alerts WHERE report_id = ?").bind(ticket).first("state")).toBe("sent")
    await completeDelivery(env.DB, key, "stale-claim", false, after(1))
    expect(await env.DB.prepare("SELECT state FROM report_alerts WHERE report_id = ?").bind(ticket).first("state")).toBe("sent")
  })

  it("F4-A4: a delivery past its tries isn't claimed again", async () => {
    const { id } = await published()
    const { ticket } = await (await report({ placeId: id, requesterType: "other" })).json<{ ticket: string }>()
    await env.DB.prepare("UPDATE report_alerts SET state = 'failed', tries = 5, claimed_at = NULL WHERE report_id = ?").bind(ticket).run()
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM dev_outbox").first<number>("n")
    await runJobs(env, deps, undefined, after(0.25))
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM dev_outbox").first<number>("n")).toBe(before)
  })

  it("F4-A5: a deadline can't be removed either", async () => {
    const { id } = await published()
    await report({ placeId: id })
    const s = await env.DB.prepare("SELECT id FROM field_suppressions WHERE place_id = ?").bind(id).first<string>("id")
    await expect(env.DB.prepare("UPDATE field_suppressions SET notes_purge_after = NULL WHERE id = ?").bind(s).run()).rejects.toThrow(
      /suppression_notes_deadline/,
    )
  })
})

describe("follow-up 5131154b", () => {
  it("F4-A1: a hide that lands late (slow ledger) is timed when it lands, so the next hour's quota still counts it", async () => {
    const { precaution } = await import("../db/reports")
    const opEnv = { db: env.DB, media: env.MEDIA, ledger: env.LEDGER, purge: async () => true }
    const { id } = await published()
    const { ticket } = await (await report({ placeId: id, requesterType: "other" })).json<{ ticket: string }>()
    // Made complete and due by hand, so the test controls when its evaluation starts and when it lands.
    await env.DB.prepare("UPDATE reports SET complete = 1, backstop_at = ? WHERE id = ?").bind(after(24).toISOString(), ticket).run()
    const landed = after(1 + 1 / 60)
    expect(await precaution(opEnv, ticket, after(1), { clock: () => landed })).toBe("hidden")
    const createdAt = await env.DB.prepare("SELECT created_at FROM field_suppressions WHERE report_id = ?")
      .bind(ticket)
      .first<string>("created_at")
    expect(createdAt).toBe(landed.toISOString())
    // An hour after it started but not after it landed, the hourly quota still sees it.
    const hourAgo = new Date(after(2).getTime() - HOUR + 30_000).toISOString()
    const counted = await env.DB.prepare(
      "SELECT COUNT(DISTINCT report_id) AS n FROM field_suppressions WHERE kind = 'precautionary' AND created_at > ? AND report_id = ?",
    )
      .bind(hourAgo, ticket)
      .first<number>("n")
    expect(counted).toBe(1)
  })
})

describe("follow-up bb965446", () => {
  it("F4-A2: a claim taken over while the request is being hidden stops that hide; the new holder finishes it once", async () => {
    const { precaution } = await import("../db/reports")
    const { finishBackstop } = await import("../jobs")
    const { id } = await published()
    await report({ placeId: id, elements: ["story_he"] }, { at: after(-1) })
    const { ticket } = await (await report({ placeId: id })).json<{ ticket: string }>()
    await env.DB.prepare("UPDATE reports SET backstop_claim = 'A', backstop_claimed_at = ? WHERE id = ?")
      .bind(after(24).toISOString(), ticket)
      .run()
    // A passes its checks; while its intent is being written, B takes the claim over. Everything else stays eligible.
    const takeover = interleaving(() => env.DB.prepare("UPDATE reports SET backstop_claim = 'B' WHERE id = ?").bind(ticket).run())
    const opEnvA = { db: takeover.DB, media: takeover.MEDIA, ledger: takeover.LEDGER, purge: async () => true }
    const a = await precaution(opEnvA, ticket, after(24), { claim: "A", clock: () => after(24) })
    expect(a).toBe("refused")
    const byReport = () =>
      env.DB.prepare("SELECT COUNT(*) AS n FROM field_suppressions WHERE report_id = ?").bind(ticket).first<number>("n")
    expect(await byReport()).toBe(0)
    // A's late completion or release changes nothing of B's.
    await finishBackstop(env.DB, ticket, "A", a)
    await finishBackstop(env.DB, ticket, "A", "retry")
    expect((await row(ticket))!).toMatchObject({ backstop_claim: "B", backstop_at: after(24).toISOString() })
    // B finishes it, once.
    const opEnv = { db: env.DB, media: env.MEDIA, ledger: env.LEDGER, purge: async () => true }
    const b = await precaution(opEnv, ticket, after(24), { claim: "B", clock: () => after(24) })
    expect(b).toBe("hidden")
    await finishBackstop(env.DB, ticket, "B", b)
    expect((await row(ticket))!).toMatchObject({ backstop_at: null, backstop_claim: null, outcome: "hidden_for_review" })
    const ops = () =>
      env.DB.prepare("SELECT COUNT(*) AS n FROM visibility_ops WHERE place_id = ? AND kind = 'suppress'").bind(id).first<number>("n")
    const before = await ops()
    await runJobs(env, { sendMail, purge: async () => true }, undefined, after(24.5))
    expect(await ops()).toBe(before)
    expect(await byReport()).toBe(1)
  })
})

describe("L-RET-ABUSE-1 (a89): on staging's scale, the spam checks read the abuse codes' own staged day, first and at the hide", () => {
  // Staging's two-hour day (worker/lib/durations.ts): the abuse codes live a staged day, so a copy or a reporter's
  // earlier requests count only within it; the automatic hides' own quotas stay on real hours.
  const staged = { day: 7_200_000, hour: 300_000 }
  const opEnv = (e: Env = env) => ({ db: e.DB, media: e.MEDIA, ledger: e.LEDGER, purge: async () => true, durations: staged })
  /** A complete request made due by hand, so the test sets when its evaluation runs. */
  async function due(body: Partial<ReportInput> & { placeId: string }, o: Opts = {}) {
    const { ticket } = await (await report({ requesterType: "other", ...body }, o)).json<{ ticket: string }>()
    await env.DB.prepare("UPDATE reports SET complete = 1, backstop_at = ? WHERE id = ?").bind(after(1).toISOString(), ticket).run()
    return ticket
  }
  const explanation = () => `השם של אחי מופיע כאן בלי רשות, נבקש להסיר אותו. ${crypto.randomUUID()}`
  // Each reporter its own address, by construction: the per-address cap (5 a minute) is real here, and two random
  // draws that met put eight reports on one address, so the eighth came back 429 without a ticket.
  let nextIp = 20
  const ip = () => `198.51.100.${nextIp++}`

  it("a copy older than the staged day but within a real day doesn't stop the hide; one within the staged day does", async () => {
    const { precaution } = await import("../db/reports")
    const old = explanation()
    await report({ placeId: (await published()).id, explanation: old, requesterType: "other" }, { at: after(-3) })
    const a = await due({ placeId: (await published()).id, explanation: old })
    expect((await row(a))!.explanation_hash).not.toBeNull()
    expect(await precaution(opEnv(), a, after(0), { clock: () => after(0) })).toBe("hidden")

    const recent = explanation()
    await report({ placeId: (await published()).id, explanation: recent, requesterType: "other" }, { at: after(-1) })
    const b = await due({ placeId: (await published()).id, explanation: recent })
    expect(await precaution(opEnv(), b, after(0), { clock: () => after(0) })).toBe("refused")
  })

  it("a reporter's requests older than the staged day don't count toward the day's limit; within it they do", async () => {
    const { precaution } = await import("../db/reports")
    const earlier = ip()
    for (let i = 0; i < REPORT_GUARDS.reporterPerDay; i++)
      await report({ placeId: (await published()).id, requesterType: "other" }, { at: after(-3), ip: earlier })
    const a = await due({ placeId: (await published()).id }, { ip: earlier })
    expect(await precaution(opEnv(), a, after(0), { clock: () => after(0) })).toBe("hidden")

    const recent = ip()
    for (let i = 0; i < REPORT_GUARDS.reporterPerDay; i++)
      await report({ placeId: (await published()).id, requesterType: "other" }, { at: after(-1), ip: recent })
    const b = await due({ placeId: (await published()).id }, { ip: recent })
    expect(await precaution(opEnv(), b, after(0), { clock: () => after(0) })).toBe("refused")
  })

  it("at the hide, a copy that arrived meanwhile within the staged day stops it; the same copy beyond it doesn't", async () => {
    const { precaution } = await import("../db/reports")
    const meanwhile = (text: string, at: Date) =>
      interleaving(async () => {
        await report({ placeId: (await published()).id, explanation: text, requesterType: "other" }, { at })
      })
    const near = explanation()
    const a = await due({ placeId: (await published()).id, explanation: near })
    expect(await precaution(opEnv(meanwhile(near, after(-1))), a, after(0), { clock: () => after(0) })).toBe("refused")
    expect(await hidden((await row(a))!.place_id as string)).toBe(false)

    const far = explanation()
    const b = await due({ placeId: (await published()).id, explanation: far })
    expect(await precaution(opEnv(meanwhile(far, after(-3))), b, after(0), { clock: () => after(0) })).toBe("hidden")
  })
})
