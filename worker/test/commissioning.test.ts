import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import { COMMISSIONING, checkFixture, commissioningAllowed, manualRecovery, manualSnapshot, type CommissionEnv } from "../db/commissioning"
import { captureTables, EXPORT_TABLES, pruneExports, runExport } from "../db/exports"
import { runDrill } from "../db/drill"
import { writeLedger } from "../lib/ledger"
import { sha256Hex } from "../lib/ids"
import { admin } from "./helpers"
import { call } from "./app"
import { sendMail } from "../lib/mail"
import { sweepPhotos } from "../db/photos"

const now = new Date("2026-10-11T07:00:00Z")
let d: CommissionEnv
beforeAll(async () => {
  await applyD1Migrations(env.IMPORT_TEST, env.TEST_MIGRATIONS)
  const pair = async () =>
    (await crypto.subtle.generateKey(
      { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["encrypt", "decrypt"],
    )) as CryptoKeyPair
  const owner = await pair(),
    drill = await pair()
  d = {
    db: env.DB,
    target: env.IMPORT_TEST,
    media: env.MEDIA,
    exports: env.EXPORTS,
    ledger: env.LEDGER,
    keys: JSON.stringify([await crypto.subtle.exportKey("jwk", owner.publicKey), await crypto.subtle.exportKey("jwk", drill.publicKey)]),
    drillKey: JSON.stringify(await crypto.subtle.exportKey("jwk", drill.privateKey)),
  }
})
beforeEach(async () => {
  for (const db of [env.DB, env.IMPORT_TEST]) await db.batch([...EXPORT_TABLES].reverse().map((t) => db.prepare(`DELETE FROM ${t}`)))
  await env.DB.batch(["exports", "drill_runs"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)))
  for (const bucket of [env.MEDIA, env.EXPORTS, env.LEDGER]) {
    const page = await bucket.list()
    if (page.objects.length) await bucket.delete(page.objects.map((o) => o.key))
  }
  const id = COMMISSIONING.fixture,
    at = now.toISOString()
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO places(id,origin,status,rev,published_revision_id,tracking_token_hash,created_at,status_changed_at) VALUES(?,'contribution','published',1,'r_fixture',?,?,?)",
    ).bind(id, await sha256Hex("test-token"), at, at),
    env.DB.prepare(
      "INSERT INTO revisions(id,place_id,n,state,kind,name_he,lat,lng,location_precision,created_at) VALUES('r_fixture',?,1,'approved','bench',?,31.42,34.49,'exact',?)",
    ).bind(id, COMMISSIONING.fixtureName, at),
    env.DB.prepare(
      "INSERT INTO contacts(id,place_id,email,created_at,ceiling_at,purge_after) VALUES('c_fixture',?,'makomlizkor@gmail.com',?,?,?)",
    ).bind(id, at, "2027-01-01T00:00:00Z", "2027-01-01T00:00:00Z"),
    env.DB.prepare("INSERT INTO feed_state(id,n,changed_at) VALUES(1,1,?)").bind(at),
    env.DB.prepare("INSERT INTO exports(id,created_at,retention_run,ok) VALUES('ex_scheduled',?,'rr_scheduled',1)").bind(
      new Date(now.getTime() - 3600000).toISOString(),
    ),
    env.DB.prepare("INSERT INTO drill_runs(id,started_at,ok) VALUES('dr_scheduled',?,1)").bind(
      new Date(now.getTime() - 3600000).toISOString(),
    ),
  ])
})
const cadence = async () => ({
  exports: (await env.DB.prepare("SELECT * FROM exports").all()).results,
  drills: (await env.DB.prepare("SELECT * FROM drill_runs").all()).results,
})
const withdraw = async () => {
  const res = await call(`http://local/api/v1/submissions/${COMMISSIONING.fixture}/withdraw`, {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "X-Test-Now": new Date(now.getTime() + 30000).toISOString() },
  })
  expect(res.status).toBe(200)
}

