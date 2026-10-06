import { env } from "cloudflare:workers"
import { beforeEach, describe, expect, it } from "vitest"
import { RETENTION } from "@/config"
import { CURRENT_SUBMISSION_NOTICE } from "@/shared/contract"
import { runJobs } from "../jobs"
import { alertStalledRetention, RETENTION_ALERT_HOURS, runRetention } from "../db/retention"
import { sendMail } from "../lib/mail"
import { call } from "./app"
import { admin, approve } from "./helpers"
import { jpeg } from "./submission-helpers"

const DAY = 86_400_000
const now = new Date(Date.UTC(2027, 8, 1, 3, 0, 0))
const ago = (days: number, ms = 0) => new Date(now.getTime() - days * DAY + ms).toISOString()
const deps = { sendMail, purge: async () => true }
const opEnv = (e: Env = env) => ({ db: e.DB, media: e.MEDIA, ledger: e.LEDGER, purge: async () => true })

type Item = { id: string; rev: number; revisionId: string }
const send = async (name: string) => {
  const res = await call("http://local/api/v1/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""), "Turnstile-Token": "pass" },
    body: JSON.stringify({
      kind: "bench",
      name_he: name,
      lat: 31.42,
      lng: 34.49,
      consent_version: CURRENT_SUBMISSION_NOTICE,
      story_he: "סיפור דמו",
    }),
  })
  return res.json<{ id: string; trackingToken: string }>()
}
const decide = async (id: string, action: "return" | "reject", note = "נא להוסיף יישוב") => {
  const { items } = await (await admin("/api/admin/queue")).json<{ items: Item[] }>()
  const item = items.find((i) => i.id === id)!
  const res = await admin(`/api/admin/places/${id}/transitions`, {
    method: "POST",
    body: JSON.stringify({ action, revisionId: item.revisionId, expectedRev: item.rev, ...(action === "return" ? { note } : {}) }),
  })
  expect(res.status).toBe(200)
}
const revise = (id: string, token: string, expectedRev: number, name: string) =>
  call(`http://local/api/v1/submissions/${id}/revisions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "Turnstile-Token": "pass-revise" },
    body: JSON.stringify({ consent_version: CURRENT_SUBMISSION_NOTICE, expectedRev, name_he: name, place_he: "בארי" }),
  })
const tracked = async (id: string, token: string) =>
  (await call(`http://local/api/v1/submissions/${id}`, { headers: { Authorization: `Bearer ${token}` } })).json<{
    status: string
    rev: number
    name_he: string | null
  }>()
const place = (id: string) =>
  env.DB.prepare("SELECT status, erased_reason, submit_body_hash FROM places WHERE id = ?")
    .bind(id)
    .first<{ status: string; erased_reason: string | null; submit_body_hash: string | null }>()
