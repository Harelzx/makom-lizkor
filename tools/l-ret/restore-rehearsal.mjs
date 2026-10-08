// L-RET E3: a restore rehearsal of a real staging export, run locally with the application's own code: the checkout's
// worker/db/drill.ts, import.ts and replay.ts and worker/lib/durations.ts and sealed.ts, bundled unchanged by esbuild at
// the start of each run (nothing re-implemented here).
//   1. Read-only from staging's R2 (eu): the export's manifest, data and photo copies, and every ledger entry. The
//      export rows in staging's D1 are read with one SELECT.
//   2. Fresh local D1 databases, each migrated by wrangler from the checkout's migrations: "main" (where the drill
//      looks the export up), "drill" (the drill's own target) and "restore" (Route B's target, kept to inspect).
//   3. runDrill, the weekly drill, with the drill key from the Keychain: the manifest, the data's and each table's
//      checksum and count, the filtered import, the ledger replayed, every photo copy's bytes read; then the in-memory
//      audit of every export kept. It does not restore photos (restorePhotos): media recovery is the Worker tests'.
//   4. Route B as the spec's procedure has it (spec 8.3 B): importExport then replayLedger into "restore", at the real
//      time now; then, with NOW_AT, the same restore at a later moment (simulated time: the application's own import
//      filter at that date, never evidence of the provider's deletion).
// Staging's scale is the only one used (RETENTION_DAY_SECONDS=7200, worker/lib/durations.ts). Prints statuses, counts
// and ids only: never a row's content, never a key. Every local database is disposed of and deleted at the end.
//   node tools/l-ret/restore-rehearsal.mjs <checkout> <export id> <cohort receipt.json> [NOW_AT=<iso>]
import {
  stagingAccount,
  stagingDatabase,
  stagingOrigin,
  assertTables,
  assertDrill,
  assertCohort,
  cohortCoverage,
  assertReport,
  temporaryDirectories,
} from "./guards.mjs"
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"

const [checkout, exportId, receiptPath, nowArg] = process.argv.slice(2)
if (!checkout || !exportId || !receiptPath)
  throw new Error("usage: node restore-rehearsal.mjs <checkout> <export id> <receipt.json> [NOW_AT=<iso>]")
