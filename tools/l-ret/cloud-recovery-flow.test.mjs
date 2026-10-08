// The real application import/replay/photo functions through the REST adapter, against the repository's SQLite schema.
import { test } from "node:test"
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { build } from "esbuild"
import { cloudD1, queryResults, recoveryBudget, cleanupRecovery } from "./cloud-recovery-support.mjs"

test("import, post-backup withdrawal, surviving media hashes and independent cleanup use the actual adapter", async (t) => {
  const temp = mkdtempSync("/private/tmp/makom-recovery-test-")
  t.after(() => rmSync(temp, { recursive: true, force: true }))
  await build({
    stdin: {
      contents:
        'export { importExport } from "./worker/db/import"; export { replayLedger,restorePhotos } from "./worker/db/replay"; export { EXPORT_TABLES } from "./worker/db/exports"; export { sha256 } from "./worker/lib/sealed"; export { REAL } from "./worker/lib/durations";',
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    loader: { ".wasm": "binary" },
    platform: "node",
    format: "esm",
    outfile: `${temp}/app.mjs`,
    logLevel: "error",
  })
  const app = await import(pathToFileURL(`${temp}/app.mjs`))
  const fresh = () => {
    const db = new DatabaseSync(":memory:")
    t.after(() => db.close())
    db.exec("PRAGMA foreign_keys=ON; CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT)")
    for (const [i, name] of readdirSync("migrations")
      .filter((n) => n.endsWith(".sql"))
      .sort()
      .entries()) {
      db.exec(readFileSync(`migrations/${name}`, "utf8"))
      db.prepare("INSERT INTO d1_migrations VALUES (?,?)").run(i + 1, name)
    }
    return db
  }
  const source = fresh(),
    target = fresh(),
    at = "2026-10-08T15:00:00.000Z",
    now = new Date("2026-10-08T16:00:00.000Z")
  for (const id of ["keep", "withdraw"]) {
    source
      .prepare(
        "INSERT INTO places(id,origin,status,rev,published_revision_id,created_at,status_changed_at) VALUES (?,'contribution','published',1,?,?,?)",
      )
      .run(id, `r_${id}`, at, at)
    source
      .prepare("INSERT INTO revisions(id,place_id,n,state,name_he,photo_key,created_at) VALUES (?,?,1,'approved',?,?,?)")
      .run(`r_${id}`, id, `synthetic ${id}`, `public/${id}.jpg`, at)
  }
  const payload = {
    format: 1,
    id: "ex_test",
    created_at: at,
    schema: readdirSync("migrations")
      .filter((n) => n.endsWith(".sql"))
      .sort()
      .at(-1),
    tables: Object.fromEntries(
      app.EXPORT_TABLES.map((name) => [name, JSON.parse(JSON.stringify(source.prepare(`SELECT * FROM ${name}`).all()))]),
    ),
  }
  const budget = recoveryBudget()
  const db = cloudD1(async (body) => {
    budget.statements(body)
    const entries = body.batch ?? [body]
    target.exec("BEGIN")
    try {
      const result = entries.map(({ sql, params }) => ({
        success: true,
        results: JSON.parse(JSON.stringify(target.prepare(sql).all(...params))),
      }))
      target.exec("COMMIT")
      return queryResults({ success: true, result }, entries.length)
    } catch (e) {
      target.exec("ROLLBACK")
      throw e
    }
  })
  const history = new Map([
    [
      "withdraw",
      [
        {
          op: "withdraw_test",
          place: "withdraw",
          phase: "commit",
          kind: "withdraw",
          actor: "submitter",
          seq_from: 0,
          seq_to: 1,
          rev_from: 1,
          rev_to: 2,
          removal: true,
          status: "withdrawn",
          at: "2026-10-08T15:30:00.000Z",
        },
      ],
    ],
  ])
  assert.equal((await app.importExport(db, payload, now, history, app.REAL)).ok, true)
  await app.replayLedger(db, history, now, at, app.REAL)
  assert.equal(await db.prepare("SELECT status FROM places WHERE id=?").bind("withdraw").first("status"), "withdrawn")
  assert.equal(await db.prepare("SELECT photo_key FROM revisions WHERE place_id=?").bind("withdraw").first("photo_key"), null)
  const bytes = new TextEncoder().encode("synthetic image bytes"),
    hash = await app.sha256(bytes),
    media = new Map()
  const manifest = {
    files: [
      { key: "public/keep.jpg", sha256: hash },
      { key: "public/withdraw.jpg", sha256: hash },
    ],
  }
  const result = await app.restorePhotos(
    db,
    { head: async (k) => media.get(k), put: async (k, v) => media.set(k, v) },
    { get: async () => ({ arrayBuffer: async () => bytes.buffer }) },
    manifest,
  )
  assert.deepEqual(result, { restored: 1, missing: 0, damaged: 0 })
  assert.equal(await app.sha256(media.get("public/keep.jpg")), hash)
  assert.ok(!media.has("public/withdraw.jpg"))
  const cleanup = await cleanupRecovery({
    db,
    tables: app.EXPORT_TABLES,
    allocated: [...media.keys()],
    remove: async (k) => media.delete(k),
    absent: async (k) => !media.has(k),
    mayContainExercise: true,
    wasEmpty: false,
  })
  assert.equal(cleanup.complete, true)
  assert.ok(budget.sql < 1000)
})
