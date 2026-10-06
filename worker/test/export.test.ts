import { env } from "cloudflare:workers"
import { beforeAll, describe, expect, it } from "vitest"
import { EXPORT_TABLES } from "../db/exports"
import { runJobs } from "../jobs"
import { sha256Hex } from "../lib/ids"
import { sendMail } from "../lib/mail"
import { unseal, type Manifest } from "../lib/sealed"
import { call } from "./app"
import { decide, queued, send, upload } from "./submission-helpers"

const DAY = 86_400_000
const deps = { sendMail, purge: async () => true }
let keys: CryptoKeyPair
let withKeys: Env

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"],
  )) as CryptoKeyPair
  withKeys = { ...env, EXPORT_PUBLIC_KEYS: JSON.stringify([await crypto.subtle.exportKey("jwk", keys.publicKey)]) }
})

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
const sha = async (bytes: ArrayBuffer | Uint8Array) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
const exportsAfter = (since: string) =>
  env.DB.prepare("SELECT id, ok, retention_run FROM exports WHERE created_at >= ? ORDER BY created_at")
    .bind(since)
    .all<{ id: string; ok: number; retention_run: string }>()
    .then((r) => r.results)
const manifestOf = async (id: string) => (await (await env.EXPORTS.get(`exports/${id}/manifest.json`))!.json()) as Manifest
const gunzip = async (bytes: Uint8Array) =>
  JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text()) as {
    tables: Record<string, Record<string, unknown>[]>
  }

async function publishedWithPhoto(name: string) {
  const { id, trackingToken } = await send(name)
  expect((await upload(id, trackingToken)).status).toBe(200)
  expect((await decide(id, await queued(id), "approve")).status).toBe(200)
  return id
}

describe("the nightly export (spec 8.1)", () => {
  it("follows a finished deletion run: encrypted, with a manifest of counts and checksums, and the photos it names copied", async () => {
    const id = await publishedWithPhoto("גן דמו בייצוא")
    await call("http://local/api/v1/tributes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID().replaceAll("-", "") },
      body: JSON.stringify({ placeId: id, deviceId: crypto.randomUUID().replaceAll("-", "") }),
    })
    const at = new Date(Date.now() + 1000 * DAY)
    await runJobs(withKeys, deps, undefined, at)
    const [row] = await exportsAfter(at.toISOString())
    expect(row).toMatchObject({ ok: 1 })
    const run = await env.DB.prepare("SELECT ok FROM retention_runs WHERE id = ?").bind(row.retention_run).first<{ ok: number }>()
    expect(run?.ok).toBe(1)

    const manifest = await manifestOf(row.id)
    expect(Object.keys(manifest.tables).sort()).toEqual([...EXPORT_TABLES].sort())
    // Only counts and checksums, nothing written by anyone.
    expect(JSON.stringify(manifest)).not.toContain("גן דמו")
    for (const t of EXPORT_TABLES) {
      const n = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())!.n
      expect(manifest.tables[t].rows).toBe(n)
    }

    const data = new Uint8Array(await (await env.EXPORTS.get(manifest.data.key))!.arrayBuffer())
    expect(await sha(data)).toBe(manifest.data.sha256)
    const payload = await gunzip(await unseal(data, manifest.data, (await crypto.subtle.exportKey("jwk", keys.privateKey)) as JsonWebKey))
    for (const t of EXPORT_TABLES) expect(await sha256Hex(JSON.stringify(payload.tables[t]))).toBe(manifest.tables[t].sha256)
    expect(payload.tables.places.some((p) => p.id === id)).toBe(true)
    // A tribute's device key is kept 8 days, never in a 35-day export; the day's abuse codes neither.
    expect(payload.tables.tribute_events).toBeUndefined()
    expect(payload.tables.reports.every((r) => r.reporter_key === null && r.explanation_hash === null)).toBe(true)

    const key = (await env.DB.prepare(
      "SELECT r.photo_key AS key FROM places p JOIN revisions r ON r.id = p.published_revision_id WHERE p.id = ?",
    )
      .bind(id)
      .first<{ key: string }>())!.key
    const original = await sha(await (await env.MEDIA.get(key))!.arrayBuffer())
    expect(manifest.files).toContainEqual(expect.objectContaining({ key, sha256: original }))
    expect(await sha(await (await env.EXPORTS.get(`photos/${original}`))!.arrayBuffer())).toBe(original)
  })

  it("is written once a day", async () => {
    const at = new Date(Date.now() + 1100 * DAY)
    await runJobs(withKeys, deps, undefined, at)
    await runJobs(withKeys, deps, undefined, new Date(at.getTime() + 3600_000))
    expect(await exportsAfter(at.toISOString())).toHaveLength(1)
    await runJobs(withKeys, deps, undefined, new Date(at.getTime() + DAY))
    expect(await exportsAfter(at.toISOString())).toHaveLength(2)
  })

  it("waits when the deletion run of its pass didn't finish: nothing that should be gone goes into a backup", async () => {
    const failing = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "prepare")
          return (sql: string) => {
            if (sql.startsWith("DELETE FROM contacts WHERE purge_after")) throw new Error("bad row")
            return target.prepare(sql)
          }
        const v = Reflect.get(target, prop)
        return typeof v === "function" ? v.bind(target) : v
      },
    })
    const at = new Date(Date.now() + 1200 * DAY)
    await runJobs({ ...withKeys, DB: failing }, deps, undefined, at)
    expect(await exportsAfter(at.toISOString())).toHaveLength(0)
  })

  it("isn't written without a key to encrypt it to", async () => {
    const at = new Date(Date.now() + 1300 * DAY)
    await runJobs({ ...withKeys, EXPORT_PUBLIC_KEYS: "" }, deps, undefined, at)
    expect(await exportsAfter(at.toISOString())).toHaveLength(0)
  })
})
