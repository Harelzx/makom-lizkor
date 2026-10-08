import assert from "node:assert/strict"
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readdirSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  STAGING_ORIGIN,
  STAGING_ACCOUNT,
  STAGING_DATABASE,
  stagingOrigin,
  stagingAccount,
  stagingDatabase,
  stagingRequester,
  assertTables,
  assertDrill,
  assertCohort,
  temporaryDirectories,
} from "../tools/l-ret/guards.mjs"

const machine = { "CF-Access-Client-Id": "synthetic-id", "CF-Access-Client-Secret": "synthetic-secret" }
const tag = "staging-123456789abc"

test("staging credentials cannot be sent to a different origin, or via a redirect", async () => {
  const sent = []
  const ask = stagingRequester(STAGING_ORIGIN, machine, tag, async (url, init) => {
    sent.push({ url, init })
    return new Response("{}", { headers: { "X-Worker-Version": tag } })
  })
  await assert.rejects(ask("https://example.invalid/collect"), /cannot leave/)
  await assert.rejects(ask("//example.invalid/collect"), /cannot leave/)
  assert.equal(sent.length, 0)
  await ask("/api/v1/health", { redirect: "follow" })
  assert.equal(sent[0].url.origin, STAGING_ORIGIN)
  assert.equal(sent[0].init.redirect, "manual")
  assert.equal(sent[0].init.headers["CF-Access-Client-Secret"], "synthetic-secret")
})

test("staging origin, credentials and deployment tag are required before any request", () => {
  assert.equal(stagingOrigin(`${STAGING_ORIGIN}/`), STAGING_ORIGIN)
  for (const bad of [
    "https://example.invalid",
    `${STAGING_ORIGIN}/path`,
    `${STAGING_ORIGIN}?x=1`,
    `${STAGING_ORIGIN}#x`,
    STAGING_ORIGIN.replace("https://", "https://user@"),
  ])
    assert.throws(() => stagingRequester(bad, machine, tag), /staging origin/)
  assert.throws(() => stagingRequester(STAGING_ORIGIN, { "CF-Access-Client-Id": "id" }, tag), /complete staging/)
  assert.throws(() => stagingRequester(STAGING_ORIGIN, machine, "production-123456789abc"), /complete staging/)
})

test("a stale or missing Worker tag cannot become successful evidence", async () => {
  for (const headers of [{}, { "X-Worker-Version": "staging-ffffffffffff" }]) {
    const ask = stagingRequester(STAGING_ORIGIN, machine, tag, async () => new Response("{}", { headers }))
    await assert.rejects(ask("/api/v1/health"), /version does not match/)
  }
})

test("readers select the exact authorized account and database without first-item fallbacks", () => {
  assert.equal(stagingAccount({ success: true, result: [{ id: "other" }, { id: STAGING_ACCOUNT }] }), STAGING_ACCOUNT)
  const database = { name: "makom-staging", uuid: STAGING_DATABASE }
  assert.deepEqual(stagingDatabase({ success: true, result: [{ name: "other", uuid: "other" }, database] }), database)
  for (const reply of [
    { success: false, result: [{ id: STAGING_ACCOUNT }] },
    { success: true, result: [{ id: "other" }] },
    { success: true, result: [] },
  ])
    assert.throws(() => stagingAccount(reply), /authorized staging account/)
  for (const result of [
    [],
    [{ name: "makom-staging", uuid: "wrong" }],
    [{ name: "production", uuid: STAGING_DATABASE }],
    [database, database],
  ])
    assert.throws(() => stagingDatabase({ success: true, result }), /exactly once/)
})

test("export validation rejects row mismatches, missing tables and unexpected tables", () => {
  const manifest = { tables: { places: { rows: 1 }, revisions: { rows: 0 } } }
  assertTables({ tables: { places: [{ id: "p_test" }], revisions: [] } }, manifest)
  for (const tables of [
    { places: [], revisions: [] },
    { places: [{ id: "p_test" }] },
    { places: [{ id: "p_test" }], revisions: [], unexpected: [] },
    { places: { length: 1 }, revisions: [] },
  ])
    assert.throws(() => assertTables({ tables }, manifest))
})