const contentLeft = async (id: string) =>
  (
    await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM revisions WHERE place_id = ? AND (name_he IS NOT NULL OR story_he IS NOT NULL OR place_he IS NOT NULL
         OR in_memory_of IS NOT NULL OR lat IS NOT NULL OR decision_note IS NOT NULL OR photo_key IS NOT NULL)`,
    )
      .bind(id)
      .first<{ n: number }>()
  )?.n
const age = (id: string, days: number, ms = 0) =>
  env.DB.prepare("UPDATE places SET status_changed_at = ? WHERE id = ?").bind(ago(days, ms), id).run()
const contact = async (placeId: string, purgeAfter: string) => {
  const id = `c_${crypto.randomUUID()}`
  await env.DB.prepare(
    `INSERT INTO contacts (id, place_id, name, email, consent_version, created_at, ceiling_at, purge_after)
     VALUES (?, ?, 'שם דמו', 'demo@example.test', ?, ?, ?, ?)`,
  )
    .bind(id, placeId, CURRENT_SUBMISSION_NOTICE, ago(30), ago(-335), purgeAfter)
    .run()
  return id
}

beforeEach(async () => {
  // Each test sees only its own: nothing older is left for the job to find.
  await env.DB.prepare("UPDATE places SET status_changed_at = ? WHERE status IN ('returned', 'rejected')").bind(now.toISOString()).run()
})

describe("a returned submission that isn't corrected within 30 days", () => {
  it("is erased to a tombstone: its content, contact details and files go, its id, state, date and reason stay", async () => {
    const { id, trackingToken } = await send("ספסל דמו שהוחזר ונשכח")
    await decide(id, "return")
    await contact(id, ago(-300))
    await env.MEDIA.put(`quarantine/${id}/photo.jpg`, "jpeg")
    await age(id, RETENTION.returnedDays)
    await runJobs(env, deps, undefined, now)
    expect(await place(id)).toMatchObject({ status: "erased", erased_reason: "returned_expired", submit_body_hash: null })
    expect(await contentLeft(id)).toBe(0)
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM contacts WHERE place_id = ?").bind(id).first<{ n: number }>())?.n).toBe(0)
    await runJobs(env, deps, undefined, now)
    expect((await env.MEDIA.list({ prefix: `quarantine/${id}/` })).objects).toHaveLength(0)
    // The sender's link still answers, with nothing of what they wrote.
    expect(await tracked(id, trackingToken)).toMatchObject({ status: "erased", name_he: null })
    const audit = await env.DB.prepare("SELECT actor, action FROM audit_log WHERE entity_id = ? ORDER BY at DESC LIMIT 1")
      .bind(id)
      .first<{ actor: string; action: string }>()
    expect(audit).toEqual({ actor: "automatic", action: "erase" })
  })

  it("is kept until the full 30 days have passed", async () => {
    const { id } = await send("ספסל דמו שהוחזר אתמול")
    await decide(id, "return")
    await age(id, RETENTION.returnedDays, 60_000)
    await runRetention(opEnv(), now)
    expect(await place(id)).toMatchObject({ status: "returned" })
  })

  it("is saved by a correction within the window: it goes back to review, whatever its age before", async () => {
    const { id, trackingToken } = await send("ספסל דמו שתוקן")
    await decide(id, "return")
    const { rev } = await tracked(id, trackingToken)
    expect((await revise(id, trackingToken, rev, "ספסל דמו מתוקן")).status).toBe(200)
    await env.DB.prepare("UPDATE revisions SET decided_at = ? WHERE place_id = ? AND state = 'superseded'").bind(ago(60), id).run()
    await runRetention(opEnv(), now)
    expect(await place(id)).toMatchObject({ status: "pending" })
    expect(await tracked(id, trackingToken)).toMatchObject({ name_he: "ספסל דמו מתוקן" })
  })
})

describe("a rejected submission", () => {
  it("keeps only its tombstone after 30 days", async () => {
    const { id } = await send("ספסל דמו שנדחה")
    await decide(id, "reject")
    await age(id, RETENTION.rejectedTextDays)
    await runRetention(opEnv(), now)
    expect(await place(id)).toMatchObject({ status: "erased", erased_reason: "rejected_expired" })
    expect(await contentLeft(id)).toBe(0)
  })
})

describe("a correction to a published place that was returned or rejected", () => {
  it("loses its own text after 30 days; the place and what it publishes stay", async () => {
    const { id, trackingToken } = await send("גן דמו שפורסם")
    await approve(id)
    const { rev } = await tracked(id, trackingToken)
    expect((await revise(id, trackingToken, rev, "גן דמו בתיקון שהוחזר")).status).toBe(200)
    await decide(id, "return", "התיקון לא ברור")
    await env.DB.prepare("UPDATE revisions SET decided_at = ? WHERE place_id = ? AND state = 'returned'").bind(ago(31), id).run()
    await runRetention(opEnv(), now)
    expect(await place(id)).toMatchObject({ status: "published" })
    const rows = await env.DB.prepare("SELECT state, name_he, decision_note FROM revisions WHERE place_id = ? ORDER BY n").bind(id).all()
    expect(rows.results).toEqual([
      { state: "approved", name_he: "גן דמו שפורסם", decision_note: null },
      { state: "superseded", name_he: null, decision_note: null },
    ])
  })
})

describe("deadlines kept with the data", () => {
  it("contact details, a request's text and a hide's notes go once their purge date has passed, and not before", async () => {
    const { id } = await send("ספסל דמו עם פרטי קשר")
    const due = await contact(id, ago(0, -1))
    const later = await contact(id, ago(0, 60_000))
    const ticket = `r_${crypto.randomUUID()}`
    await env.DB.prepare(
      `INSERT INTO reports (id, place_id, origin, elements, requester_type, relationship, explanation, email, notice_version,
         submit_key_hash, body_hash, explanation_hash, reporter_key, complete, outcome, status, handling_note, received_at, ceiling_at, purge_after)
       VALUES (?, ?, 'contribution', '["name_he"]', 'family', 'אח', 'הסבר דמו', 'demo@example.test', 'notice.report@2026-10-3',
         ?, 'hash', 'h1', 'k1', 1, 'received', 'closed', 'טופל', ?, ?, ?)`,
    )
      .bind(ticket, id, crypto.randomUUID(), ago(120), ago(-245), ago(1))
      .run()
    await runRetention(opEnv(), now)
    const left = await env.DB.prepare("SELECT id FROM contacts WHERE place_id = ?").bind(id).all<{ id: string }>()
    expect(left.results.map((r) => r.id)).toEqual([later])
    expect(due).not.toBe(later)
    const r = await env.DB.prepare(
      "SELECT relationship, explanation, email, explanation_hash, reporter_key, handling_note, status FROM reports WHERE id = ?",
    )
      .bind(ticket)
      .first()
    expect(r).toEqual({
      relationship: null,
      explanation: null,
      email: null,
      explanation_hash: null,
      reporter_key: null,
      handling_note: null,
      status: "closed",
    })
  })
})

describe("the run", () => {
  it("is recorded with its counts, and running it twice changes nothing more", async () => {
    const { id } = await send("ספסל דמו להרצה כפולה")
    await decide(id, "return")
    await age(id, 40)
    const first = await runRetention(opEnv(), now)
    const second = await runRetention(opEnv(), now)
    expect(first.ok).toBe(true)
    expect(first.counts.erased).toBeGreaterThanOrEqual(1)
    expect(second.counts.erased).toBe(0)
    const run = await env.DB.prepare(
      "SELECT started_at, finished_at, ok FROM retention_runs ORDER BY started_at DESC, id DESC LIMIT 1",
    ).first()
    expect(run).toMatchObject({ started_at: now.toISOString(), ok: 1 })
  })

  it("that fails part-way is recorded as not finished, so no restore can rely on it", async () => {
    const failing = new Proxy(env.DB, {
      get(target, key) {
        if (key === "prepare")
          return (sql: string) => {
            if (sql.includes("DELETE FROM contacts")) throw new Error("d1_unavailable")
            return target.prepare(sql)
          }
        const v = Reflect.get(target, key)
        return typeof v === "function" ? v.bind(target) : v
      },
    })
    const result = await runRetention({ ...opEnv(), db: failing as D1Database }, now)
    expect(result.ok).toBe(false)
    const run = await env.DB.prepare("SELECT finished_at, ok FROM retention_runs WHERE id = ?").bind(result.id).first()
    expect(run).toMatchObject({ ok: 0 })
  })
})

describe("each part on its own", () => {
  it("an erase that keeps failing never holds back the contact purge; the run is still not finished", async () => {
    const { id } = await send("ספסל דמו כשהמחיקה נשברת")
    const due = await contact(id, ago(0, -1))
    const failing = new Proxy(env.DB, {
      get(target, key) {
        if (key === "prepare")
          return (sql: string) => {
            if (sql.includes("status = 'rejected' AND status_changed_at")) throw new Error("bad_row")
            return target.prepare(sql)
          }
        const v = Reflect.get(target, key)
        return typeof v === "function" ? v.bind(target) : v
      },
    })
    const result = await runRetention({ ...opEnv(), db: failing as D1Database }, now)
    expect(result.ok).toBe(false)
    expect(await env.DB.prepare("SELECT 1 FROM contacts WHERE id = ?").bind(due).first()).toBeNull()
  })
})

describe("a stalled job", () => {
  const outbox = () =>
    env.DB.prepare("SELECT to_address, subject, body FROM dev_outbox WHERE subject LIKE '%עבודת המחיקה%' ORDER BY at").all<{
      to_address: string
      subject: string
      body: string
    }>()
  const H = 3600_000
  const at = (hours: number) => new Date(now.getTime() + hours * H)
  const run = (startedHours: number, ok: boolean) =>
    env.DB.prepare("INSERT INTO retention_runs (id, started_at, finished_at, ok) VALUES (?, ?, ?, ?)")
      .bind(`rr_${crypto.randomUUID()}`, at(startedHours).toISOString(), at(startedHours).toISOString(), ok ? 1 : 0)
      .run()

  it("is reported to the moderators, with no one's data, once nothing has finished for the set hours, and again only after as many more", async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM retention_runs"),
      env.DB.prepare("DELETE FROM job_alerts"),
      env.DB.prepare("DELETE FROM dev_outbox"),
    ])
    // Nothing ever ran: a new database isn't a stall.
    expect(await alertStalledRetention(env.DB, env, sendMail, at(0))).toBe(false)
    await run(0, true)
    await run(1, false)
    expect(await alertStalledRetention(env.DB, env, sendMail, at(RETENTION_ALERT_HOURS - 0.1))).toBe(false)
    expect(await alertStalledRetention(env.DB, env, sendMail, at(RETENTION_ALERT_HOURS))).toBe(true)
    const [mail] = (await outbox()).results
    expect(mail.to_address).toBe(env.MODERATORS.split(",")[0].trim().toLowerCase())
    expect(mail.body).toContain("retention_failed")
    expect(mail.body).not.toMatch(/@|p_[0-9A-Z]{20}/)
    expect(await alertStalledRetention(env.DB, env, sendMail, at(RETENTION_ALERT_HOURS + 1))).toBe(false)
    expect(await alertStalledRetention(env.DB, env, sendMail, at(2 * RETENTION_ALERT_HOURS + 0.1))).toBe(true)
    // Once a run finishes again, it's over.
    await run(2 * RETENTION_ALERT_HOURS + 1, true)
    expect(await alertStalledRetention(env.DB, env, sendMail, at(3 * RETENTION_ALERT_HOURS + 0.2))).toBe(false)
    expect((await outbox()).results).toHaveLength(2)
  })

  it("a report that couldn't be mailed is tried again at the next run", async () => {
    await env.DB.batch([env.DB.prepare("DELETE FROM retention_runs"), env.DB.prepare("DELETE FROM job_alerts")])
    await run(0, false)
    const down = async () => false
    expect(await alertStalledRetention(env.DB, env, down, at(RETENTION_ALERT_HOURS))).toBe(false)
    expect(await alertStalledRetention(env.DB, env, sendMail, at(RETENTION_ALERT_HOURS + 0.25))).toBe(true)
  })
})

// Review a42: the rules exercised through the real flows.
const upload = async (id: string, token: string, e: Env = env) => {
  const form = new FormData()
  form.append("photo", new File([jpeg()], "p.jpg", { type: "image/jpeg" }))
  form.append("alt", "תיאור דמו")
  form.append("credit", "צלם דמו")
  const encoded = new Request("http://local/", { method: "PUT", body: form })
  const body = await encoded.arrayBuffer()
  return call(
    `http://local/api/v1/submissions/${id}/photo`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": encoded.headers.get("Content-Type")!,
        "Content-Length": String(body.byteLength),
      },
      body,
    },
    e,
  )
}
const later = (days: number) => new Date(Date.now() + days * DAY)

