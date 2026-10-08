// Bounded real-cloud expiry fixture. Only moves application-owned deadlines on a NEW synthetic A2 cohort.
// It never runs the job, deletes data itself, changes provider times, or changes deployment configuration.
// Two separately-created cohorts are required: one due, one untouched control. Both must be <1h old when seeded.
// node tools/l-ret/expiry-fixture.mjs seed|check <due.json> <control.json> <evidence.json>
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { STAGING_ACCOUNT, STAGING_DATABASE, stagingAccount, stagingDatabase, stagingOrigin, stagingRequester } from "./guards.mjs"

const DAY = 7_200_000
const ROLES = ["published", "returned", "rejected", "pending", "withdrawn", "report"]
export function validateCohorts(due, control, now, fresh = true) {
  const ids = new Set()
  assert.notEqual(due.marker, control.marker, "Cohorts must differ")
  assert.equal(due.expectTag, control.expectTag, "Cohorts must share a deployment")
  assert.match(due.expectTag, /^staging-[a-f0-9]{12}$/)
  for (const c of [due, control]) {
    stagingOrigin(c.base)
    assert.match(c.marker, /^A2-[a-f0-9]{8}$/)
    const started = Date.parse(c.started)
    assert.ok(Number.isFinite(started) && started <= now && (!fresh || now - started < 3_600_000), "Not a fresh cohort")
    for (const role of ROLES) {
      const items = c.items.filter((i) => i.role === role)
      assert.equal(items.length, 1, `Exactly one ${role} required`)
      const { id } = items[0]
      assert.match(id, role === "report" ? /^r_[0-9A-HJKMNP-TV-Z]{26}$/ : /^p_[0-9A-HJKMNP-TV-Z]{26}$/)
      assert.ok(!ids.has(id), "Duplicate cohort id")
      ids.add(id)
    }
  }
}
export function expiryUpdates(c, places, now) {
  const iso = (ms) => new Date(ms).toISOString()
  const at = iso(now - 60_000)
  const item = (role) => c.items.find((i) => i.role === role)
  const updates = []
  for (const role of ["returned", "rejected"]) {
    const p = places.find((r) => r.id === item(role).id)
    assert.ok(p && p.status === role && Number.isInteger(p.rev) && p.rev > 0, "Unexpected fixture state")
    updates.push({
      kind: role,
      sql: `UPDATE places SET status_changed_at = ? WHERE id = ? AND origin = 'contribution' AND status = ? AND rev = ?
        AND created_at >= ? AND EXISTS (SELECT 1 FROM revisions r WHERE r.place_id = places.id AND r.state = ?
          AND instr(r.name_he, ?) > 0 AND instr(r.name_he, '[סינתטי]') > 0)
        AND NOT EXISTS (SELECT 1 FROM revisions r WHERE r.place_id = places.id AND
          (r.name_he IS NULL OR instr(r.name_he, ?) = 0 OR instr(r.name_he, '[סינתטי]') = 0))`,
      params: [iso(now - 30 * DAY - 60_000), p.id, role, p.rev, c.started, role, c.marker, c.marker],
    })
  }
  const published = item("published").id
  updates.push({
    kind: "contact",
    sql: `UPDATE contacts SET purge_after = ? WHERE place_id = ? AND name = ? AND created_at >= ?
      AND EXISTS (SELECT 1 FROM places WHERE id = contacts.place_id AND status = 'published' AND origin = 'contribution')`,
    params: [at, published, `[סינתטי] ${c.marker}`, c.started],
  })
  updates.push({
    kind: "report",
    sql: `UPDATE reports SET purge_after = ? WHERE id = ? AND place_id = ? AND received_at >= ?
      AND instr(explanation, ?) > 0 AND instr(explanation, '[סינתטי]') > 0`,
    params: [at, item("report").id, published, c.started, c.marker],
  })
  updates.push({
    kind: "tribute",
    sql: `UPDATE tribute_events SET received_at = ? WHERE place_id = ? AND received_at >= ?
      AND EXISTS (SELECT 1 FROM revisions r WHERE r.place_id = tribute_events.place_id
        AND r.state = 'approved' AND instr(r.name_he, ?) > 0 AND instr(r.name_he, '[סינתטי]') > 0)`,
    params: [iso(now - 8 * DAY - 60_000), published, c.started, c.marker],
  })
  return updates
}

