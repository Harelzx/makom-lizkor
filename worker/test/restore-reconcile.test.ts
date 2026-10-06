import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import { EXPORT_TABLES, runExport } from "../db/exports"
import { importExport, type ExportPayload } from "../db/import"
import { resumeOps } from "../db/ops"
import { replayLedger } from "../db/replay"
import { unseal, type Manifest } from "../lib/sealed"
import { decide, queued, send } from "./submission-helpers"

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

async function exportNow(): Promise<ExportPayload> {
  await env.DB.prepare("DELETE FROM exports").run()
  const pub = JSON.stringify([await crypto.subtle.exportKey("jwk", keys.publicKey)])
  const id = (await runExport({ db: env.DB, media: env.MEDIA, exports: env.EXPORTS, keys: pub }, "rr_test", new Date()))!
  const manifest = (await (await env.EXPORTS.get(`exports/${id}/manifest.json`))!.json()) as Manifest
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
    expect(await importExport(env.IMPORT_TEST, payload, new Date())).toMatchObject({ ok: true })
    await replayLedger(env.IMPORT_TEST, env.LEDGER, new Date())
    const restored = await row(
      env.IMPORT_TEST,
      "SELECT r.decided_at, p.status_changed_at FROM places p JOIN revisions r ON r.id = p.published_revision_id WHERE p.id = ?",
      id,
    )
    expect(restored).toEqual(live)
  })
})