describe("an erased submission is closed to writes (F5-R1)", () => {
  it("a photo sent with the device's link after the erasure writes nothing into the tombstone, and its file goes", async () => {
    const { id, trackingToken } = await send("ספסל דמו שנמחק ואז הועלתה תמונה")
    await decide(id, "return")
    await age(id, RETENTION.returnedDays)
    await runRetention(opEnv(), now)
    expect(await place(id)).toMatchObject({ status: "erased" })
    expect((await upload(id, trackingToken)).status).not.toBe(200)
    expect(await contentLeft(id)).toBe(0)
    expect((await env.MEDIA.list({ prefix: `quarantine/${id}/` })).objects).toHaveLength(0)
  })

  it("an upload paused before it is recorded, released after the erasure, writes nothing either", async () => {
    const { id, trackingToken } = await send("ספסל דמו העלאה עצורה")
    await decide(id, "return")
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let reached!: () => void
    const atPut = new Promise<void>((r) => (reached = r))
    const media = new Proxy(env.MEDIA, {
      get(target, prop) {
        if (prop === "put")
          return async (...args: Parameters<R2Bucket["put"]>) => {
            const done = await target.put(...args)
            reached()
            await gate
            return done
          }
        const v = Reflect.get(target, prop)
        return typeof v === "function" ? v.bind(target) : v
      },
    })
    const uploading = upload(id, trackingToken, { ...env, MEDIA: media })
    await atPut
    await age(id, RETENTION.returnedDays)
    await runRetention(opEnv(), now)
    release()
    expect((await uploading).status).not.toBe(200)
    expect(await contentLeft(id)).toBe(0)
    expect((await env.MEDIA.list({ prefix: `quarantine/${id}/` })).objects).toHaveLength(0)
  })
})

