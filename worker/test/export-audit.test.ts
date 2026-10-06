import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { beforeAll, describe, expect, it } from "vitest"
import { auditExports, runDrill } from "../db/drill"
import { runExport } from "../db/exports"
import { sendMail } from "../lib/mail"
import { admin, approve } from "./helpers"
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
const exportAt = (at: Date) => runExport({ db: env.DB, media: env.MEDIA, exports: env.EXPORTS, keys: pub }, "rr_test", at)

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

    expect(await auditExports({ exports: env.EXPORTS, drillKey })).toEqual({ contacts: 1 })

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
    expect(await auditExports({ exports: env.EXPORTS, drillKey })).toEqual({})
  })
})