const temporary = temporaryDirectories()
const instances = []
try {
  const need = createRequire(join(checkout, "package.json"))
  // The application's own code, bundled from this checkout for this run.
  const bundled = join(temporary.create("rehearsal-app-"), "app.mjs")
  await (
    await import(pathToFileURL(need.resolve("esbuild")).href)
  ).build({
    stdin: {
      contents: [
        'export { runDrill } from "./worker/db/drill"',
        'export { importExport } from "./worker/db/import"',
        'export { readLedger, replayLedger } from "./worker/db/replay"',
        'export { durations } from "./worker/lib/durations"',
        'export { unseal, sha256 } from "./worker/lib/sealed"',
        'export { EXPORT_TABLES } from "./worker/db/exports"',
      ].join("\n"),
      resolveDir: checkout,
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    loader: { ".wasm": "binary" },
    outfile: bundled,
    logLevel: "error",
  })
  const app = await import(pathToFileURL(bundled).href)
  // wrangler's local bindings, as the checkout has it (getPlatformProxy: the same local D1 and R2 the dev server uses).
  const { getPlatformProxy } = await import(pathToFileURL(need.resolve("wrangler")).href)
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"))
  stagingOrigin(receipt.base)
  // The mail sender below is a local stub. A synthetic recipient lets an export audit failure reach that stub.
  const STAGING_ENV = { ENVIRONMENT: "staging", RETENTION_DAY_SECONDS: "7200", MODERATORS: "rehearsal@example.invalid", PUBLIC_ORIGIN: "" }
  const days = app.durations(STAGING_ENV)

  // 1. Staging, read-only.
  const tok = execFileSync("security", ["find-generic-password", "-s", "makom-staging-cloudflare", "-w"], { encoding: "utf8" }).trim()
  const H = { Authorization: `Bearer ${tok}`, "cf-r2-jurisdiction": "eu" }
  const cf = (p, init = {}) => fetch(`https://api.cloudflare.com/client/v4${p}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } })
  const acct = stagingAccount(await (await cf("/accounts")).json())
  const objects = async (bucket, prefix) => {
    const keys = []
    let cursor = ""
    do {
      const page = await (
        await cf(
          `/accounts/${acct}/r2/buckets/${bucket}/objects?prefix=${encodeURIComponent(prefix)}&per_page=1000${cursor ? `&cursor=${cursor}` : ""}`,
        )
      ).json()
      if (!page.success) throw new Error(`listing ${bucket} refused: ${JSON.stringify(page.errors)}`)
      keys.push(...page.result.map((o) => o.key))
      cursor = page.result_info?.is_truncated ? page.result_info.cursor : ""
    } while (cursor)
    return keys
  }
  const get = async (bucket, key) => {
    const r = await cf(`/accounts/${acct}/r2/buckets/${bucket}/objects/${encodeURIComponent(key)}`)
    if (!r.ok) throw new Error(`${bucket}/${key}: ${r.status}`)
    return new Uint8Array(await r.arrayBuffer())
  }
  const d1 = async (sql) => {
    const db = stagingDatabase(await (await cf(`/accounts/${acct}/d1/database?name=makom-staging`)).json())
    const r = await (
      await cf(`/accounts/${acct}/d1/database/${db.uuid}/raw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql }),
      })
    ).json()
    if (!r.success) throw new Error(JSON.stringify(r.errors))
    const { columns, rows } = r.result[0].results
    return rows.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]])))
  }
  const exportRows = await d1(
    "SELECT id, created_at, retention_run, ok, deleted_at FROM exports WHERE ok = 1 AND deleted_at IS NULL ORDER BY created_at",
  )
  if (!exportRows.some((e) => e.id === exportId)) throw new Error(`${exportId} isn't a kept export on staging`)
  const kept = exportRows.filter((e) => e.created_at <= exportRows.find((x) => x.id === exportId).created_at)
  const exportFiles = new Map()
  for (const e of kept) {
    for (const key of await objects("makom-staging-exports", `exports/${e.id}/`))
      exportFiles.set(key, await get("makom-staging-exports", key))
  }
  const manifest = JSON.parse(new TextDecoder().decode(exportFiles.get(`exports/${exportId}/manifest.json`)))
  for (const f of manifest.files) exportFiles.set(`photos/${f.sha256}`, await get("makom-staging-exports", `photos/${f.sha256}`))
  const ledgerFiles = new Map()
  for (const key of await objects("makom-staging-ledger", "ledger/")) ledgerFiles.set(key, await get("makom-staging-ledger", key))
  console.log(
    `staging, read-only: export ${exportId} (created ${manifest.created_at}), ${kept.length} kept export(s) up to it, ${manifest.files.length} photo copies, ${ledgerFiles.size} ledger entries`,
  )

  // 2. Fresh local databases, migrated by wrangler from the repository's own migrations. One local-only configuration:
  // a database and the two buckets, nothing remote.
  const config = join(temporary.create("rehearsal-config-"), "wrangler.jsonc")
  writeFileSync(
    config,
    JSON.stringify({
      name: "rehearsal",
      compatibility_date: "2026-10-01",
      d1_databases: [
        {
          binding: "DB",
          database_name: "makom-dev",
          database_id: "00000000-0000-0000-0000-000000000000",
          migrations_dir: join(checkout, "migrations"),
        },
      ],
      r2_buckets: [
        { binding: "EXPORTS", bucket_name: "rehearsal-exports" },
        { binding: "LEDGER", bucket_name: "rehearsal-ledger" },
      ],
    }),
  )
  const fresh = () => {
    const dir = temporary.create("rehearsal-")
    execFileSync(
      join(checkout, "node_modules/.bin/wrangler"),
      ["d1", "migrations", "apply", "makom-dev", "--local", "--persist-to", dir, "--config", config],
      {
        cwd: checkout,
        stdio: "ignore",
        env: { ...process.env, CI: "1" },
      },
    )
    return dir
  }
  const local = async (dir) => {
    const proxy = await getPlatformProxy({ configPath: config, persist: { path: join(dir, "v3") }, remoteBindings: false })
    instances.push({ proxy, dir })
    const db = proxy.env.DB
    const migrated = await db.prepare("SELECT COUNT(*) AS n FROM d1_migrations").first("n")
    if (!migrated) throw new Error("the local database isn't the migrated one")
    return { db, env: proxy.env, migrated }
  }
  const nowAt = nowArg?.startsWith("NOW_AT=") ? new Date(nowArg.slice(7)) : null
  if (nowArg && (!nowAt || !Number.isFinite(nowAt.getTime()))) throw new Error("Invalid NOW_AT")
  const main = await local(fresh())
  const drill = await local(fresh())
  console.log(`local databases: fresh, ${main.migrated} migrations each`)
  for (const e of kept)
    await main.db
      .prepare("INSERT INTO exports (id, created_at, retention_run, ok, deleted_at) VALUES (?, ?, ?, ?, ?)")
      .bind(e.id, e.created_at, e.retention_run, e.ok, e.deleted_at)
      .run()
  const exportsBucket = main.env.EXPORTS
  const ledgerBucket = main.env.LEDGER
  for (const [k, v] of exportFiles) await exportsBucket.put(k, v)
  for (const [k, v] of ledgerFiles) await ledgerBucket.put(k, v)
  const drillKey = Buffer.from(
    execFileSync("security", ["find-generic-password", "-s", "makom-staging-export-drill", "-a", "staging", "-w"], {
      encoding: "utf8",
    }).trim(),
    "base64",
  ).toString("utf8")

  // 3. The weekly drill, unchanged.
  const mails = []
  const now = new Date()
  await app.runDrill(
    {
      db: main.db,
      exports: exportsBucket,
      ledger: ledgerBucket,
      drillDb: drill.db,
      drillKey,
      env: STAGING_ENV,
      sendMail: async (m) => (mails.push(m.subject ?? "mail"), true),
    },
    now,
  )
  const run = await main.db.prepare("SELECT ok, failure, export_id FROM drill_runs ORDER BY started_at DESC LIMIT 1").first()
  const left = Object.fromEntries(
    await Promise.all(
      app.EXPORT_TABLES.map(async (table) => [table, await drill.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first("n")]),
    ),
  )
  assertDrill(run, left, exportId, mails)
  console.log(`drill: passed on ${run.export_id}; all ${Object.keys(left).length} exported tables emptied; no failure notifications`)

  // 4. Route B: the filtered import, then the ledger since the export, into a fresh database kept to inspect.
  const restoreAt = async (at, label) => {
    const target = await local(fresh())
    const data = exportFiles.get(manifest.data.key)
    if ((await app.sha256(data)) !== manifest.data.sha256) throw new Error("the data's checksum differs from the manifest's")
    const plain = await app.unseal(data, manifest.data, JSON.parse(drillKey))
    const payload = JSON.parse(await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"))).text())
    assertTables(payload, manifest)
    const coverage = cohortCoverage(receipt, payload, at)
    const ledger = await app.readLedger(ledgerBucket)
    const imported = await app.importExport(target.db, payload, at, ledger, days)
    if (!imported.ok) throw new Error(`import refused: ${imported.reason}`)
    await app.replayLedger(target.db, ledger, at, payload.created_at, days)
    console.log(
      `restore (${label}, at ${at.toISOString()}): imported ${Object.entries(imported.counts)
        .map(([t, n]) => `${t} ${n}`)
        .join(", ")}`,
    )
    for (const { item } of coverage.checked.filter(({ item }) => item.role !== "report")) {
      const p = await target.db.prepare("SELECT status, erased_reason FROM places WHERE id = ?").bind(item.id).first()
      const marked = await target.db
        .prepare("SELECT COUNT(*) AS n FROM revisions WHERE place_id = ?1 AND (name_he LIKE ?2 OR decision_note LIKE ?2)")
        .bind(item.id, `%${receipt.marker}%`)
        .first("n")
      assertCohort(item, p, marked, at)
      console.log(
        `  ${item.role} ${item.id}: ${p ? `${p.status}${p.erased_reason ? ` (${p.erased_reason})` : ""}` : "absent"}; revisions holding the marker: ${marked}`,
      )
    }
    for (const { item: report, source } of coverage.checked.filter(({ item }) => item.role === "report")) {
      const r = await target.db
        .prepare("SELECT explanation, reporter_key, explanation_hash FROM reports WHERE id = ?")
        .bind(report.id)
        .first()
      assertReport(source, r, at)
      console.log(`  report ${report.id}: explanation ${r.explanation === null ? "empty" : "kept"}; abuse codes absent`)
    }
    for (const item of coverage.excluded) console.log(`  excluded ${item.role} ${item.id}: event is newer than the selected export`)
    if (!coverage.complete) {
      process.exitCode = 3
      console.log(`  retention cohort INCOMPLETE: missing coverage for ${coverage.missing.join(", ")}`)
    } else console.log("  retention cohort: all six required cases checked")
    const published = (await target.db.prepare("SELECT id FROM places WHERE status = 'published' ORDER BY id").all()).results.map(
      (r) => r.id,
    )
    console.log(`  published after the restore: ${published.length} (${published.join(", ")})`)
    return published
  }
  const restored = await restoreAt(now, "real time")
  const live = (await d1("SELECT id FROM places WHERE status = 'published' ORDER BY id")).map((r) => r.id)
  const missing = live.filter((id) => !restored.includes(id))
  const extra = restored.filter((id) => !live.includes(id))
  console.log(
    `  against staging's live published set (${live.length}): ${missing.length ? `missing ${missing.join(", ")}` : "none missing"}; ${extra.length ? `extra ${extra.join(", ")}` : "none extra"}`,
  )
  if (nowAt) await restoreAt(nowAt, "simulated time: the import filter at that moment")
} finally {
  const errors = []
  for (const { proxy } of instances) {
    try {
      await proxy.dispose()
    } catch (error) {
      errors.push(error)
    }
  }
  try {
    temporary.cleanup()
  } catch (error) {
    errors.push(error)
  }
  if (errors.length) throw new AggregateError(errors, "Local rehearsal cleanup failed")
}
