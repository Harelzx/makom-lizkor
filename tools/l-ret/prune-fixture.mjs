// Real scheduled pruning, using two tiny explicitly synthetic exports. No successful backup is changed.
// The old/young ages are SEEDED in ULIDs, never in provider timestamps. Photo cleanup must wait two REAL hours.
// node tools/l-ret/prune-fixture.mjs seed|check <receipt.json>
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import sharp from "sharp"
import { freshReceipt, observePrune } from "./prune-observation.mjs"
import { sha256, seal, gzip } from "../../worker/lib/sealed.ts"
import { ulid } from "../../worker/lib/ids.ts"
import { STAGING_ACCOUNT, STAGING_DATABASE, STAGING_ORIGIN, stagingAccount, stagingDatabase, stagingRequester } from "./guards.mjs"

const [mode, out] = process.argv.slice(2)
assert.ok(["seed", "check"].includes(mode) && out, "usage: seed|check receipt.json")
const token = execFileSync("security", ["find-generic-password", "-s", "makom-staging-cloudflare", "-w"], { encoding: "utf8" }).trim()
const request = async (path, init = {}) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${token}`, "cf-r2-jurisdiction": "eu", ...(init.headers ?? {}) },
  })
  if (r.status !== 404) assert.ok(r.ok, `Cloud API ${r.status}`)
  return r
}
const api = async (path, body) => {
  const r = await request(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})
  const data = await r.json()
  assert.ok(data.success, "Cloud API refused request")
  return data
}
stagingAccount(await api("/accounts"))
stagingDatabase(await api(`/accounts/${STAGING_ACCOUNT}/d1/database?name=makom-staging`))
const settings = (await api(`/accounts/${STAGING_ACCOUNT}/workers/scripts/makom-lizkor-staging/settings`)).result.bindings
assert.equal(settings.find((b) => b.name === "ENVIRONMENT")?.text, "staging")
assert.equal(settings.find((b) => b.name === "RETENTION_DAY_SECONDS")?.text, "7200")
const machine = {
  "CF-Access-Client-Id": "f8c96abaceeb5f600144af2dea0a3217.access",
  "CF-Access-Client-Secret": execFileSync("security", ["find-generic-password", "-s", "makom-staging-synthetic-moderator", "-w"], {
    encoding: "utf8",
  }).trim(),
}
assert.equal((await stagingRequester(STAGING_ORIGIN, machine, process.env.EXPECT_TAG)("/api/v1/health")).status, 200)
const bucket = `/accounts/${STAGING_ACCOUNT}/r2/buckets/makom-staging-exports`
const path = (key) => `${bucket}/objects/${key.split("/").map(encodeURIComponent).join("/")}`
const query = async (sql, params = []) => {
  const r = await api(`/accounts/${STAGING_ACCOUNT}/d1/database/${STAGING_DATABASE}/query`, { sql, params })
  assert.equal(r.result.length, 1)
  assert.ok(r.result[0].success)
  return r.result[0]
}
const locks = (await api(`${bucket}/lock`)).result
assert.equal(locks.rules.length, 0, "Locked fixtures cannot prove age-based deletion; leave locks unchanged")
const latest = (await query("SELECT id,created_at FROM exports WHERE ok=1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1"))
  .results[0]
assert.ok(latest, "A good operational backup is required first")

if (mode === "seed") {
  freshReceipt(out)
  const keys = JSON.parse(settings.find((b) => b.name === "EXPORT_PUBLIC_KEYS")?.text ?? "[]")
  assert.ok(keys.length > 0 && keys.every((k) => k.kty === "RSA" && !["d", "p", "q", "dp", "dq", "qi", "oth"].some((f) => f in k)))
  const baseManifest = await (await request(path(`exports/${latest.id}/manifest.json`))).json()
  const now = Date.now(),
    marker = `PRUNE-${crypto.randomUUID()}`
  const receipt = {
    marker,
    at: new Date(now).toISOString(),
    expectTag: process.env.EXPECT_TAG,
    status: "preparing",
    latestBefore: latest,
    objects: [],
    exports: [],
  }
  const save = () => writeFileSync(out, JSON.stringify(receipt, null, 2), { mode: 0o600 })
  save()
  // One staged day = two real hours. Both fixtures predate the good backup and have ok=0, so neither is restore-eligible.
  for (const [role, days] of [
    ["old", 36],
    ["young", 10],
  ]) {
    const created = now - days * 7_200_000,
      id = `ex_${ulid(created)}`
    assert.ok(created < Date.parse(latest.created_at), "Fixture must predate latest good backup")
    const tables = Object.fromEntries(Object.keys(baseManifest.tables).map((t) => [t, []]))
    const pixels = crypto.getRandomValues(new Uint8Array(16 * 16 * 3))
    const bytes = await sharp(pixels, { raw: { width: 16, height: 16, channels: 3 } })
      .jpeg()
      .toBuffer()
    const hash = await sha256(bytes)
    const payload = {
      format: 1,
      id,
      created_at: new Date(created).toISOString(),
      schema: baseManifest.schema,
      tables,
      synthetic_fixture: marker,
    }
    const sealed = await seal(await gzip(new TextEncoder().encode(JSON.stringify(payload))), keys)
    const dataKey = `exports/${id}/data.bin`
    const manifest = {
      format: 1,
      id,
      created_at: payload.created_at,
      schema: baseManifest.schema,
      retention_run: `synthetic:${marker}`,
      tables: Object.fromEntries(Object.keys(tables).map((t) => [t, { rows: 0, sha256: "" }])),
      data: {
        key: dataKey,
        size: sealed.ciphertext.length,
        sha256: await sha256(sealed.ciphertext),
        iv: sealed.iv,
        recipients: sealed.recipients,
      },
      files: [{ key: `public/${marker}/${role}.jpg`, sha256: hash, size: bytes.length }],
      synthetic_fixture: marker,
    }
    for (const t of Object.values(manifest.tables)) t.sha256 = await sha256(new TextEncoder().encode("[]"))
    const objects = [
      [`photos/${hash}`, bytes],
      [dataKey, sealed.ciphertext],
      [`exports/${id}/manifest.json`, new TextEncoder().encode(JSON.stringify(manifest))],
    ]
    for (const [key] of objects) assert.equal((await request(path(key))).status, 404, "Refusing to overwrite existing R2 object")
    const row = await query("INSERT INTO exports (id,created_at,retention_run,ok) VALUES (?,?,?,0)", [
      id,
      payload.created_at,
      manifest.retention_run,
    ])
    assert.equal(row.meta.changes, 1)
    receipt.exports.push({ role, id, synthetic_created_at: payload.created_at, photo: `photos/${hash}` })
    save()
    for (const [key, content] of objects) {
      const uploaded = await request(path(key), {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream", "Content-Length": String(content.length) },
        body: content,
      })
      assert.ok(uploaded.ok)
      receipt.objects.push({ key, size: content.length, put_at: new Date().toISOString() })
      save()
    }
  }
  const listing = (await api(`${bucket}/objects?per_page=1000`)).result
  for (const object of receipt.objects) {
    const found = listing.find((o) => o.key === object.key)
    assert.ok(found, "Fixture vanished before upload-time observation; preserve partial receipt")
    object.provider_uploaded_at = found.last_modified
    assert.ok(Number.isFinite(Date.parse(found.last_modified)), "Provider upload timestamp missing")
  }
  const newest = (await query("SELECT id FROM exports WHERE ok=1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1")).results[0]
  assert.ok(!receipt.exports.some((e) => e.id === newest.id))
  receipt.status = "awaiting_real_cron"
  save()
  console.log(JSON.stringify({ status: receipt.status, exports: receipt.exports, out }))
} else {
  const receipt = JSON.parse(readFileSync(out))
  assert.equal(receipt.status, "awaiting_real_cron")
  assert.equal(receipt.expectTag, process.env.EXPECT_TAG)
  assert.match(receipt.marker, /^PRUNE-[a-f0-9-]{36}$/)
  const result = await observePrune(receipt, out, { query, objectStatus: async (key) => (await request(path(key))).status })
  console.log(JSON.stringify(result))
  if (result.status !== "pass") process.exitCode = result.status === "failed" ? 1 : 3
}