describe("a published place whose correction expired (F5-R2)", () => {
  it("is corrected again from what it publishes: the draft comes back, and an approved correction keeps the place whole", async () => {
    const { id, trackingToken } = await send("גן דמו לתיקון חוזר")
    await approve(id)
    const { rev } = await tracked(id, trackingToken)
    expect((await revise(id, trackingToken, rev, "גן דמו בתיקון שפג")).status).toBe(200)
    await decide(id, "return", "התיקון לא ברור")
    await env.DB.prepare("UPDATE revisions SET decided_at = ? WHERE place_id = ? AND state = 'returned'").bind(ago(31), id).run()
    await runRetention(opEnv(), now)
    // The expired correction is closed: no photo lands in its empty row.
    expect((await upload(id, trackingToken)).status).toBe(409)
    const status = await (
      await call(`http://local/api/v1/submissions/${id}`, { headers: { Authorization: `Bearer ${trackingToken}` } })
    ).json<{
      rev: number
      draft?: { name_he: string }
    }>()
    // The tracking page offers a correction again, starting from what is published, never from the erased text.
    expect(status.draft?.name_he).toBe("גן דמו לתיקון חוזר")
    expect((await revise(id, trackingToken, status.rev, "גן דמו מתוקן שוב")).status).toBe(200)
    await approve(id)
    const v = (await (await call("http://local/api/v1/version")).json<{ v: string }>()).v
    const feed = await (await call(`http://local/api/v1/feed?v=${v}`)).json<{ places: Record<string, unknown>[] }>()
    const shown = feed.places.find((p) => p.id === id)!
    expect(shown).toMatchObject({ name_he: "גן דמו מתוקן שוב", kind: "bench", lat: 31.42, lng: 34.49 })
  })
})

