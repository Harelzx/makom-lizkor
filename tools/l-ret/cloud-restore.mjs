// Restore the latest real staging backup into the owner's isolated EU D1, using unchanged app import/replay/photo code.
// Source stores are read-only. Restored photos go only beneath a fresh private exercise prefix, then are removed.
// Existing scheduled drill must be inactive (not wired yet, or a recent successful run prevents overlap).
// scripts/heavy node tools/l-ret/cloud-restore.mjs <due.json> <control.json> <withdrawn-photo.json> <result.json>
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { gunzipSync } from "node:zlib"
import { build } from "esbuild"
import { STAGING_ACCOUNT, STAGING_DATABASE, stagingAccount, stagingDatabase, stagingRequester } from "./guards.mjs"
import { ERASE_FIELDS, REPORT_FIELDS } from "./expiry-fixture.mjs"

const DRILL = "8e879921-1f75-4358-a62b-73f8fbcd083a"
const [duePath, controlPath, photoPath, out] = process.argv.slice(2)
assert.ok(out && !existsSync(out), "Use fresh result path and the three fixture receipts")
const due = JSON.parse(readFileSync(duePath)),
  control = JSON.parse(readFileSync(controlPath)),
  photo = JSON.parse(readFileSync(photoPath))
assert.ok(photo.withdrawn, "Withdraw the synthetic photo AFTER its inclusion in the newest backup")
const receipt = { started: new Date().toISOString(), target: DRILL, status: "preparing", steps: [], photos: [] }
const save = () => writeFileSync(out, JSON.stringify(receipt, null, 2), { mode: 0o600 })
save()
const keychain = (service, account) =>
  execFileSync("security", ["find-generic-password", "-s", service, ...(account ? ["-a", account] : []), "-w"], { encoding: "utf8" }).trim()
const token = keychain("makom-staging-cloudflare")
const ask = stagingRequester(
  due.base,
  {
    "CF-Access-Client-Id": "f8c96abaceeb5f600144af2dea0a3217.access",
    "CF-Access-Client-Secret": keychain("makom-staging-synthetic-moderator"),
  },
  process.env.EXPECT_TAG,
)
assert.equal((await ask("/api/v1/health")).status, 200)

let operations = 0
let cleaning = false
const request = async (path, init = {}) => {
  assert.ok(++operations <= (cleaning ? 1000 : 850), "Bounded exercise request budget exhausted")
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${token}`, "cf-r2-jurisdiction": "eu", ...init.headers },
  })
  assert.ok(r.ok || r.status === 404, `Cloud request failed (${r.status})`)
  return r
}
const api = async (path, body) => {
  const r = await request(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})
  const data = await r.json()
  assert.ok(data.success, "Cloud API refused request")
  return data
}
const root = `/accounts/${STAGING_ACCOUNT}`
stagingAccount(await api("/accounts"))
stagingDatabase(await api(`${root}/d1/database?name=makom-staging`))
const target = (await api(`${root}/d1/database/${DRILL}`)).result
assert.equal(target.name, "makom-staging-drill")
assert.equal(target.jurisdiction, "eu")
assert.ok(target.file_size < 5_000_000)
const bindings = (await api(`${root}/workers/scripts/makom-lizkor-staging/settings`)).result.bindings
assert.equal(bindings.find((b) => b.name === "ENVIRONMENT")?.text, "staging")
assert.equal(bindings.find((b) => b.name === "RETENTION_DAY_SECONDS")?.text, "7200")
assert.equal(bindings.find((b) => b.name === "DB")?.id, STAGING_DATABASE)
const query = async (id, body) => {
  assert.ok([STAGING_DATABASE, DRILL].includes(id))
  if (id === STAGING_DATABASE) assert.ok(!body.batch && /^SELECT\b/i.test(body.sql), "Serving database is read-only")
  const r = await api(`${root}/d1/database/${id}/query`, body)
  assert.ok(r.result.every((x) => x.success))
  return r.result
}
const main = async (sql, params = []) => (await query(STAGING_DATABASE, { sql, params }))[0].results
if (bindings.some((b) => b.name === "DRILL_DB")) {
  assert.equal(bindings.find((b) => b.name === "DRILL_DB").id, DRILL)
  const runs = await main("SELECT ok,started_at,finished_at FROM drill_runs ORDER BY started_at DESC LIMIT 1")
  assert.equal(runs[0]?.ok, 1)
  assert.ok(runs[0].finished_at)
  assert.ok(Date.now() - Date.parse(runs[0].started_at) < 7 * 7_200_000 - 1_800_000, "Scheduled drill might overlap")
}
function prepare(sql, params = []) {
  return {
    sql,
    params,
    bind(...p) {
      return prepare(sql, p)
    },
    async all() {
      return (await query(DRILL, { sql, params }))[0]
    },
    async run() {
      return this.all()
    },
    async first(column) {
      const row = (await this.all()).results[0] ?? null
      return column ? (row?.[column] ?? null) : row
    },
  }
}
const db = { prepare, batch: async (stmts) => query(DRILL, { batch: stmts.map(({ sql, params }) => ({ sql, params })) }) }
function bucket(name) {
  const base = `${root}/r2/buckets/${name}`
  const path = (key) => `${base}/objects/${key.split("/").map(encodeURIComponent).join("/")}`
  return {
    async get(key) {
      const r = await request(path(key))
      if (r.status === 404) return null
      const bytes = await r.arrayBuffer()
      return {
        arrayBuffer: async () => bytes,
        json: async () => JSON.parse(new TextDecoder().decode(bytes)),
        text: async () => new TextDecoder().decode(bytes),
      }
    },
    async list({ prefix = "", cursor } = {}) {
      const r = await api(
        `${base}/objects?prefix=${encodeURIComponent(prefix)}&per_page=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      )
      return { objects: r.result, truncated: !!r.result_info?.is_truncated, cursor: r.result_info?.cursor }
    },
    path,
  }
}
const exports = bucket("makom-staging-exports"),
  ledger = bucket("makom-staging-ledger"),
  media = bucket("makom-staging-media")
