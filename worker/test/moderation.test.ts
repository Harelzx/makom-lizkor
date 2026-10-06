import { env } from "cloudflare:workers"
import { beforeEach, describe, expect, it } from "vitest"
import type { Element } from "@/shared/contract"
import type { LedgerEntry } from "../lib/ledger"
import { call, purges } from "./app"
import { admin } from "./helpers"
import { decide, feed, queued, rev, revise, send, upload } from "./submission-helpers"

let day = 0
const today = () => new Date(Date.UTC(2027, 0, 1 + day, 9, 0, 0)).toISOString()
beforeEach(() => {
  day += 3
})

async function published(extra: Record<string, unknown> = {}) {
  const s = await send("ספסל דמו של משפחת כהן", { place_he: "ניר עוז", story_he: "הסיפור המקורי של המקום, כפי שנשלח.", ...extra })
  expect((await decide(s.id, await queued(s.id), "approve")).status).toBe(200)
  purges.splice(0)
  return s
}
type View = {
  rev: number
  status: string
  photo_key: string | null
  suppressions: { id: string; field: string; report_id: string | null }[]
}
const view = async (id: string) => (await (await admin(`/api/admin/places/${id}`)).json<View>()) as View
async function hide(id: string, fields: Element[], e: Env = env, reportId?: string) {
  const { rev } = await view(id)
  return admin(
    "/api/admin/suppressions",
    { method: "POST", body: JSON.stringify({ placeId: id, fields, expectedRev: rev, reason: "בקשת משפחה בטלפון", reportId }) },
    undefined,
    e,
  )
}
const CONFIRM = { affirmativeBasis: true, notNonresponseOrDispute: true }
async function lift(id: string, suppressionId: string, body: Record<string, unknown>, e: Env = env) {
  const { rev } = await view(id)
  return admin(
    `/api/admin/suppressions/${suppressionId}/lift`,
    { method: "POST", body: JSON.stringify({ expectedRev: rev, ...body }) },
    undefined,
    e,
  )
}
const restoreBody = (extra: Record<string, unknown> = {}) => ({
  basisCode: "review_supports_restore",
  basisNote: "בדקנו מול אתר המועצה: השם פורסם שם ברשות המשפחה.",
  confirm: CONFIRM,
  ...extra,
})
const name = async (id: string) => (await feed()).find((p) => p.id === id)?.name_he
const down: Env = { ...env, LEDGER: { put: async () => Promise.reject(new Error("down")) } as unknown as R2Bucket }

async function familyReport(placeId: string, elements: Element[] = ["name_he"], requesterType = "family") {
  const res = await call("http://local/api/v1/reports", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""),
      "Turnstile-Token": "pass-report",
      "X-Test-Now": today(),
    },
    body: JSON.stringify({
      placeId,
      elements,
      requesterType,
      relationship: "בן",
      explanation: "אבא שלי לא רצה שהשם שלו יופיע כאן, אנא הסירו אותו.",
      email: "son@example.test",
      noticeVersion: "notice.report@2026-10-1",
    }),
  })
  return res.json<{ ticket: string; outcome: string }>()
}

describe("a moderator's manual hide", () => {
  it("is always available, even where the automatic path has just acted", async () => {
    const s = await published()
    expect((await familyReport(s.id)).outcome).toBe("hidden_for_review")
    expect((await hide(s.id, ["story_he"])).status).toBe(200)
    expect((await view(s.id)).suppressions.map((x) => x.field).sort()).toEqual(["name_he", "story_he"])
  })

  it("needs a reason, and a current view", async () => {
    const s = await published()
    const { rev } = await view(s.id)
    expect(
      (
        await admin("/api/admin/suppressions", {
          method: "POST",
          body: JSON.stringify({ placeId: s.id, fields: ["name_he"], expectedRev: rev }),
        })
      ).status,
    ).toBe(400)
    const stale = await admin("/api/admin/suppressions", {
      method: "POST",
      body: JSON.stringify({ placeId: s.id, fields: ["name_he"], expectedRev: rev - 1, reason: "בדיקה" }),
    })
    expect(stale.status).toBe(409)
  })

  it("goes ahead with the ledger down, and the missing record shows in the admin until it is repaired", async () => {
    const s = await published()
    expect((await hide(s.id, ["name_he"], down)).status).toBe(200)
    expect(await name(s.id)).toBe("ספסל · ניר עוז")
    const attention = await (await admin("/api/admin/attention")).json<{ ops: { place_id: string; problem: string }[] }>()
    expect(attention.ops).toContainEqual(expect.objectContaining({ place_id: s.id, problem: "ledger_repair" }))
  })
})