describe("deadlines from the decisions themselves (F5-R3)", () => {
  it("a submission's contact details go 90 days after its decision, though their ceiling is 12 months", async () => {
    const res = await call("http://local/api/v1/submissions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""),
        "Turnstile-Token": "pass",
      },
      body: JSON.stringify({
        kind: "bench",
        name_he: "ספסל דמו עם מייל",
        lat: 31.42,
        lng: 34.49,
        consent_version: CURRENT_SUBMISSION_NOTICE,
        submitter_name: "שם דמו",
        email: "sender@example.test",
      }),
    })
    const { id, trackingToken } = await res.json<{ id: string; trackingToken: string }>()
    await approve(id)
    const contacts = () => env.DB.prepare("SELECT COUNT(*) AS n FROM contacts WHERE place_id = ?").bind(id).first<{ n: number }>()
    await runRetention(opEnv(), later(RETENTION.contactAfterCloseDays - 1))
    expect((await contacts())?.n).toBe(1)
    await runRetention(opEnv(), later(RETENTION.contactAfterCloseDays + 1))
    expect((await contacts())?.n).toBe(0)
    // The link kept on the sender's device is the place's own, and outlives the address.
    expect(await tracked(id, trackingToken)).toMatchObject({ status: "published", name_he: "ספסל דמו עם מייל" })
  })

  it("a moderator's note to the sender goes 90 days after its revision was replaced, and the published place stays", async () => {
    const { id, trackingToken } = await send("ספסל דמו עם הערה")
    await decide(id, "return", "הערת מודרטור דמו")
    const { rev } = await tracked(id, trackingToken)
    expect((await revise(id, trackingToken, rev, "ספסל דמו אחרי הערה")).status).toBe(200)
    await approve(id)
    const notes = () =>
      env.DB.prepare("SELECT COUNT(*) AS n FROM revisions WHERE place_id = ? AND decision_note IS NOT NULL").bind(id).first<{ n: number }>()
    await runRetention(opEnv(), later(RETENTION.contactAfterCloseDays - 1))
    expect((await notes())?.n).toBe(1)
    await runRetention(opEnv(), later(RETENTION.contactAfterCloseDays + 1))
    expect((await notes())?.n).toBe(0)
    expect(await place(id)).toMatchObject({ status: "published" })
  })
})

