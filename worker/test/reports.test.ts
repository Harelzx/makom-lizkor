import { env } from "cloudflare:workers"
import { beforeEach, describe, expect, it } from "vitest"
import type { ReportInput } from "@/shared/contract"
import { REPORT_GUARDS } from "../lib/guards"
import type { LedgerEntry } from "../lib/ledger"
import { call, purges } from "./app"
import { approve, submit } from "./helpers"

const EXPLANATION = "שם אחי מופיע כאן בלי שביקשנו, ואנחנו מבקשים להסיר אותו בינתיים."
/** Each test gets its own day, so the hourly and daily safeguards of one test never count another's requests. */
let day = 0
const today = () => new Date(Date.UTC(2026, 10, 1 + day, 9, 0, 0))
const minutesLater = (m: number) => new Date(today().getTime() + m * 60_000).toISOString()
beforeEach(() => {
  day += 3
  purges.splice(0)
})

async function published(name = "גינת דמו") {
  const { id } = await submit(name)
  await approve(id)
  // The approval's own purge is not what these tests look at.
  purges.splice(0)
  return id
}

type Options = { key?: string; at?: string; token?: string | null; address?: string; e?: Env }
async function report(body: Partial<ReportInput> & { placeId: string }, o: Options = {}) {
  return await call(
    "http://local/api/v1/reports",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": o.key ?? crypto.randomUUID().replaceAll("-", ""),
        "X-Test-Now": o.at ?? today().toISOString(),
        ...(o.token === null ? {} : { "Turnstile-Token": o.token ?? "pass-report" }),
        ...(o.address ? { "CF-Connecting-IP": o.address } : {}),
      },
      body: JSON.stringify({
        elements: ["name_he"],
        requesterType: "family",
        relationship: "אחות",
        explanation: EXPLANATION,
        noticeVersion: "notice.report@2026-10-1",
        ...body,
      }),
    },
    o.e,
  )
}
const row = (ticket: string) =>
  env.DB.prepare("SELECT * FROM reports WHERE id = ?").bind(ticket).first<Record<string, string | number | null>>()
const active = (placeId: string) =>
  env.DB.prepare("SELECT field, kind, report_id FROM field_suppressions WHERE place_id = ? AND lifted_at IS NULL ORDER BY field")
    .bind(placeId)
    .all()
    .then((r) => r.results)
const alertsTo = (to: string) =>
  env.DB.prepare("SELECT subject, body FROM dev_outbox WHERE to_address = ? ORDER BY at").bind(to).all<{ subject: string; body: string }>()
const alertCount = async () => (await alertsTo("dev@example.test")).results.length

describe("a complete request on a published place, within the safeguards", () => {
  it("hides the element as a precaution, records it as automatic, purges once, and alerts the moderators", async () => {
    const id = await published()
    const before = await alertCount()
    const res = await report({ placeId: id })
    expect(res.status).toBe(202)
    const { ticket, outcome } = await res.json<{ ticket: string; outcome: string }>()
    expect(outcome).toBe("hidden_for_review")
    expect(await active(id)).toEqual([{ field: "name_he", kind: "precautionary", report_id: ticket }])
    expect(purges).toEqual([["feed", "tributes", `place:${id}`]])
    const { objects } = await env.LEDGER.list({ prefix: `ledger/${id}/` })
    const commit = await Promise.all(
      objects.filter((o) => o.key.endsWith("commit.json")).map(async (o) => (await env.LEDGER.get(o.key))!.json<LedgerEntry>()),
    )
    expect(commit.find((c) => c.kind === "suppress")).toMatchObject({ actor: "automatic", fields: ["name_he"], removal: true })
    // Ids and codes only: nothing the requester wrote reaches the ledger.
    for (const o of objects) expect(await (await env.LEDGER.get(o.key))!.text()).not.toContain("אחות")
    expect(await alertCount()).toBe(before + 1)
    const alert = (await alertsTo("dev@example.test")).results.at(-1)!
    expect(alert.body).not.toContain(EXPLANATION)
    expect(alert.body).not.toContain("אחות")
    expect(await row(ticket)).toMatchObject({ status: "open", complete: 1, backstop_at: null, alerts: 1 })
  })

  it("the whole place: hidden, and it leaves the feed", async () => {
    const id = await published()
    const res = await report({ placeId: id, elements: ["whole"] })
    expect((await res.json<{ outcome: string }>()).outcome).toBe("hidden_for_review")
    expect(await env.DB.prepare("SELECT status FROM places WHERE id = ?").bind(id).first("status")).toBe("hidden")
  })
})