describe("restoring needs a documented basis (spec 6)", () => {
  it("without the moderator's structured confirmation, nothing is restored", async () => {
    const s = await published()
    await hide(s.id, ["name_he"])
    const [sup] = (await view(s.id)).suppressions
    const res = await lift(s.id, sup.id, restoreBody({ confirm: { affirmativeBasis: true } }))
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code: "basis_confirmation_required" })
    expect(await name(s.id)).toBe("ספסל · ניר עוז")
  })

  it.each([
    ["rights_cleared without a reference to the evidence", { basisCode: "rights_cleared" }, "evidence_required"],
    ["legal_advice without the adviser's name and date", { basisCode: "legal_advice", adviserName: 'עו"ד דמו' }, "adviser_required"],
    [
      "requester_withdrew without recording how it was verified",
      { basisCode: "requester_withdrew", familyContact: { note: "הפונה כתב שהוא חוזר בו", date: "2027-01-02" } },
      "verification_required",
    ],
    ["content_corrected with no newer reviewed revision", { basisCode: "content_corrected", materialAbsent: true }, "correction_required"],
  ])("%s is refused", async (_name, change, code) => {
    const s = await published()
    await hide(s.id, ["name_he"])
    const [sup] = (await view(s.id)).suppressions
    const res = await lift(s.id, sup.id, restoreBody(change))
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code })
  })

  it("with a documented basis the element returns, recorded with its code and never its note", async () => {
    const s = await published()
    await hide(s.id, ["name_he"])
    const [sup] = (await view(s.id)).suppressions
    purges.splice(0)
    expect((await lift(s.id, sup.id, restoreBody())).status).toBe(200)
    expect(await name(s.id)).toBe("ספסל דמו של משפחת כהן")
    expect(purges).toEqual([["feed", "tributes", `place:${s.id}`]])
    const { objects } = await env.LEDGER.list({ prefix: `ledger/${s.id}/` })
    const all = await Promise.all(objects.map(async (o) => (await env.LEDGER.get(o.key))!.json<LedgerEntry>()))
    expect(all.find((e) => e.kind === "lift" && e.phase === "commit")).toMatchObject({
      basis: "review_supports_restore",
      actor: "moderator",
    })
    expect(JSON.stringify(all)).not.toContain("אתר המועצה")
    // Lifting the same row again is a conflict, not a second restoration.
    expect((await lift(s.id, sup.id, restoreBody())).status).toBe(409)
  })

  it("content_corrected: only after a newer reviewed revision, with the moderator confirming the disputed material is gone", async () => {
    const s = await published()
    await hide(s.id, ["name_he"])
    const [sup] = (await view(s.id)).suppressions
    expect((await revise(s.id, s.trackingToken, await rev(s.id, s.trackingToken), "ספסל דמו")).status).toBe(200)
    expect((await decide(s.id, await queued(s.id), "approve")).status).toBe(200)
    // Approving the correction lifted nothing by itself (the correction left out the community, so only the kind shows).
    expect(await name(s.id)).toBe("ספסל")
    expect((await lift(s.id, sup.id, restoreBody({ basisCode: "content_corrected" }))).status).toBe(422)
    expect((await lift(s.id, sup.id, restoreBody({ basisCode: "content_corrected", materialAbsent: true }))).status).toBe(200)
    expect(await name(s.id)).toBe("ספסל דמו")
  })

  it("hidden after a family's request: restoring needs a recorded contact with the family or the memorial's body, whatever the code", async () => {
    const s = await published()
    const { ticket } = await familyReport(s.id)
    const sup = (await view(s.id)).suppressions.find((x) => x.report_id === ticket)!
    const res = await lift(s.id, sup.id, restoreBody())
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code: "family_contact_required" })
    const contact = { note: "שוחחנו עם המשפחה בטלפון, הם מסכימים", date: "2027-01-02" }
    expect((await lift(s.id, sup.id, restoreBody({ basisCode: "family_requested_restore", familyContact: contact }))).status).toBe(422)
    const ok = await lift(
      s.id,
      sup.id,
      restoreBody({ basisCode: "family_requested_restore", familyContact: contact, verificationNote: "הבן אישר מאותה כתובת" }),
    )
    expect(ok.status).toBe(200)
  })

  describe.each(["requester_withdrew", "family_requested_restore"])(
    "%s needs a recorded contact whoever asked for the hide",
    (basisCode) => {
      const verified = { basisCode, verificationNote: "אושר מאותה כתובת שממנה נשלחה הבקשה" }
      const contact = { note: "הבקשה עצמה, מאותה כתובת: המשפחה מבקשת להחזיר", date: "2027-01-02" }
      async function refusedThenAccepted(id: string, supId: string) {
        const res = await lift(id, supId, restoreBody(verified))
        expect(res.status).toBe(422)
        expect(await res.json()).toMatchObject({ code: "family_contact_required" })
        expect(await name(id)).toBe("ספסל · ניר עוז")
        expect((await view(id)).suppressions.map((x) => x.id)).toContain(supId)
        expect((await lift(id, supId, restoreBody({ ...verified, familyContact: contact }))).status).toBe(200)
        expect(await name(id)).toBe("ספסל דמו של משפחת כהן")
      }

      it("a moderator's hide with no request behind it", async () => {
        const s = await published()
        await hide(s.id, ["name_he"])
        const [sup] = (await view(s.id)).suppressions
        expect(sup.report_id).toBeNull()
        await refusedThenAccepted(s.id, sup.id)
      })

      it("a moderator's hide linked to a request that was not the family's", async () => {
        const s = await published()
        const { ticket } = await familyReport(s.id, ["story_he"], "rights_holder")
        expect((await hide(s.id, ["name_he"], env, ticket)).status).toBe(200)
        const sup = (await view(s.id)).suppressions.find((x) => x.field === "name_he")!
        expect(sup.report_id).toBe(ticket)
        await refusedThenAccepted(s.id, sup.id)
      })
    },
  )

  it("two overlapping hides: lifting one leaves the element hidden", async () => {
    const s = await published()
    await hide(s.id, ["name_he"])
    await hide(s.id, ["name_he"])
    const [first] = (await view(s.id)).suppressions
    expect((await lift(s.id, first.id, restoreBody())).status).toBe(200)
    expect(await name(s.id)).toBe("ספסל · ניר עוז")
  })

  it("two hides of the same field and one lifted: the ledger names each row, so a replay lifts only that one", async () => {
    const s = await published()
    await hide(s.id, ["name_he"])
    await hide(s.id, ["name_he"])
    const [first, second] = (await view(s.id)).suppressions
    expect((await lift(s.id, first.id, restoreBody())).status).toBe(200)
    const { objects } = await env.LEDGER.list({ prefix: `ledger/${s.id}/` })
    const commits = (await Promise.all(objects.map(async (o) => (await env.LEDGER.get(o.key))!.json<LedgerEntry>()))).filter(
      (e) => e.phase === "commit" && (e.kind === "suppress" || e.kind === "lift"),
    )
    expect(commits.map((e) => [e.kind, e.targets])).toEqual([
      ["suppress", [first.id]],
      ["suppress", [second.id]],
      ["lift", [first.id]],
    ])
  })

  it("the whole place restored: back in the feed with its photo served again", async () => {
    const s = await send("ספסל דמו עם תמונה", { place_he: "כיסופים" })
    await upload(s.id, s.trackingToken)
    await decide(s.id, await queued(s.id), "approve")
    const { photo_key } = await view(s.id)
    await hide(s.id, ["whole"])
    expect((await view(s.id)).status).toBe("hidden")
    const [sup] = (await view(s.id)).suppressions
    expect((await lift(s.id, sup.id, restoreBody())).status).toBe(200)
    expect((await view(s.id)).status).toBe("published")
    expect(await name(s.id)).toBe("ספסל דמו עם תמונה")
    expect((await call(`http://local/media/${photo_key}`)).status).toBe(200)
    // The kept copy stays while the photo is published, so a later hide or an overlapping one never loses it (F4-O2).
    expect(await env.MEDIA.head(photo_key!.replace(/^public\//, "held/"))).not.toBeNull()
  })

  it("no restoration happens unrecorded: with the ledger down it answers 503", async () => {
    const s = await published()
    await hide(s.id, ["name_he"])
    const [sup] = (await view(s.id)).suppressions
    const res = await lift(s.id, sup.id, restoreBody(), down)
    expect(res.status).toBe(503)
    expect(await name(s.id)).toBe("ספסל · ניר עוז")
  })
})

describe("handling a request", () => {
  type Listed = { id: string; status: string; explanation: string; email?: string; has_contact: number }
  const listed = async (ticket: string) =>
    ((await (await admin("/api/admin/reports?status=all")).json<{ items: Listed[] }>()).items as Listed[]).find((r) => r.id === ticket)!
  const reportRow = (ticket: string) =>
    env.DB.prepare("SELECT * FROM reports WHERE id = ?").bind(ticket).first<Record<string, string | null>>()

  it("the queue shows what was asked, the contact only on request, and that reading is recorded", async () => {
    const s = await published()
    const { ticket } = await familyReport(s.id)
    const item = await listed(ticket)
    expect(item).toMatchObject({ status: "open", has_contact: 1 })
    expect(item).not.toHaveProperty("email")
    const contact = await admin(`/api/admin/reports/${ticket}/contact`)
    expect(await contact.json()).toEqual({ email: "son@example.test" })
    const audit = await env.DB.prepare("SELECT actor, action, fields FROM audit_log WHERE entity_id = ? AND action = 'read_contact'")
      .bind(ticket)
      .first()
    expect(audit).toEqual({ actor: "dev@example.test", action: "read_contact", fields: "email" })
  })

  it("closing lowers the deletion date to 90 days at most and lifts nothing; reopening moves no date", async () => {
    const s = await published()
    const { ticket } = await familyReport(s.id)
    expect(
      (await admin(`/api/admin/reports/${ticket}/handle`, { method: "POST", body: JSON.stringify({ note: "פניתי למשפחה" }) })).status,
    ).toBe(200)
    expect((await reportRow(ticket))!.status).toBe("in_review")
    const close = await admin(`/api/admin/reports/${ticket}/close`, {
      method: "POST",
      headers: { "X-Test-Now": today() },
      body: JSON.stringify({ note: "ההסתרה נשארת" }),
    })
    expect(close.status).toBe(200)
    const closed = (await reportRow(ticket))!
    expect(closed.status).toBe("closed")
    expect(closed.purge_after).toBe(new Date(new Date(today()).getTime() + 90 * 24 * 3600_000).toISOString())
    expect((await view(s.id)).suppressions).toHaveLength(1)
    expect((await admin(`/api/admin/reports/${ticket}/reopen`, { method: "POST", body: "{}" })).status).toBe(200)
    expect((await reportRow(ticket))!).toMatchObject({ status: "open", purge_after: closed.purge_after, ceiling_at: closed.ceiling_at })
  })
})

describe("review findings: where a hidden photo's file is", () => {
  async function withPhoto() {
    const s = await send("ספסל דמו עם תמונה לבדיקה", { place_he: "נחל עוז" })
    await upload(s.id, s.trackingToken)
    await decide(s.id, await queued(s.id), "approve")
    return { ...s, photo: (await view(s.id)).photo_key! }
  }
  const served = async (key: string) => (await call(`http://local/media/${key}`)).status
  const stored = async (key: string) => !!(await env.MEDIA.head(key))
  /** The bindings with a bucket that refuses one kind of call on keys under `prefix`. */
  const refusing = (method: "get" | "delete", prefix: string): Env => ({
    ...env,
    MEDIA: new Proxy(env.MEDIA, {
      get(target, prop) {
        if (prop === method)
          return (key: string | string[], ...rest: unknown[]) =>
            [key].flat().some((k) => k.startsWith(prefix))
              ? Promise.reject(new Error("down"))
              : (target[method] as (...a: unknown[]) => unknown).call(target, key, ...rest)
        const value = Reflect.get(target, prop)
        return typeof value === "function" ? value.bind(target) : value
      },
    }),
  })

  it("the same restoration sent twice at once leaves the photo served (F4-R1)", async () => {
    const s = await withPhoto()
    await hide(s.id, ["photo"])
    const [sup] = (await view(s.id)).suppressions
    const { rev } = await view(s.id)
    const send2 = () =>
      admin(`/api/admin/suppressions/${sup.id}/lift`, { method: "POST", body: JSON.stringify({ expectedRev: rev, ...restoreBody() }) })
    const statuses = (await Promise.all([send2(), send2()])).map((r) => r.status).sort()
    expect(statuses).toEqual([200, 409])
    expect(await served(s.photo)).toBe(200)
  })

  it("a restoration finished late doesn't delete the only copy of a photo hidden again since (F4-R2)", async () => {
    const s = await withPhoto()
    await hide(s.id, ["photo"])
    const [sup] = (await view(s.id)).suppressions
    // The restoration lands, but removing the held copy fails.
    expect((await lift(s.id, sup.id, restoreBody(), refusing("delete", "held/"))).status).toBe(200)
    // The photo is hidden again, and only then does the scheduled job finish the restoration.
    await hide(s.id, ["photo"])
    const { resumeOps } = await import("../db/ops")
    await resumeOps({ db: env.DB, media: env.MEDIA, ledger: env.LEDGER, purge: async () => true }, new Date(Date.now() + 3600_000))
    expect((await stored(s.photo.replace(/^public\//, "held/"))) || (await stored(s.photo))).toBe(true)
    expect(await served(s.photo)).toBe(404)
  })

  it("a hide finished late doesn't take down a photo restored since (F4-R2)", async () => {
    const s = await withPhoto()
    // The hide lands, but moving the file fails.
    expect((await hide(s.id, ["photo"], refusing("get", "public/"))).status).toBe(200)
    const [sup] = (await view(s.id)).suppressions
    expect((await lift(s.id, sup.id, restoreBody())).status).toBe(200)
    expect(await served(s.photo)).toBe(200)
    const { resumeOps } = await import("../db/ops")
    await resumeOps({ db: env.DB, media: env.MEDIA, ledger: env.LEDGER, purge: async () => true }, new Date(Date.now() + 3600_000))
    expect(await served(s.photo)).toBe(200)
  })
})

describe("review findings: a whole place hidden can still be corrected (F4-R3)", () => {
  it("the sender's correction reaches the queue, its approval keeps the place hidden, and content_corrected can then restore it", async () => {
    const s = await published()
    await hide(s.id, ["whole"])
    expect((await revise(s.id, s.trackingToken, await rev(s.id, s.trackingToken), "ספסל דמו מתוקן")).status).toBe(200)
    expect((await decide(s.id, await queued(s.id), "approve")).status).toBe(200)
    expect((await view(s.id)).status).toBe("hidden")
    expect(await name(s.id)).toBeUndefined()
    const [sup] = (await view(s.id)).suppressions
    expect((await lift(s.id, sup.id, restoreBody({ basisCode: "content_corrected", materialAbsent: true }))).status).toBe(200)
    expect(await name(s.id)).toBe("ספסל דמו מתוקן")
  })
})
