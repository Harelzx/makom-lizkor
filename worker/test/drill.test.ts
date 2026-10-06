import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { beforeAll, describe, expect, it } from "vitest"
import { runDrill } from "../db/drill"
import { EXPORT_TABLES, runExport } from "../db/exports"
import { runJobs } from "../jobs"
import { sendMail } from "../lib/mail"
import { approve } from "./helpers"
import { jpeg, send, upload } from "./submission-helpers"

const DAY = 86_400_000
let drillKey: string
let otherKey: string
let pub: string

beforeAll(async () => {
  await applyD1Migrations(env.IMPORT_TEST, env.TEST_MIGRATIONS)
  const pair = async () =>
    (await crypto.subtle.generateKey(
      { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["encrypt", "decrypt"],
    )) as CryptoKeyPair
  const drill = await pair()
  const other = await pair()
  pub = JSON.stringify([await crypto.subtle.exportKey("jwk", drill.publicKey)])
  drillKey = JSON.stringify(await crypto.subtle.exportKey("jwk", drill.privateKey))
  otherKey = JSON.stringify(await crypto.subtle.exportKey("jwk", other.privateKey))
  const { id, trackingToken } = await send("גן דמו לתרגיל")
  expect((await upload(id, trackingToken, jpeg(0x41))).status).toBe(200)
  await approve(id)
})

const drillEnv = (key = drillKey) => ({
  db: env.DB,
  exports: env.EXPORTS,
  ledger: env.LEDGER,
  drillDb: env.IMPORT_TEST,
  drillKey: key,
  env,
  sendMail,
})
const exportAt = async (at: Date) => {
  await env.DB.prepare("DELETE FROM exports").run()
  return (await runExport({ db: env.DB, media: env.MEDIA, exports: env.EXPORTS, keys: pub }, "rr_test", at))!
}
const runOf = (id: string) => env.DB.prepare("SELECT ok, failure, export_id FROM drill_runs WHERE id = ?").bind(id).first()
const drillEmpty = async () => {
  for (const t of EXPORT_TABLES)
    if ((await env.IMPORT_TEST.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<number>("n")) !== 0) return false
  return true
}
const told = () => env.DB.prepare("SELECT COUNT(*) AS n FROM dev_outbox WHERE subject LIKE '%תרגיל השחזור%'").first<number>("n")

describe("the weekly restore drill (spec 8.4)", () => {
  it("restores the newest export into the drill database, checks it against its manifest and its photo copies, and empties it", async () => {
    const at = new Date(Date.now() + 4000 * DAY)
    const exportId = await exportAt(at)
    const run = await runDrill(drillEnv(), new Date(at.getTime() + 3600_000))
    expect(await runOf(run!)).toEqual({ ok: 1, failure: null, export_id: exportId })
    expect(await drillEmpty()).toBe(true)
    // Weekly: not again within seven days.
    expect(await runDrill(drillEnv(), new Date(at.getTime() + 2 * DAY))).toBeNull()
  })

  it("refuses an export older than 26 hours, and tells the moderators", async () => {
    const at = new Date(Date.now() + 4100 * DAY)
    await exportAt(at)
    const before = await told()
    const run = await runDrill(drillEnv(), new Date(at.getTime() + 27 * 3600_000))
    expect(await runOf(run!)).toMatchObject({ ok: 0, failure: "stale_export" })
    expect(await told()).toBe(before! + 1)
  })

  it("fails on a photo copy that doesn't match, and on an export it can't open, emptying the drill database either way", async () => {
    const at = new Date(Date.now() + 4200 * DAY)
    await exportAt(at)
    const copy = (await env.EXPORTS.list({ prefix: "photos/" })).objects[0].key
    const original = await (await env.EXPORTS.get(copy))!.arrayBuffer()
    await env.EXPORTS.put(copy, "not the photo")
    const run = await runDrill(drillEnv(), new Date(at.getTime() + 3600_000))
    expect(await runOf(run!)).toMatchObject({ ok: 0, failure: "file_checksum" })
    expect(await drillEmpty()).toBe(true)
    await env.EXPORTS.put(copy, original)

    const later = new Date(at.getTime() + 8 * DAY)
    await exportAt(later)
    const refused = await runDrill(drillEnv(otherKey), new Date(later.getTime() + 3600_000))
    expect(await runOf(refused!)).toMatchObject({ ok: 0, failure: "not_a_recipient" })
    expect(await drillEmpty()).toBe(true)
  })

  it("runs in the scheduled pass where a drill database and its key are configured, after that night's export", async () => {
    const at = new Date(Date.now() + 4400 * DAY)
    await env.DB.prepare("DELETE FROM exports").run()
    await runJobs(
      { ...env, EXPORT_PUBLIC_KEYS: pub, DRILL_DB: env.IMPORT_TEST, DRILL_PRIVATE_KEY: drillKey } as Env,
      { sendMail, purge: async () => true },
      undefined,
      at,
    )
    const run = await env.DB.prepare("SELECT ok, failure FROM drill_runs WHERE started_at = ?").bind(at.toISOString()).first()
    expect(run).toEqual({ ok: 1, failure: null })
  })
})