describe("a request the automatic path doesn't act on is still accepted and reviewed urgently", () => {
  it.each([
    ["someone other than family or a rights holder", { requesterType: "other" as const }],
    ["a rights holder asking about the name", { requesterType: "rights_holder" as const }],
    ["no relationship given", { relationship: undefined }],
    ["a short explanation", { explanation: "בבקשה להסיר" }],
  ])("%s: received, nothing hidden, the moderators alerted", async (_name, change) => {
    const id = await published()
    const before = await alertCount()
    const res = await report({ placeId: id, ...change })
    expect(res.status).toBe(202)
    const { ticket, outcome } = await res.json<{ ticket: string; outcome: string }>()
    expect(outcome).toBe("received")
    expect(await active(id)).toEqual([])
    expect(purges).toEqual([])
    expect(await alertCount()).toBe(before + 1)
    expect(await row(ticket)).toMatchObject({ complete: 0, backstop_at: null })
  })

  it("a complete request held back by a safeguard waits for the 24-hour backstop", async () => {
    const id = await published()
    await report({ placeId: id, explanation: `${EXPLANATION} https://a.example https://b.example https://c.example` })
      .then((r) => r.json<{ ticket: string; outcome: string }>())
      .then(async ({ ticket, outcome }) => {
        expect(outcome).toBe("received")
        expect(await row(ticket)).toMatchObject({
          complete: 1,
          backstop_at: new Date(today().getTime() + REPORT_GUARDS.backstopHours * 3600_000).toISOString(),
        })
      })
    expect(await active(id)).toEqual([])
  })

  it("the same explanation sent again today is a spam signal", async () => {
    const [a, b] = [await published(), await published()]
    expect((await (await report({ placeId: a })).json<{ outcome: string }>()).outcome).toBe("hidden_for_review")
    expect((await (await report({ placeId: b, explanation: `  ${EXPLANATION.toUpperCase()}!` })).json<{ outcome: string }>()).outcome).toBe(
      "received",
    )
  })

  it("one place is hidden automatically at most once a day", async () => {
    const id = await published()
    expect((await (await report({ placeId: id })).json<{ outcome: string }>()).outcome).toBe("hidden_for_review")
    const second = await report({
      placeId: id,
      elements: ["story_he"],
      explanation: "גם הסיפור צריך לרדת, הוא לא מדויק בכלל ופוגע במשפחה.",
    })
    expect((await second.json<{ outcome: string }>()).outcome).toBe("received")
  })

  it("with the ledger down, nothing is hidden automatically, and the moderators are still alerted", async () => {
    const id = await published()
    const before = await alertCount()
    const down = { ...env, LEDGER: { put: async () => Promise.reject(new Error("down")) } as unknown as R2Bucket }
    const res = await report({ placeId: id }, { e: down })
    expect((await res.json<{ outcome: string }>()).outcome).toBe("received")
    expect(await active(id)).toEqual([])
    expect(await alertCount()).toBe(before + 1)
  })
})

describe("the site-wide safeguards hold under concurrent requests", () => {
  it("two requests at once, with room for one more automatic hide this hour: exactly one hides", async () => {
    const places: string[] = []
    for (let i = 0; i <= REPORT_GUARDS.perHour; i++) places.push(await published())
    // Fill the hour to one below its limit, each with its own explanation so none reads as a copy.
    for (let i = 0; i < REPORT_GUARDS.perHour - 1; i++) {
      const res = await report({ placeId: places[i], explanation: `${EXPLANATION} סיבה ${i}` }, { at: minutesLater(i) })
      expect((await res.json<{ outcome: string }>()).outcome).toBe("hidden_for_review")
    }
    const at = minutesLater(10)
    const results = await Promise.all(
      places
        .slice(-2)
        .map((p, i) => report({ placeId: p, explanation: `${EXPLANATION} נימוק ${i}` }, { at }).then((r) => r.json<{ outcome: string }>())),
    )
    expect(results.map((r) => r.outcome).sort()).toEqual(["hidden_for_review", "received"])
  })
})

