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
// Independent oracle for every field erased by the existing retention contract. Only presence/counts leave D1.
export const ERASE_FIELDS = [
  "kind",
  "name_he",
  "lat",
  "lng",
  "location_precision",
  "location_permission_at",
  "access_note_he",
  "place_he",
  "in_memory_of",
  "story_he",
  "link_url",
  "decision_note",
  "photo_key",
  "photo_alt",
  "photo_credit",
  "curated",
]
export const REPORT_FIELDS = ["relationship", "explanation", "email", "explanation_hash", "reporter_key", "handling_note"]
export async function cohortSnapshot(query, c) {
  const ids = c.items.filter((i) => ROLES.includes(i.role) && i.role !== "report").map((i) => i.id)
  const revisionContent = ERASE_FIELDS.map((f) => `r.${f} IS NOT NULL`)
    .concat("r.on_private_property != 0")
    .join(" OR ")
  const p = await query(
    `SELECT p.id,p.status,p.rev,p.erased_reason,p.created_at,p.status_changed_at,
    (SELECT count(*) FROM revisions r WHERE r.place_id=p.id) AS revisions,
    (SELECT count(*) FROM revisions r WHERE r.place_id=p.id AND (${revisionContent})) AS content,
    (SELECT count(*) FROM revisions r WHERE r.place_id=p.id AND r.name_he IS NOT NULL AND r.lat IS NOT NULL AND r.lng IS NOT NULL) AS named_coordinates,
    (SELECT count(*) FROM revisions r WHERE r.place_id=p.id AND r.decision_note IS NOT NULL) AS notes,
    (SELECT count(*) FROM contacts c WHERE c.place_id=p.id) AS contacts,
    (SELECT count(*) FROM contacts c WHERE c.place_id=p.id AND c.name IS NOT NULL) AS contact_names,
    (SELECT min(purge_after) FROM contacts c WHERE c.place_id=p.id) AS contact_deadline,
    (SELECT count(*) FROM tribute_events t WHERE t.place_id=p.id) AS events,
    (SELECT min(received_at) FROM tribute_events t WHERE t.place_id=p.id) AS oldest_event,
    (SELECT total FROM tribute_totals t WHERE t.place_id=p.id) AS total
    FROM places p WHERE p.id IN (${ids.map(() => "?").join(",")}) ORDER BY p.id`,
    ids,
  )
  const r = await query(
    `SELECT id,purge_after,received_at,${REPORT_FIELDS.map((f) => `${f} IS NOT NULL AS ${f}`).join(",")}
    FROM reports WHERE id=?`,
    [c.items.find((i) => i.role === "report").id],
  )
  return { places: p.results, reports: r.results }
}
export function assertBaseline(c, s, now) {
  assert.equal(s.places.length, 5, "Missing place controls")
  for (const item of c.items.filter((i) => ROLES.includes(i.role) && i.role !== "report")) {
    const p = s.places.find((p) => p.id === item.id)
    assert.ok(p, `Missing ${item.role}`)
    assert.equal(p.status, item.role)
    assert.equal(p.revisions, 1)
    assert.ok(Date.parse(p.created_at) >= Date.parse(c.started))
    const live = item.role !== "withdrawn"
    assert.equal(p.content, live ? 1 : 0)
    assert.equal(p.named_coordinates, live ? 1 : 0)
    assert.equal(p.contacts, live ? 1 : 0)
    assert.equal(p.contact_names, live ? 1 : 0)
    if (live) assert.ok(Date.parse(p.contact_deadline) > now, "Control contact is already due")
    if (["returned", "rejected"].includes(item.role)) {
      assert.equal(p.notes, 1, "Decision-note fixture missing")
      assert.ok(Date.parse(p.status_changed_at) + 30 * DAY > now, "Control place is already due")
    }
    if (item.role === "published") {
      assert.equal(p.events, 1)
      assert.equal(p.total, 1)
      assert.ok(Date.parse(p.oldest_event) + 8 * DAY > now, "Control tribute is already due")
    }
  }
  assert.equal(s.reports.length, 1, "Missing report control")
  const report = s.reports[0]
  assert.equal(report.id, c.items.find((i) => i.role === "report").id)
  for (const field of ["explanation", "explanation_hash", "reporter_key"]) assert.equal(report[field], 1, `Missing report ${field}`)
  assert.ok(Date.parse(report.purge_after) > now, "Control report already due")
  assert.ok(Date.parse(report.received_at) + DAY > now, "Control abuse codes already due")
}
export function assertOutcome(due, control, actual, seed, runs) {
  assert.equal(seed.status, "awaiting_real_cron")
  assert.equal(seed.due.marker, due.marker)
  assert.equal(seed.control.marker, control.marker)
  assertBaseline(due, seed.before.due, Date.parse(seed.at))
  assertBaseline(control, seed.before.control, Date.parse(seed.at))
  assert.ok(runs.length > 0, "No completed real retention run since seeding")
  const totals = runs.reduce((sum, r) => {
    assert.equal(r.ok, 1)
    assert.ok(Date.parse(r.started_at) > Date.parse(seed.at) && Date.parse(r.finished_at) >= Date.parse(r.started_at))
    const row = JSON.parse(r.counts)
    for (const key of ["erased", "contacts", "reports", "tributes"]) sum[key] = (sum[key] ?? 0) + row[key]
    return sum
  }, {})
  for (const [kind, minimum] of Object.entries({ erased: 2, contacts: 1, reports: 1, tributes: 1 }))
    assert.ok(totals[kind] >= minimum, `No corresponding ${kind} job count`)
  const by = (s, role) => s.places.find((p) => p.id === due.items.find((i) => i.role === role).id)
  assert.equal(actual.due.places.length, 5)
  for (const role of ["returned", "rejected"]) {
    const p = by(actual.due, role)
    assert.ok(p)
    assert.equal(p.status, "erased")
    assert.equal(p.content, 0)
    assert.equal(p.contacts, 0)
    assert.equal(p.erased_reason, `${role}_expired`)
  }
  const published = by(actual.due, "published")
  assert.ok(published)
  assert.equal(published.status, "published")
  assert.equal(published.content, 1)
  assert.equal(published.contacts, 0)
  assert.equal(published.events, 0)
  assert.equal(published.total, by(seed.before.due, "published").total)
  assert.equal(actual.due.reports.length, 1)
  assert.equal(actual.due.reports[0].id, due.items.find((i) => i.role === "report").id)
  for (const field of REPORT_FIELDS) assert.equal(actual.due.reports[0][field], 0, `Retained report ${field}`)
  for (const role of ["pending", "withdrawn"]) assert.deepEqual(by(actual.due, role), by(seed.before.due, role))
  assert.deepEqual(actual.control, seed.before.control, "The not-due cohort changed")
}
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
  const before = { due: await cohortSnapshot(query, due), control: await cohortSnapshot(query, control) }
  if (mode === "seed") {
    // Preflight all five updates without mutation, then each write retains its guards. Any partial seed is recorded.
    const at = Date.now()
    assertBaseline(due, before.due, at)
    assertBaseline(control, before.control, at)
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
    assertOutcome(due, control, before, seed, runs)
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