const prefix = `recovery-exercise/${crypto.randomUUID()}/`
receipt.prefix = prefix
save()
const written = []
const restoredMedia = {
  async head(key) {
    return media.get(prefix + key)
  },
  async put(key, bytes) {
    assert.ok(/^(public|held)\//.test(key))
    const full = prefix + key
    written.push(full)
    receipt.photos.push({ key: full, size: bytes.length })
    save()
    const r = await request(media.path(full), { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: bytes })
    assert.ok(r.ok)
  },
}
const temp = mkdtempSync("/private/tmp/makom-cloud-recovery-")
let app,
  dirty = false
try {
  await build({
    stdin: {
      contents:
        'export { importExport } from "./worker/db/import"; export { readLedger,replayLedger,restorePhotos } from "./worker/db/replay"; export { EXPORT_TABLES } from "./worker/db/exports"; export { sha256,unseal } from "./worker/lib/sealed"; export { durations } from "./worker/lib/durations";',
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(temp, "app.mjs"),
    logLevel: "error",
  })
  app = await import(pathToFileURL(join(temp, "app.mjs")))
  const latest = (
    await main("SELECT id,created_at,retention_run FROM exports WHERE ok=1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1")
  )[0]
  assert.ok(latest && Date.now() - Date.parse(latest.created_at) < 26 * 300000)
  assert.ok(
    Date.parse(latest.created_at) > Date.parse(photo.approved) && Date.parse(latest.created_at) < Date.parse(photo.withdrawn),
    "Newest export must include the photo before its withdrawal",
  )
  const retention = (await main("SELECT ok,finished_at FROM retention_runs WHERE id=?", [latest.retention_run]))[0]
  assert.equal(retention?.ok, 1)
  assert.ok(retention.finished_at)
  const manifest = await (await exports.get(`exports/${latest.id}/manifest.json`)).json()
  const bytes = new Uint8Array(await (await exports.get(manifest.data.key)).arrayBuffer())
  assert.equal(await app.sha256(bytes), manifest.data.sha256)
  const priv = JSON.parse(Buffer.from(keychain("makom-staging-export-drill", "staging"), "base64").toString())
  const plain = gunzipSync(await app.unseal(bytes, manifest.data, priv))
  assert.ok(plain.length < 5_000_000)
  const payload = JSON.parse(plain.toString())
  assert.deepEqual(Object.keys(payload.tables).sort(), [...app.EXPORT_TABLES].sort())
  for (const [name, info] of Object.entries(manifest.tables)) {
    assert.equal(payload.tables[name]?.length, info.rows)
    assert.equal(await app.sha256(new TextEncoder().encode(JSON.stringify(payload.tables[name]))), info.sha256)
  }
  const p = payload.tables.places.find((x) => x.id === photo.id)
  assert.equal(p?.status, "published")
  const oldPhoto = payload.tables.revisions.find((x) => x.id === p.published_revision_id)?.photo_key
  assert.ok(oldPhoto && manifest.files.some((f) => f.key === oldPhoto))
  const item = (c, role) => c.items.find((x) => x.role === role).id
  function contentChecks(tables) {
    for (const [role, reason] of [
      ["returned", "returned_expired"],
      ["rejected", "rejected_expired"],
      ["withdrawn", "withdrawn"],
    ]) {
      const id = item(due, role),
        place = tables.places.find((p) => p.id === id)
      assert.ok(place)
      assert.equal(place.status, role === "withdrawn" ? "withdrawn" : "erased")
      if (role !== "withdrawn") assert.equal(place.erased_reason, reason)
      const revisions = tables.revisions.filter((r) => r.place_id === id)
      assert.ok(revisions.length)
      for (const r of revisions)
        for (const field of [...ERASE_FIELDS, "on_private_property"]) assert.equal(r[field], field === "on_private_property" ? 0 : null)
    }
    const report = tables.reports.find((r) => r.id === item(due, "report"))
    assert.ok(report)
    for (const field of REPORT_FIELDS) assert.equal(report[field], null)
    assert.ok(!tables.contacts.some((c) => c.place_id === item(due, "published")))
    for (const role of ["published", "returned", "rejected", "pending"]) {
      const id = item(control, role)
      assert.equal(tables.places.find((p) => p.id === id)?.status, role)
      assert.ok(tables.revisions.some((r) => r.place_id === id && r.name_he?.includes(control.marker)))
    }
  }
  contentChecks(payload.tables)
  const counts = await db.batch(app.EXPORT_TABLES.map((t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`)))
  for (const [i, t] of app.EXPORT_TABLES.entries())
    assert.ok(counts[i].results[0].n === (t === "feed_state" ? 1 : 0) || counts[i].results[0].n === 0, "Target isn't empty")
  receipt.export = { id: latest.id, created_at: latest.created_at, retention_run: latest.retention_run }
  receipt.steps.push("newest_export_checksum_and_expiry_controls")
  save()
  const history = await app.readLedger(ledger),
    now = new Date(),
    days = app.durations({ ENVIRONMENT: "staging", RETENTION_DAY_SECONDS: "7200" })
  dirty = true
  const imported = await app.importExport(db, payload, now, history, days)
  assert.ok(imported.ok)
  await app.replayLedger(db, history, now, payload.created_at, days)
  const rows = await db.batch(app.EXPORT_TABLES.map((t) => db.prepare(`SELECT * FROM ${t}`)))
  const tables = Object.fromEntries(app.EXPORT_TABLES.map((t, i) => [t, rows[i].results]))
  contentChecks(tables)
  assert.equal(tables.places.find((x) => x.id === photo.id)?.status, "withdrawn")
  for (const r of tables.revisions.filter((r) => r.place_id === photo.id))
    for (const f of [...ERASE_FIELDS, "on_private_property"]) assert.equal(r[f], f === "on_private_property" ? 0 : null)
  const photos = await app.restorePhotos(db, restoredMedia, exports, manifest)
  assert.ok(photos.restored > 0)
  assert.equal(photos.missing, 0)
  assert.equal(photos.damaged, 0)
  assert.ok(!written.includes(prefix + oldPhoto))
  assert.equal(await media.get(prefix + oldPhoto), null)
  for (const key of written) {
    const expected = manifest.files.find(
      (f) => f.key.replace(/^held\//, "public/") === key.slice(prefix.length).replace(/^held\//, "public/"),
    )
    assert.ok(expected)
    assert.equal(await app.sha256(new Uint8Array(await (await media.get(key)).arrayBuffer())), expected.sha256)
  }
  receipt.steps.push("real_cloud_import_replay_expiry_and_post_export_withdrawal", "actual_media_restore_and_hashes")
  receipt.restored = photos
  receipt.status = "verified_pending_cleanup"
  save()
} catch (error) {
  receipt.status = "failed"
  receipt.error = error instanceof Error ? error.name : "Error"
  receipt.failedStep = receipt.steps.at(-1) ?? "preflight"
  save()
  process.exitCode = 1
} finally {
  cleaning = true
  try {
    // Only this fixed non-serving database and the exact keys allocated above are ever cleaned.
    if (dirty) {
      await db.batch([...app.EXPORT_TABLES].reverse().map((t) => db.prepare(`DELETE FROM ${t}`)))
      for (const t of app.EXPORT_TABLES) assert.equal(await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first("n"), 0)
    }
    for (const key of written) {
      assert.ok(key.startsWith(prefix))
      assert.ok((await request(media.path(key), { method: "DELETE" })).ok)
      assert.equal(await media.get(key), null)
    }
    receipt.cleaned = true
    receipt.steps.push("isolated_target_and_exercise_media_empty")
  } catch (error) {
    receipt.cleaned = false
    receipt.cleanupError = error instanceof Error ? error.name : "Error"
    process.exitCode = 1
  }
  rmSync(temp, { recursive: true, force: true })
  receipt.finished = new Date().toISOString()
  receipt.operations = operations
  if (receipt.status === "verified_pending_cleanup" && receipt.cleaned) receipt.status = "pass"
  save()
  console.log(JSON.stringify(receipt))
}
