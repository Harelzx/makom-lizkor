import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { beforeAll, describe, expect, it } from "vitest"
import { auditExports, runDrill } from "../db/drill"
import { runExport } from "../db/exports"
import { writeLedger } from "../lib/ledger"
import { sendMail } from "../lib/mail"
import { admin, approve } from "./helpers"
import { call } from "./app"
import { send } from "./submission-helpers"

// The weekly check of every retained export (spec 8.4; adviser 20261006T153309Z-ef1427c3, F5-B2): opened in memory with
// the drill key, it finds personal data whose deletion date had passed before the export was made. Counts and codes
// only; an older export is never written to any database.

const DAY = 86_400_000
let pub: string
let drillKey: string
beforeAll(async () => {
  await applyD1Migrations(env.IMPORT_TEST, env.TEST_MIGRATIONS)
  const pair = (await crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"],
  )) as CryptoKeyPair
  pub = JSON.stringify([await crypto.subtle.exportKey("jwk", pair.publicKey)])
  drillKey = JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey))
})
// One export a day: the table's record of the last one would hold back the next, so each export here is a fresh day's.
const exportAt = async (at: Date) => {
  await env.DB.prepare("DELETE FROM exports").run()
  const id = await runExport({ db: env.DB, media: env.MEDIA, exports: env.EXPORTS, keys: pub }, "rr_test", at)
  expect(id).toBeTruthy()
  return id
}

describe("the weekly audit of retained exports", () => {
  it("finds a contact kept past its date in a recent export, allows a hidden memorial's content, and writes nothing", async () => {
    const overdue = await send("גן דמו שאיש הקשר שלו עבר את מועדו", { email: "overdue-demo@example.test" })
    const now = new Date()
    await env.DB.prepare("UPDATE contacts SET purge_after = ? WHERE place_id = ?")
      .bind(new Date(now.getTime() - 60 * DAY).toISOString(), overdue.id)
      .run()
    // A memorial hidden whole: its content stays, by design.
    const hidden = await send("גן דמו מוסתר שתוכנו נשמר", { story_he: "סיפור דמו של מקום מוסתר" })
    expect((await approve(hidden.id)).status).toBe(200)
    const rev = (await (await admin(`/api/admin/places/${hidden.id}`)).json<{ rev: number }>()).rev
    const hide = await admin("/api/admin/suppressions", {
      method: "POST",
      body: JSON.stringify({ placeId: hidden.id, fields: ["whole"], expectedRev: rev, reason: "נימוק דמו להסתרה" }),
    })
    expect(hide.status).toBe(200)

    // An export made while the deletion job was behind, ten days ago, and today's, after it caught up.
    await exportAt(new Date(now.getTime() - 10 * DAY))
    await env.DB.prepare("DELETE FROM contacts WHERE place_id = ?").bind(overdue.id).run()
    await exportAt(now)

    expect(await auditExports({ exports: env.EXPORTS, drillKey, ledger: env.LEDGER }, new Date())).toEqual({ contacts: 1 })

    // Run weekly with the drill, which loads only today's export; the moderators hear the count, nothing else.
    await env.DB.prepare("DELETE FROM drill_runs").run()
    const run = await runDrill(
      { db: env.DB, exports: env.EXPORTS, ledger: env.LEDGER, drillDb: env.IMPORT_TEST, drillKey, env, sendMail },
      new Date(now.getTime() + 3600_000),
    )
    expect(await env.DB.prepare("SELECT ok FROM drill_runs WHERE id = ?").bind(run).first("ok")).toBe(1)
    const told = await env.DB.prepare("SELECT body FROM dev_outbox WHERE subject LIKE '%בגיבויים%'").all<{ body: string }>()
    expect(told.results).toHaveLength(1)
    expect(told.results[0].body).toContain("contacts: 1")
    expect(told.results[0].body).not.toContain("overdue-demo@example.test")
  })

  it("finds nothing in exports made on time", async () => {
    // The bucket outlives each test: only this test's export is looked at.
    for (const o of (await env.EXPORTS.list({ prefix: "exports/" })).objects) await env.EXPORTS.delete(o.key)
    await send("גן דמו בגיבוי תקין", { email: "fine-demo@example.test" })
    await exportAt(new Date())
    expect(await auditExports({ exports: env.EXPORTS, drillKey, ledger: env.LEDGER }, new Date())).toEqual({})
  })

  it("finds a place a withdrawal took more than 35 days ago, still whole in a recent export; allows one withdrawn since (a47 F5-B2)", async () => {
    for (const o of (await env.EXPORTS.list({ prefix: "exports/" })).objects) await env.EXPORTS.delete(o.key)
    const now = new Date()
    // A database that lost a withdrawal the ledger recorded 40 days ago: the place and its sender's details came back.
    const lost = await send("גן דמו שמשיכתו אבדה", { submitter_name: "שולח דמו", email: "lost-withdrawal-demo@example.test" })
    expect((await approve(lost.id)).status).toBe(200)
    const seq = (await env.DB.prepare("SELECT ledger_seq FROM places WHERE id = ?").bind(lost.id).first<number>("ledger_seq"))!
    const at = new Date(now.getTime() - 40 * DAY).toISOString()
    for (const phase of ["intent", "commit"] as const)
      await writeLedger(env.LEDGER, {
        op: `t_lost_${lost.id}`,
        place: lost.id,
        phase,
        kind: "withdraw",
        actor: "submitter",
        seq_from: seq,
        seq_to: seq + 1,
        rev_from: 0,
        rev_to: 1,
        removal: true,
        at,
        decided_at: at,
      })
    // Withdrawn after the export: rightly still in it until the export's own end.
    const later = await send("גן דמו שנמשך אחרי הגיבוי", { email: "later-withdrawal-demo@example.test" })
    expect((await approve(later.id)).status).toBe(200)
    await exportAt(now)
    const withdrawn = await call(`http://local/api/v1/submissions/${later.id}/withdraw`, {
      method: "POST",
      headers: { Authorization: `Bearer ${later.trackingToken}` },
    })
    expect(withdrawn.status).toBe(200)

    // The lost place's content revision and its contact; nothing of the place withdrawn since.
    expect(await auditExports({ exports: env.EXPORTS, drillKey, ledger: env.LEDGER }, new Date(now.getTime() + 3600_000))).toEqual({
      revisions: 1,
      contacts: 1,
    })
  })
})