describe("a note on the approval itself", () => {
  it("goes 90 days after the approval closed the case; the place stays published", async () => {
    const { id } = await send("ספסל דמו עם הערת אישור")
    const { items } = await (await admin("/api/admin/queue")).json<{ items: Item[] }>()
    const item = items.find((i) => i.id === id)!
    const res = await admin(`/api/admin/places/${id}/transitions`, {
      method: "POST",
      body: JSON.stringify({ action: "approve", revisionId: item.revisionId, expectedRev: item.rev, note: "הערת אישור דמו" }),
    })
    expect(res.status).toBe(200)
    const notes = () =>
      env.DB.prepare("SELECT COUNT(*) AS n FROM revisions WHERE place_id = ? AND decision_note IS NOT NULL").bind(id).first<{ n: number }>()
    await runRetention(opEnv(), later(RETENTION.contactAfterCloseDays - 1))
    expect((await notes())?.n).toBe(1)
    await runRetention(opEnv(), later(RETENTION.contactAfterCloseDays + 1))
    expect((await notes())?.n).toBe(0)
    expect(await place(id)).toMatchObject({ status: "published" })
  })
})

describe("a hide's notes (E5-1)", () => {
  it("lose their text once due, active and lifted alike; the decision, its code and its state stay; one not due is kept", async () => {
    const { id } = await send("גן דמו עם הסתרה")
    await approve(id)
    const row = (fields: Record<string, unknown>) => {
      const sid = `s_${crypto.randomUUID()}`
      const all = {
        id: sid,
        place_id: id,
        field: "name_he",
        kind: "manual",
        revision_n: 1,
        created_at: ago(200),
        created_by: "dev@example.test",
        reason: "נימוק דמו",
        notes_ceiling_at: ago(-160),
        notes_purge_after: ago(1),
        ...fields,
      }
      const keys = Object.keys(all)
      return env.DB.prepare(`INSERT INTO field_suppressions (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
        .bind(...Object.values(all))
        .run()
        .then(() => sid)
    }
    const active = await row({})
    const lifted = await row({
      field: "story_he",
      lifted_at: ago(100),
      lifted_by: "dev@example.test",
      basis_code: "rights_cleared",
      basis_note: "בסיס דמו",
      basis_detail: "פרט דמו",
    })
    const notDue = await row({ field: "in_memory_of", notes_purge_after: ago(0, 60_000) })
    await runRetention(opEnv(), now)
    const get = (sid: string) =>
      env.DB.prepare(
        "SELECT field, reason, basis_code, basis_note, basis_detail, lifted_at IS NOT NULL AS lifted FROM field_suppressions WHERE id = ?",
      )
        .bind(sid)
        .first()
    expect(await get(active)).toEqual({ field: "name_he", reason: null, basis_code: null, basis_note: null, basis_detail: null, lifted: 0 })
    expect(await get(lifted)).toEqual({
      field: "story_he",
      reason: null,
      basis_code: "rights_cleared",
      basis_note: "",
      basis_detail: null,
      lifted: 1,
    })
    expect(await get(notDue)).toMatchObject({ reason: "נימוק דמו" })
  })
})