test("drill evidence fails on unsuccessful run, wrong export, incomplete cleanup or audit warning", () => {
  const run = { ok: 1, export_id: "ex_test" }
  const empty = { places: 0, contacts: 0, revisions: 0 }
  assertDrill(run, empty, "ex_test", [])
  assert.throws(() => assertDrill(null, empty, "ex_test", []), /did not succeed/)
  assert.throws(() => assertDrill({ ...run, ok: 0 }, empty, "ex_test", []), /did not succeed/)
  assert.throws(() => assertDrill(run, empty, "ex_other", []), /different export/)
  assert.throws(() => assertDrill(run, { ...empty, contacts: 1 }, "ex_test", []), /left data in contacts/)
  assert.throws(() => assertDrill(run, {}, "ex_test", []), /No drill cleanup counts/)
  assert.throws(() => assertDrill(run, empty, "ex_test", ["export_audit"]), /reported a failure/)
})

test("expired or withdrawn cohort content must be blank while live content must survive", () => {
  const at = new Date("2026-10-08T12:00:00Z")
  const expired = { role: "returned", deadline: at.toISOString() }
  assertCohort(expired, { status: "erased", erased_reason: "returned_expired" }, 0, at)
  assert.throws(() => assertCohort(expired, { status: "returned" }, 1, at), /Unexpected restored state/)
  assert.throws(() => assertCohort(expired, { status: "erased", erased_reason: "returned_expired" }, 1, at), /text returned/)
  assert.throws(() => assertCohort({ role: "returned" }, { status: "returned" }, 1, at), /Missing cohort deadline/)
  assertCohort({ role: "withdrawn" }, { status: "withdrawn" }, 0, at)
  assert.throws(() => assertCohort({ role: "withdrawn" }, { status: "withdrawn" }, 1, at), /text returned/)
  assertCohort({ role: "published" }, { status: "published" }, 1, at)
  assert.throws(() => assertCohort({ role: "published" }, { status: "published" }, 0, at), /text is missing/)
})

test("temporary directories are registered before setup, and can all be removed", () => {
  const parent = mkdtempSync(join(tmpdir(), "l-ret-cleanup-test-"))
  try {
    const temporary = temporaryDirectories(parent)
    const dirs = [temporary.create("first-"), temporary.create("second-")]
    assert.ok(dirs.every(existsSync))
    temporary.cleanup()
    assert.deepEqual(readdirSync(parent), [])
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

test("actual rehearsal cleans its bundle directory when dependency setup fails, before credentials are read", () => {
  const parent = mkdtempSync(join(tmpdir(), "l-ret-setup-test-"))
  try {
    const result = spawnSync(
      process.execPath,
      ["tools/l-ret/restore-rehearsal.mjs", join(parent, "missing-checkout"), "ex_test", "unused.json"],
      {
        encoding: "utf8",
        timeout: 5000,
        env: { ...process.env, TMPDIR: parent },
      },
    )
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Cannot find module 'esbuild'/)
    assert.deepEqual(readdirSync(parent), [])
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

test("actual cohort and photo commands refuse a foreign host before calling the network", () => {
  for (const args of [
    ["tools/l-ret/a2-cohort.mjs", "https://example.invalid", "unused.json"],
    ["tools/l-ret/a2-photo.mjs", "https://example.invalid", "create", "unused.json", "unused.jpg"],
  ]) {
    const result = spawnSync(process.execPath, args, {
      encoding: "utf8",
      timeout: 5000,
      env: { ...process.env, MACHINE: JSON.stringify(machine), EXPECT_TAG: tag, NOTICE: "synthetic" },
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /only the authorized staging origin/)
  }
})