async function main() {
  const [mode, dueFile, controlFile, out] = process.argv.slice(2)
  assert.ok(["seed", "check"].includes(mode) && out, "usage: seed|check due.json control.json evidence.json")
  const due = JSON.parse(readFileSync(dueFile)),
    control = JSON.parse(readFileSync(controlFile))
  validateCohorts(due, control, Date.now(), mode === "seed")
  if (mode === "seed") assert.ok(!existsSync(out), "Refusing to overwrite seed evidence")
  const token = execFileSync("security", ["find-generic-password", "-s", "makom-staging-cloudflare", "-w"], { encoding: "utf8" }).trim()
  const api = async (path, body) => {
    const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      method: body ? "POST" : "GET",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    assert.ok(r.ok, `Cloud API status ${r.status}`)
    const data = await r.json()
    assert.ok(data.success, "Cloud API refused request")
    return data
  }
  stagingAccount(await api("/accounts"))
  stagingDatabase(await api(`/accounts/${STAGING_ACCOUNT}/d1/database?name=makom-staging`))
  const settings = await api(`/accounts/${STAGING_ACCOUNT}/workers/scripts/makom-lizkor-staging/settings`)
  const bindings = settings.result.bindings
  assert.equal(bindings.find((b) => b.name === "ENVIRONMENT")?.text, "staging")
  assert.equal(bindings.find((b) => b.name === "RETENTION_DAY_SECONDS")?.text, "7200")
  assert.equal(bindings.find((b) => b.name === "DB")?.id, STAGING_DATABASE)
  const machine = {
    "CF-Access-Client-Id": "f8c96abaceeb5f600144af2dea0a3217.access",
    "CF-Access-Client-Secret": execFileSync("security", ["find-generic-password", "-s", "makom-staging-synthetic-moderator", "-w"], {
      encoding: "utf8",
    }).trim(),
  }
  assert.equal((await stagingRequester(due.base, machine, due.expectTag)("/api/v1/health")).status, 200)
  const query = async (sql, params = []) => {
    const r = await api(`/accounts/${STAGING_ACCOUNT}/d1/database/${STAGING_DATABASE}/query`, { sql, params })
    assert.equal(r.result.length, 1)
    assert.ok(r.result[0].success)
    return r.result[0]
  }
  const snapshot = async (c) => {
    const ids = c.items.filter((i) => ROLES.includes(i.role) && i.role !== "report").map((i) => i.id)
    const p = await query(
      `SELECT p.id,p.status,p.rev,p.erased_reason,
      (SELECT count(*) FROM revisions r WHERE r.place_id=p.id AND r.name_he IS NOT NULL) AS content,
      (SELECT count(*) FROM contacts c WHERE c.place_id=p.id) AS contacts,
      (SELECT count(*) FROM tribute_events t WHERE t.place_id=p.id) AS events,
      (SELECT total FROM tribute_totals t WHERE t.place_id=p.id) AS total
      FROM places p WHERE p.id IN (${ids.map(() => "?").join(",")}) ORDER BY p.id`,
      ids,
    )
    const r = await query(`SELECT id,explanation IS NOT NULL AS content FROM reports WHERE id=?`, [
      c.items.find((i) => i.role === "report").id,
    ])
    return { places: p.results, reports: r.results }
  }
  const before = { due: await snapshot(due), control: await snapshot(control) }
  if (mode === "seed") {
    // Preflight all five updates without mutation, then each write retains its guards. Any partial seed is recorded.
    const at = Date.now()
    const updates = expiryUpdates(due, before.due.places, at)
    for (const u of updates) {
      const where = u.sql.slice(u.sql.indexOf(" WHERE "))
      const table = /^UPDATE (\w+)/.exec(u.sql)[1]
      const checked = await query(`SELECT count(*) AS n FROM ${table}${where}`, u.params.slice(1))
      assert.equal(checked.results[0].n, 1, `${u.kind}: preflight requires exactly one row`)
    }
    const receipt = { mode, at: new Date(at).toISOString(), due, control, before, updates: [], status: "seeding" }
    const save = () => writeFileSync(out, JSON.stringify(receipt, null, 2), { mode: 0o600 })
    save()
    for (const u of updates) {
      const result = await query(u.sql, u.params)
      receipt.updates.push({ kind: u.kind, changes: result.meta.changes, seeded_date: u.params[0] })
      save()
      assert.equal(result.meta.changes, 1, `${u.kind}: concurrent change; stop and inspect saved receipt`)
    }
    receipt.status = "awaiting_real_cron"
    save()
    console.log(JSON.stringify({ status: receipt.status, at: receipt.at, updates: receipt.updates, out }))
  } else {
    const seed = JSON.parse(readFileSync(out))
    assert.equal(seed.status, "awaiting_real_cron")
    assert.equal(seed.due.marker, due.marker)
    assert.equal(seed.control.marker, control.marker)
    const runs = (
      await query("SELECT id,started_at,finished_at,ok,counts FROM retention_runs WHERE started_at > ? AND ok=1 ORDER BY started_at", [
        seed.at,
      ])
    ).results
    assert.ok(runs.length > 0, "No completed real retention run since seeding")
    const totals = runs
      .map((r) => JSON.parse(r.counts))
      .reduce((sum, row) => {
        for (const key of ["erased", "contacts", "reports", "tributes"]) sum[key] = (sum[key] ?? 0) + row[key]
        return sum
      }, {})
    for (const [kind, minimum] of Object.entries({ erased: 2, contacts: 1, reports: 1, tributes: 1 }))
      assert.ok(totals[kind] >= minimum, `No corresponding ${kind} job count`)
    const by = (c, snap, role) => snap.places.find((p) => p.id === c.items.find((i) => i.role === role).id)
    for (const role of ["returned", "rejected"]) {
      const p = by(due, before.due, role)
      assert.equal(p.status, "erased")
      assert.equal(p.content, 0)
      assert.equal(p.contacts, 0)
      assert.equal(p.erased_reason, `${role}_expired`)
    }
    const published = by(due, before.due, "published")
    assert.equal(published.status, "published")
    assert.ok(published.content > 0)
    assert.equal(published.contacts, 0)
    assert.equal(published.events, 0)
    assert.equal(published.total, by(due, seed.before.due, "published").total)
    assert.equal(before.due.reports[0]?.content, 0)
    assert.deepEqual(before.control, seed.before.control, "The not-due cohort changed")
    const result = { status: "pass", at: new Date().toISOString(), seed: out, actual: before, runs }
    writeFileSync(`${out}.checked.json`, JSON.stringify(result, null, 2))
    console.log(
      JSON.stringify({
        status: "pass",
        cases: ["returned", "rejected", "contacts", "report", "tribute", "unchanged_controls"],
        out: `${out}.checked.json`,
      }),
    )
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
