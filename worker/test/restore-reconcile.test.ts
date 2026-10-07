import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import { EXPORT_TABLES, runExport } from "../db/exports"
import { importExport, type ExportPayload } from "../db/import"
import { runDrill } from "../db/drill"
import { setReportStatus } from "../db/moderation"
import { resumeOps } from "../db/ops"
import { readFeed } from "../db/places"
import { readLedger, replayLedger, restorePhotos } from "../db/replay"
import { runRetention } from "../db/retention"
import { REAL } from "../lib/durations"
import { sendMail } from "../lib/mail"
import { unseal, type Manifest } from "../lib/sealed"
import { call } from "./app"
import { admin, approve } from "./helpers"
import { decide, jpeg, queued, rev, revise, send, sendForm } from "./submission-helpers"
import type { PublicContribution, PublicPlace } from "@/shared/contract"

/** A contribution's photo as the feed names it. */
const photoIn = (places: PublicPlace[], id: string) => (places.find((x) => x.id === id) as PublicContribution | undefined)?.photo

// Restores after the whole-phase review (adviser 20261006T153309Z-ef1427c3): what a restore writes is reconciled with
// the ledger before it is written, and no deadline it writes is later than the one the live database held.

const DAY = 86_400_000
let keys: CryptoKeyPair
beforeAll(async () => {
  await applyD1Migrations(env.IMPORT_TEST, env.TEST_MIGRATIONS)
  keys = (await crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"],
  )) as CryptoKeyPair
})
beforeEach(async () => {
  for (const t of [...EXPORT_TABLES].reverse()) await env.IMPORT_TEST.prepare(`DELETE FROM ${t}`).run()
})

let lastManifest: Manifest
async function exportNow(): Promise<ExportPayload> {
  await env.DB.prepare("DELETE FROM exports").run()
  const pub = JSON.stringify([await crypto.subtle.exportKey("jwk", keys.publicKey)])
  const id = (await runExport({ db: env.DB, media: env.MEDIA, exports: env.EXPORTS, keys: pub }, "rr_test", new Date()))!
  const manifest = (await (await env.EXPORTS.get(`exports/${id}/manifest.json`))!.json()) as Manifest
  lastManifest = manifest
  const data = new Uint8Array(await (await env.EXPORTS.get(manifest.data.key))!.arrayBuffer())
  const plain = await unseal(data, manifest.data, (await crypto.subtle.exportKey("jwk", keys.privateKey)) as JsonWebKey)
  return JSON.parse(await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"))).text()) as ExportPayload
}
const opEnv = (ledger: R2Bucket = env.LEDGER) => ({ db: env.DB, media: env.MEDIA, ledger, purge: async () => true })
/** A ledger that takes intents but refuses every commit, as a bucket that fails just after the decision. */
const noCommits = new Proxy(env.LEDGER, {
  get(target, prop) {
    if (prop === "put")
      return (key: string, ...rest: unknown[]) =>
        key.endsWith("-commit.json") ? Promise.reject(new Error("down")) : (target.put as (...a: unknown[]) => unknown)(key, ...rest)
    const v = Reflect.get(target, prop)
    return typeof v === "function" ? v.bind(target) : v
  },
})
const row = (db: D1Database, sql: string, ...args: unknown[]) =>
  db
    .prepare(sql)
    .bind(...args)
    .first<Record<string, unknown>>()

/** Route B as the runbook does it: the ledger read once, the filtered import, then the replay from the export's moment. */
async function restoreB(payload: ExportPayload, db: D1Database = env.IMPORT_TEST, now = new Date()) {
  const imported = await importExport(db, payload, now, await readLedger(env.LEDGER))
  await replayLedger(db, env.LEDGER, now, payload.created_at)
  return imported
}
/** Every SQL text and bound value that reaches a database, so a test can say what was never written. */
function recording(db: D1Database) {
  const seen: unknown[] = []
  const real = new WeakMap<object, D1PreparedStatement>()
  const own = <T extends object>(t: T, prop: string | symbol) => {
    const v = Reflect.get(t, prop)
    return typeof v === "function" ? v.bind(t) : v
  }
  const wrap = (stmt: D1PreparedStatement) => {
    const p = new Proxy(stmt, {
      get: (t, prop) =>
        prop === "bind"
          ? (...args: unknown[]) => {
              seen.push(...args)
              return t.bind(...args)
            }
          : own(t, prop),
    })
    real.set(p, stmt)
    return p
  }
  const proxy = new Proxy(db, {
    get: (t, prop) =>
      prop === "prepare"
        ? (sql: string) => {
            seen.push(sql)
            return wrap(t.prepare(sql))
          }
        : prop === "batch"
          ? (stmts: D1PreparedStatement[]) => t.batch(stmts.map((s) => real.get(s) ?? s))
          : own(t, prop),
  })
  return { db: proxy, seen }
}
const leaked = (seen: unknown[], secrets: string[]) => seen.filter((v) => typeof v === "string" && secrets.some((x) => v.includes(x)))
const withdraw = (id: string, token: string) =>
  call(`http://local/api/v1/submissions/${id}/withdraw`, { method: "POST", headers: { Authorization: `Bearer ${token}` } })
const uploadAs = (id: string, token: string, bytes: Uint8Array, alt: string) => {
  const form = new FormData()
  form.append("photo", new File([bytes], "p.jpg", { type: "image/jpeg" }))
  form.append("alt", alt)
  form.append("credit", "צלם דמו")
  return sendForm(`http://local/api/v1/submissions/${id}/photo`, token, form)
}
const fileReport = async (placeId: string) =>
  (
    await call("http://local/api/v1/reports", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""),
        "Turnstile-Token": "pass-report",
      },
      body: JSON.stringify({
        placeId,
        elements: ["name_he"],
        requesterType: "family",
        relationship: "אחות",
        explanation: "שם אחי מופיע כאן בלי שביקשנו, ואנחנו מבקשים להסיר אותו בינתיים.",
        email: "report-demo@example.test",
        noticeVersion: "notice.report@2026-10-1",
      }),
    })
  ).json<{ ticket: string }>()