describe("controlled manual commissioning", () => {
  it("allows only the named production owner, origin, audience and time window", () => {
    const prod = {
      ...env,
      ENVIRONMENT: "production",
      PUBLIC_ORIGIN: COMMISSIONING.origin,
      ACCESS_AUD: COMMISSIONING.audience,
      MODERATORS: COMMISSIONING.owner,
    }
    expect(commissioningAllowed(prod, COMMISSIONING.owner, false, COMMISSIONING.origin, now)).toBe(true)
    for (const [e, actor, machine, origin, at] of [
      [{ ...prod, ENVIRONMENT: "staging" }, COMMISSIONING.owner, false, COMMISSIONING.origin, now],
      [prod, "another@gmail.com", false, COMMISSIONING.origin, now],
      [prod, COMMISSIONING.owner, true, COMMISSIONING.origin, now],
      [prod, COMMISSIONING.owner, false, "https://other.test", now],
      [{ ...prod, ACCESS_AUD: "other" }, COMMISSIONING.owner, false, COMMISSIONING.origin, now],
      [prod, COMMISSIONING.owner, false, COMMISSIONING.origin, new Date(COMMISSIONING.expires)],
    ] as const)
      expect(commissioningAllowed(e, actor, machine, origin, at)).toBe(false)
  })
  it("keeps moderator authentication and same-origin checks before the disabled screen", async () => {
    expect((await call("http://local/api/admin/commissioning")).status).toBe(401)
    expect((await admin("/api/admin/commissioning")).status).toBe(404)
    expect((await admin("/api/admin/commissioning", { method: "POST", headers: { "Sec-Fetch-Site": "cross-site" } })).status).toBe(403)
  })
  it("captures a verifiable encrypted snapshot with both recipients without moving either cadence", async () => {
    const before = await cadence()
    const result = await manualSnapshot(d, now)
    expect(result).toMatchObject({ ok: true, recipients: 2, scheduledRowsWritten: 0 })
    expect(result.tables.places.rows).toBe(1)
    expect(await cadence()).toEqual(before)
    expect(await runExport(d, "rr_other", now)).toBeNull()
    expect(
      await runDrill(
        { db: env.DB, exports: env.EXPORTS, ledger: env.LEDGER, drillDb: env.IMPORT_TEST, drillKey: d.drillKey, env, sendMail },
        now,
      ),
    ).toBeNull()
    expect(await cadence()).toEqual(before)
  })
  it("serializes concurrent snapshots and refuses a second attempt", async () => {
    const result = await Promise.allSettled([manualSnapshot(d, now), manualSnapshot(d, now)])
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    expect(result.filter((r) => r.status === "rejected")).toHaveLength(1)
    await expect(manualSnapshot(d, now)).rejects.toThrow("already_attempted")
  })
  it("rejects real content and contacts before claiming or writing a snapshot", async () => {
    await env.DB.prepare("UPDATE contacts SET email='real@example.org'").run()
    await expect(manualSnapshot(d, now)).rejects.toThrow("contact_scope")
    expect(await env.EXPORTS.head(`${COMMISSIONING.marker}snapshot.json`)).toBeNull()
    expect((await env.EXPORTS.list()).objects).toHaveLength(0)
  })
  it("keeps the attempt guard through normal photo sweep/export prune, then expires it by the existing 35-day rule", async () => {
    await manualSnapshot(d, now)
    await sweepPhotos(env.DB, env.MEDIA, new Date(now.getTime() + 2 * 3600000))
    await pruneExports(d, new Date(now.getTime() + 2 * 3600000))
    expect(await env.EXPORTS.head(`${COMMISSIONING.marker}snapshot.json`)).not.toBeNull()
    await expect(manualSnapshot(d, now)).rejects.toThrow("already_attempted")
    await pruneExports(d, new Date(now.getTime() + 36 * 86400000))
    expect(await env.EXPORTS.head(`${COMMISSIONING.marker}snapshot.json`)).toBeNull()
  })
  it("bounds the total import rows, rather than allowing 200 rows in every table", async () => {
    const captured = await captureTables(env.DB)
    captured.tables.audit_log = Array.from({ length: 200 }, () => ({ id: "test", place_id: COMMISSIONING.fixture }))
    expect(() => checkFixture(captured)).toThrow("row_budget")
  })
  it("accepts only the pinned second fixture and counts the UTF-8 content budget", async () => {
    const captured = await captureTables(env.DB)
    captured.tables.places.push({ id: COMMISSIONING.photoFixture, status: "published", published_revision_id: "r_photo" })
    captured.tables.revisions.push({ id: "r_photo", place_id: COMMISSIONING.photoFixture, name_he: COMMISSIONING.photoFixtureName })
    expect(() => checkFixture(captured)).not.toThrow()
    captured.tables.places[1].id = "p_unrelated"
    expect(() => checkFixture(captured)).toThrow("fixture_identity")
    captured.tables.places[1].id = COMMISSIONING.photoFixture
    captured.tables.revisions[1].description = "א".repeat(510_000)
    expect(() => checkFixture(captured)).toThrow("row_budget")
  })
  it("records a failed missing-photo backup and refuses to repeat that attempt", async () => {
    await env.DB.prepare("UPDATE revisions SET photo_key=?").bind(`public/${COMMISSIONING.fixture}/missing.jpg`).run()
    await expect(manualSnapshot(d, now)).rejects.toThrow("photo_missing")
    expect(await (await env.EXPORTS.get(`${COMMISSIONING.marker}snapshot-result.json`))?.json()).toMatchObject({
      ok: false,
      failure: "photo_missing",
    })
    await expect(manualSnapshot(d, now)).rejects.toThrow("already_attempted")
  })
  it("refuses recovery before withdrawal or into the serving/nonempty target", async () => {
    await manualSnapshot(d, now)
    await expect(manualRecovery(d, now)).rejects.toThrow("not_withdrawn")
    await expect(manualRecovery({ ...d, target: d.db }, now)).rejects.toThrow("bindings")
    await withdraw()
    await env.IMPORT_TEST.prepare("INSERT INTO feed_state VALUES(1,0,'2026-10-11')").run()
    await expect(manualRecovery(d, now)).rejects.toThrow("target_not_empty")
    expect(await env.IMPORT_TEST.prepare("SELECT COUNT(*) AS n FROM feed_state").first("n")).toBe(1)
  })
  it("restores through the original importer/replay after withdrawal, verifies photos and cleans only the target", async () => {
    const key = `public/${COMMISSIONING.fixture}/test.jpg`
    await env.MEDIA.put(key, new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: "image/jpeg" } })
    await env.DB.prepare("UPDATE revisions SET photo_key=?,photo_alt=?,photo_credit=?").bind(key, "איור בדיקה", "מקום לזכור").run()
    const before = await cadence()
    const snap = await manualSnapshot(d, now)
    expect(snap.files).toHaveLength(1)
    await withdraw()
    const live = await env.DB.prepare("SELECT * FROM places").all()
    const result = await manualRecovery(d, new Date(now.getTime() + 60000))
    expect(result).toMatchObject({ ok: true, filesChecked: 1, publicPhotoWrites: 0, scheduledRowsWritten: 0 })
    expect(Object.values(result.cleanup as object)).toEqual(Array(11).fill(0))
    expect((await env.DB.prepare("SELECT * FROM places").all()).results).toEqual(live.results)
    expect(await cadence()).toEqual(before)
    expect(await env.MEDIA.head(key)).toBeNull()
    await expect(manualRecovery(d, now)).rejects.toThrow("already_attempted")
  })
  it("rejects a damaged snapshot and missing withdrawal commit before any target write", async () => {
    const snap = await manualSnapshot(d, now)
    await env.DB.prepare("UPDATE places SET status='withdrawn'").run()
    await expect(manualRecovery(d, now)).rejects.toThrow("withdrawal_commit_missing")
    await writeLedger(env.LEDGER, {
      op: "o_fake",
      place: COMMISSIONING.fixture,
      phase: "commit",
      kind: "withdraw",
      actor: "submitter",
      seq_from: 0,
      seq_to: 1,
      rev_from: 1,
      rev_to: 2,
      removal: true,
      at: now.toISOString(),
    })
    await env.EXPORTS.put(`exports/${snap.id}/data.bin`, new Uint8Array([4]))
    await expect(manualRecovery(d, now)).rejects.toThrow("data_missing")
    expect(await env.IMPORT_TEST.prepare("SELECT COUNT(*) AS n FROM places").first("n")).toBe(0)
  })
  it("cleans a partially written target after an import error and preserves the failed attempt", async () => {
    await manualSnapshot(d, now)
    await withdraw()
    let batches = 0
    const target = new Proxy(d.target, {
      get(db, key) {
        if (key === "batch")
          return async (statements: D1PreparedStatement[]) => {
            const result = await db.batch(statements)
            if (++batches === 3) throw new Error("injected_import_failure")
            return result
          }
        const value = Reflect.get(db, key)
        return typeof value === "function" ? value.bind(db) : value
      },
    })
    const before = await cadence()
    await expect(manualRecovery({ ...d, target }, new Date(now.getTime() + 60000))).rejects.toThrow("injected_import_failure")
    const result = await (await env.EXPORTS.get(`${COMMISSIONING.marker}recovery-result.json`))?.json<{ ok: boolean; cleanup: object }>()
    expect(result?.ok).toBe(false)
    expect(Object.values(result!.cleanup)).toEqual(Array(11).fill(0))
    expect(await cadence()).toEqual(before)
    await expect(manualRecovery(d, now)).rejects.toThrow("already_attempted")
  })
})