describe("idempotency", () => {
  it("the same request sent again under its key returns the same ticket, with no second case, hide or alert", async () => {
    const id = await published()
    const key = crypto.randomUUID().replaceAll("-", "")
    const first = await (await report({ placeId: id }, { key })).json<{ ticket: string; outcome: string }>()
    const alerts = await alertCount()
    const again = await report({ placeId: id }, { key, token: null })
    expect(again.status).toBe(202)
    expect(await again.json()).toEqual(first)
    expect(await alertCount()).toBe(alerts)
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE place_id = ?").bind(id).first("n")).toBe(1)
    expect(purges).toHaveLength(1)
  })

  it("the same key with a different request is refused", async () => {
    const id = await published()
    const key = crypto.randomUUID().replaceAll("-", "")
    await report({ placeId: id }, { key })
    const res = await report({ placeId: id, elements: ["story_he"] }, { key })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "idempotency_key_reused" })
  })
})

describe("what can be reported", () => {
  it("a curated place: stored with its origin, reviewed urgently, never hidden automatically", async () => {
    const before = await alertCount()
    const res = await report({ placeId: "nova-memorial-reim", elements: ["whole"] })
    expect(res.status).toBe(202)
    const { ticket, outcome } = await res.json<{ ticket: string; outcome: string }>()
    expect(outcome).toBe("received")
    expect(await row(ticket)).toMatchObject({ origin: "curated", complete: 0 })
    expect(await alertCount()).toBe(before + 1)
  })

  it("an unknown place, or one not published, is not found", async () => {
    expect((await report({ placeId: "nowhere" })).status).toBe(404)
    const { id } = await submit()
    expect((await report({ placeId: id })).status).toBe(404)
  })

  it("needs a browser check and a key, and a valid body", async () => {
    const id = await published()
    expect((await report({ placeId: id }, { token: null })).status).toBe(403)
    expect((await report({ placeId: id }, { key: "short" })).status).toBe(400)
    expect((await report({ placeId: id, elements: [] })).status).toBe(400)
    expect((await report({ placeId: id, elements: ["name_he", "name_he"] })).status).toBe(400)
    expect((await report({ placeId: id, noticeVersion: "notice.report@2020-1-1" as "notice.report@2026-10-1" })).status).toBe(400)
  })
})

describe("what is kept, and for how long", () => {
  it("everything the requester wrote is kept until the earlier of 12 months or 90 days after closing, bidi controls stripped", async () => {
    const id = await published()
    const res = await report({ placeId: id, explanation: `${EXPLANATION}‮`, email: "sister@example.test", relationship: "אחות" })
    const { ticket } = await res.json<{ ticket: string }>()
    const r = (await row(ticket))!
    expect(r.explanation).toBe(EXPLANATION)
    expect(r.email).toBe("sister@example.test")
    const ceiling = new Date(today().getTime() + 12 * 30 * 24 * 3600_000).toISOString()
    expect(r).toMatchObject({ ceiling_at: ceiling, purge_after: ceiling, received_at: today().toISOString() })
  })

  it("the reporter's address is never stored, only a keyed hash for the daily count", async () => {
    const id = await published()
    const { ticket } = await (await report({ placeId: id }, { address: "203.0.113.9" })).json<{ ticket: string }>()
    const r = (await row(ticket))!
    expect(JSON.stringify(r)).not.toContain("203.0.113.9")
    expect(r.reporter_key).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("review findings", () => {
  it("a request about a place hidden whole is accepted for a person to review, never acted on automatically (F4-R4)", async () => {
    const id = await published()
    expect((await (await report({ placeId: id, elements: ["whole"] })).json<{ outcome: string }>()).outcome).toBe("hidden_for_review")
    const res = await report({ placeId: id, elements: ["photo"], explanation: "גם התמונה צריכה לרדת, היא צולמה בלי רשות המשפחה." })
    expect(res.status).toBe(202)
    const { ticket, outcome } = await res.json<{ ticket: string; outcome: string }>()
    expect(outcome).toBe("received")
    expect(await row(ticket)).toMatchObject({ complete: 0, origin: "contribution" })
  })
})