describe("a restore reconciled with the ledger", () => {
  it("dates a decision by when it was made, not by when its record was repaired", async () => {
    const { id } = await send("גן דמו שהרישום שלו תוקן")
    const payload = await exportNow()
    expect((await decide(id, await queued(id), "approve", undefined, { ...env, LEDGER: noCommits })).status).toBe(200)
    // The commit is written a week later, by the job.
    await resumeOps(opEnv(), new Date(Date.now() + 7 * DAY))
    const live = (await row(
      env.DB,
      "SELECT r.decided_at, p.status_changed_at FROM places p JOIN revisions r ON r.id = p.published_revision_id WHERE p.id = ?",
      id,
    ))!
    expect(await restoreB(payload)).toMatchObject({ ok: true })
    const restored = await row(
      env.IMPORT_TEST,
      "SELECT r.decided_at, p.status_changed_at FROM places p JOIN revisions r ON r.id = p.published_revision_id WHERE p.id = ?",
      id,
    )
    expect(restored).toEqual(live)
  })

  it("never writes what was withdrawn after the export: not in a restore, not in the drill (F5-R4)", async () => {
    const secrets = ["שם שולח דמו שנמשך", "withdrawn-demo@example.test", "סיפור דמו שנמשך אחרי הייצוא", "גן דמו שנמשך אחרי הייצוא"]
    const s = await send(secrets[3], { submitter_name: secrets[0], email: secrets[1], story_he: secrets[2] })
    expect((await approve(s.id)).status).toBe(200)
    const payload = await exportNow()
    expect(JSON.stringify(payload.tables)).toContain(secrets[1])
    expect((await withdraw(s.id, s.trackingToken)).status).toBe(200)

    const b = recording(env.IMPORT_TEST)
    expect(await restoreB(payload, b.db)).toMatchObject({ ok: true })
    expect(leaked(b.seen, secrets)).toEqual([])
    expect(await row(env.IMPORT_TEST, "SELECT status FROM places WHERE id = ?", s.id)).toEqual({ status: "withdrawn" })

    for (const t of [...EXPORT_TABLES].reverse()) await env.IMPORT_TEST.prepare(`DELETE FROM ${t}`).run()
    await env.DB.prepare("DELETE FROM drill_runs").run()
    const d = recording(env.IMPORT_TEST)
    const drillKey = JSON.stringify(await crypto.subtle.exportKey("jwk", keys.privateKey))
    const run = await runDrill({ db: env.DB, exports: env.EXPORTS, ledger: env.LEDGER, drillDb: d.db, drillKey, env, sendMail }, new Date())
    expect(await row(env.DB, "SELECT ok, failure FROM drill_runs WHERE id = ?", run)).toEqual({ ok: 1, failure: null })
    expect(leaked(d.seen, secrets)).toEqual([])
  })

  it("never sets a deadline later than the live one, and a second recovery moves none (F5-R5)", async () => {
    const approved = await send("גן דמו שאושר אחרי הייצוא", { email: "approved-demo@example.test" })
    const refused = await send("גן דמו שנדחה אחרי הייצוא", { email: "refused-demo@example.test" })
    const target = await send("גן דמו שעליו בקשה")
    expect((await approve(target.id)).status).toBe(200)
    const { ticket } = await fileReport(target.id)
    const payload = await exportNow()
    expect((await decide(approved.id, await queued(approved.id), "approve")).status).toBe(200)
    expect((await decide(refused.id, await queued(refused.id), "reject")).status).toBe(200)
    expect(await setReportStatus(env.DB, ticket, "closed", "dev@example.test", "טופל", new Date(), REAL)).toBe(true)

    const deadlines = async (db: D1Database) => ({
      approved: await row(db, "SELECT purge_after FROM contacts WHERE place_id = ?", approved.id),
      refused: await row(db, "SELECT purge_after FROM contacts WHERE place_id = ?", refused.id),
      report: (await row(db, "SELECT purge_after FROM reports WHERE id = ?", ticket))!.purge_after as string,
      notes: (await row(db, "SELECT MAX(notes_purge_after) AS at FROM field_suppressions WHERE report_id = ?", ticket))!.at as string,
    })
    const live = await deadlines(env.DB)
    expect(await restoreB(payload)).toMatchObject({ ok: true })
    const b = await deadlines(env.IMPORT_TEST)
    expect(b.approved).toEqual(live.approved)
    expect(b.refused).toEqual(live.refused)
    // A request closed after the export: the ledger doesn't hold it, so it goes by the export's moment plus 90 days.
    expect(b.report <= live.report).toBe(true)
    expect(b.notes <= live.notes).toBe(true)
    await replayLedger(env.IMPORT_TEST, env.LEDGER, new Date(), payload.created_at)
    expect(await deadlines(env.IMPORT_TEST)).toEqual(b)

    // Route A: the database as it stood at that moment, then the same replay; the same deadlines.
    for (const t of [...EXPORT_TABLES].reverse()) await env.IMPORT_TEST.prepare(`DELETE FROM ${t}`).run()
    expect(await importExport(env.IMPORT_TEST, payload, new Date(), new Map())).toMatchObject({ ok: true })
    await replayLedger(env.IMPORT_TEST, env.LEDGER, new Date(), payload.created_at)
    expect(await deadlines(env.IMPORT_TEST)).toEqual(b)
  })

  it("brings back no photo an approval removed, even one the export still names (F5-R6)", async () => {
    const p = await send("גן דמו שתמונתו הוסרה בתיקון")
    expect((await uploadAs(p.id, p.trackingToken, jpeg(0x31), "תמונה א")).status).toBe(200)
    expect((await approve(p.id)).status).toBe(200)
    expect((await revise(p.id, p.trackingToken, await rev(p.id, p.trackingToken), "גן דמו שתוקן בלי תמונה")).status).toBe(200)
    const a = (await row(env.DB, "SELECT photo_key FROM revisions WHERE place_id = ? AND state = 'pending'", p.id))!.photo_key as string
    expect(a).toMatch(/^public\//)
    const payload = await exportNow()
    // B replaces the inherited A, and expires unapproved; the correction is approved without a photo.
    expect((await uploadAs(p.id, p.trackingToken, jpeg(0x32), "תמונה ב")).status).toBe(200)
    await runRetention(opEnv(), new Date(Date.now() + 30 * DAY))
    expect((await decide(p.id, await queued(p.id), "approve")).status).toBe(200)
    expect(photoIn((await readFeed(env.DB, "0")).places, p.id)).toBeUndefined()

    await env.MEDIA.delete(a)
    expect(await restoreB(payload)).toMatchObject({ ok: true })
    await restorePhotos(env.IMPORT_TEST, env.MEDIA, env.EXPORTS, lastManifest)
    expect(
      await row(
        env.IMPORT_TEST,
        "SELECT r.photo_key, r.photo_alt FROM places p JOIN revisions r ON r.id = p.published_revision_id WHERE p.id = ?",
        p.id,
      ),
    ).toEqual({ photo_key: null, photo_alt: null })
    expect(photoIn((await readFeed(env.IMPORT_TEST, "0")).places, p.id)).toBeUndefined()
    expect(await env.MEDIA.head(a)).toBeNull()
  })

  it("never pairs a photo replaced after the export with the old one's description (F5-R6)", async () => {
    const p = await send("גן דמו שתמונתו הוחלפה")
    expect((await approve(p.id)).status).toBe(200)
    expect((await revise(p.id, p.trackingToken, await rev(p.id, p.trackingToken), "גן דמו שתוקן עם תמונה")).status).toBe(200)
    expect((await uploadAs(p.id, p.trackingToken, jpeg(0x41), "תיאור ישן")).status).toBe(200)
    const payload = await exportNow()
    expect((await uploadAs(p.id, p.trackingToken, jpeg(0x42), "תיאור חדש")).status).toBe(200)
    expect((await decide(p.id, await queued(p.id), "approve")).status).toBe(200)

    expect(await restoreB(payload)).toMatchObject({ ok: true })
    const restored = await row(
      env.IMPORT_TEST,
      "SELECT p.status, r.photo_key, r.photo_alt FROM places p JOIN revisions r ON r.id = p.published_revision_id WHERE p.id = ?",
      p.id,
    )
    // The restored copy can't tell which description goes with the new photo: no photo, and hidden until a moderator looks.
    expect(restored).toEqual({ status: "hidden", photo_key: null, photo_alt: null })
  })

  it("an approval of a revision the restore point never had still closes the contact's date (a47 F5-R5)", async () => {
    const s = await send("גן דמו שהוחזר ותוקן אחרי הייצוא", { email: "replaced-demo@example.test" })
    expect((await decide(s.id, await queued(s.id), "return", "נא לתקן את השם")).status).toBe(200)
    const payload = await exportNow()
    // After the export: the sender's correction (a revision the export doesn't have) is approved, then hidden and lifted.
    expect((await revise(s.id, s.trackingToken, await rev(s.id, s.trackingToken), "גן דמו שתוקן אחרי הייצוא")).status).toBe(200)
    expect((await decide(s.id, await queued(s.id), "approve")).status).toBe(200)
    const placeRev = async () => (await (await admin(`/api/admin/places/${s.id}`)).json<{ rev: number }>()).rev
    const hidden = await admin("/api/admin/suppressions", {
      method: "POST",
      body: JSON.stringify({ placeId: s.id, fields: ["name_he"], expectedRev: await placeRev(), reason: "נימוק דמו להסתרה" }),
    })
    expect(hidden.status).toBe(200)
    const sid = (await env.DB.prepare("SELECT id FROM field_suppressions WHERE place_id = ? AND lifted_at IS NULL")
      .bind(s.id)
      .first<string>("id"))!
    const lifted = await admin(`/api/admin/suppressions/${sid}/lift`, {
      method: "POST",
      body: JSON.stringify({
        expectedRev: await placeRev(),
        basisCode: "review_supports_restore",
        basisNote: "בדקנו מול אתר המועצה: השם פורסם שם ברשות המשפחה.",
        confirm: { affirmativeBasis: true, notNonresponseOrDispute: true },
      }),
    })
    expect(lifted.status).toBe(200)
    const live = (await row(env.DB, "SELECT purge_after FROM contacts WHERE place_id = ?", s.id))!.purge_after as string

    const check = async () => {
      const restored = await row(env.IMPORT_TEST, "SELECT purge_after FROM contacts WHERE place_id = ?", s.id)
      // Not later than the live date, whatever the restored copy lacks; and hidden for a moderator.
      expect((restored!.purge_after as string) <= live).toBe(true)
      expect(await row(env.IMPORT_TEST, "SELECT status FROM places WHERE id = ?", s.id)).toEqual({ status: "hidden" })
      await replayLedger(env.IMPORT_TEST, env.LEDGER, new Date(), payload.created_at)
      expect(await row(env.IMPORT_TEST, "SELECT purge_after FROM contacts WHERE place_id = ?", s.id)).toEqual(restored)
      // The deletion job, at the live date, takes it.
      const ops = { db: env.IMPORT_TEST, media: env.MEDIA, ledger: env.LEDGER, purge: async () => true }
      await runRetention(ops, new Date(Date.parse(live) + 1000))
      expect(await row(env.IMPORT_TEST, "SELECT 1 AS n FROM contacts WHERE place_id = ?", s.id)).toBeNull()
    }
    // Route B: the export's rows reconciled in memory.
    expect(await restoreB(payload)).toMatchObject({ ok: true, reconciled: { quarantined: [s.id] } })
    await check()
    // Route A: the database as it stood, then the replay on D1.
    for (const t of [...EXPORT_TABLES].reverse()) await env.IMPORT_TEST.prepare(`DELETE FROM ${t}`).run()
    expect(await importExport(env.IMPORT_TEST, payload, new Date(), new Map())).toMatchObject({ ok: true })
    await replayLedger(env.IMPORT_TEST, env.LEDGER, new Date(), payload.created_at)
    await check()
  })
})
