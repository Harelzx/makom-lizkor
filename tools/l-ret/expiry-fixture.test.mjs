import { test } from "node:test"
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { readFileSync, readdirSync } from "node:fs"
import {
  expiryUpdates,
  validateCohorts,
  cohortSnapshot,
  assertBaseline,
  assertOutcome,
  ERASE_FIELDS,
  REPORT_FIELDS,
} from "./expiry-fixture.mjs"
import { STAGING_ORIGIN } from "./guards.mjs"

const now = Date.parse("2026-10-08T15:00:00.000Z")
const started = new Date(now - 10_000).toISOString()
function cohort(offset = 0) {
  return {
    marker: offset ? "A2-12345678" : "A2-abcdef01",
    started,
    base: STAGING_ORIGIN,
    expectTag: "staging-d998079a2ab3",
    items: ["published", "returned", "rejected", "pending", "withdrawn", "report"].map((role, i) => ({
      role,
      id: `${role === "report" ? "r" : "p"}_${String(offset + i + 1).padStart(26, "0")}`,
    })),
  }
}
function fixture(t, offset = 0) {
  const db = new DatabaseSync(":memory:")
  t.after(() => db.close())
  const migrations = new URL("../../migrations/", import.meta.url)
  for (const name of readdirSync(migrations)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(new URL(name, migrations), "utf8"))
  const c = cohort(offset)
  const future = new Date(now + 100_000).toISOString()
  const places = c.items.filter((i) => i.role !== "report").map((i) => ({ id: i.id, status: i.role, rev: 2 }))
  for (const p of places) {
    db.prepare("INSERT INTO places(id,origin,status,rev,created_at,status_changed_at) VALUES (?,'contribution',?,2,?,?)").run(
      p.id,
      p.status,
      started,
      started,
    )
    const state = p.status === "published" ? "approved" : p.status
    db.prepare("INSERT INTO revisions(id,place_id,n,state,name_he,created_at) VALUES (?,?,1,?,?,?)").run(
      `v_${p.id}`,
      p.id,
      state,
      `[סינתטי] ${c.marker}`,
      started,
    )
    if (p.status === "withdrawn") db.prepare("UPDATE revisions SET name_he=NULL WHERE place_id=?").run(p.id)
    else {
      db.prepare("UPDATE revisions SET lat=31.4,lng=34.4 WHERE place_id=?").run(p.id)
      db.prepare("INSERT INTO contacts(id,place_id,name,created_at,ceiling_at,purge_after) VALUES (?,?,?,?,?,?)").run(
        `c_${p.id}`,
        p.id,
        `[סינתטי] ${c.marker}`,
        started,
        future,
        future,
      )
    }
    if (["returned", "rejected"].includes(p.status)) db.prepare("UPDATE revisions SET decision_note='synthetic' WHERE place_id=?").run(p.id)
  }
  const published = places[0].id
  db.prepare(
    `INSERT INTO reports(id,place_id,origin,elements,requester_type,explanation,notice_version,submit_key_hash,body_hash,complete,outcome,status,received_at,ceiling_at,purge_after)
    VALUES (?,?,'contribution','[]','other',?,'test','test','test',1,'received','open',?,?,?)`,
  ).run(c.items.at(-1).id, published, `[סינתטי] ${c.marker}`, started, future, future)
  db.exec("UPDATE reports SET reporter_key='synthetic', explanation_hash='synthetic'")
  db.prepare("INSERT INTO tribute_events VALUES ('key','nonce',?,'day','device',?)").run(published, started)
  db.prepare("INSERT INTO tribute_totals VALUES (?,1)").run(published)
  const snapshot = () => cohortSnapshot(async (sql, params) => ({ results: db.prepare(sql).all(...params) }), c)
  return { db, c, places, snapshot, updates: expiryUpdates(c, places, now) }
}
test("requires two fresh, different, disjoint cohorts on the exact staging deployment", () => {
  validateCohorts(cohort(), cohort(20), now)
  for (const mutate of [
    (c) => {
      c.marker = "A2-abcdef01"
    },
    (c) => {
      c.started = new Date(now - 3_600_001).toISOString()
    },
    (c) => {
      c.started = new Date(now + 1).toISOString()
    },
    (c) => {
      c.base = "https://example.com"
    },
    (c) => {
      c.expectTag = "staging-000000000000"
    },
    (c) => {
      c.items[0].id = cohort().items[0].id
    },
    (c) => {
      c.items.pop()
    },
  ]) {
    const control = cohort(20)
    mutate(control)
    assert.throws(() => validateCohorts(cohort(), control, now))
  }
})
test("real schema: exactly five deadline changes, no content or unrelated records changed", (t) => {
  const { db, updates } = fixture(t)
  const before = db.prepare("SELECT * FROM revisions").all()
  for (const u of updates) assert.equal(db.prepare(u.sql).run(...u.params).changes, 1, u.kind)
  assert.deepEqual(db.prepare("SELECT * FROM revisions").all(), before)
  assert.equal(db.prepare("SELECT count(*) AS n FROM places WHERE status_changed_at < ?").get(started).n, 2)
})
for (const variant of ["revision", "state", "unmarked", "foreign-marker", "old-created"]) {
  test(`refuses a changed ${variant} instead of aging another person's data`, (t) => {
    const { db, updates, places } = fixture(t)
    const id = places[1].id
    if (variant === "revision") db.prepare("UPDATE places SET rev=3 WHERE id=?").run(id)
    if (variant === "state") db.prepare("UPDATE places SET status='published' WHERE id=?").run(id)
    if (variant === "old-created") db.prepare("UPDATE places SET created_at='2000-01-01' WHERE id=?").run(id)
    if (variant === "unmarked") db.prepare("UPDATE revisions SET name_he='real' WHERE place_id=?").run(id)
    if (variant === "foreign-marker") db.prepare("UPDATE revisions SET name_he='[סינתטי] A2-11111111' WHERE place_id=?").run(id)
    assert.equal(db.prepare(updates[0].sql).run(...updates[0].params).changes, 0)
  })
}
test("an unmarked additional revision makes the whole place ineligible", (t) => {
  const { db, updates, places } = fixture(t)
  db.prepare("INSERT INTO revisions(id,place_id,n,state,name_he,created_at) VALUES ('extra',?,2,'pending','real',?)").run(
    places[1].id,
    started,
  )
  assert.equal(db.prepare(updates[0].sql).run(...updates[0].params).changes, 0)
})
for (const change of [
  "missing-place",
  "missing-report",
  "missing-contact",
  "missing-tribute",
  "blank-name",
  "blank-note",
  "blank-report-code",
  "due-contact",
  "due-place",
  "due-report",
  "due-tribute",
]) {
  test(`baseline rejects ${change} through real snapshot SQL`, async (t) => {
    const { db, c, places, snapshot } = fixture(t)
    assertBaseline(c, await snapshot(), now)
    if (change === "missing-place") c.items[3].id = `p_${"9".repeat(26)}`
    if (change === "missing-report") db.exec("DELETE FROM reports")
    if (change === "missing-contact") db.prepare("DELETE FROM contacts WHERE place_id=?").run(places[0].id)
    if (change === "missing-tribute") db.exec("DELETE FROM tribute_events")
    if (change === "blank-name") db.prepare("UPDATE revisions SET name_he=NULL WHERE place_id=?").run(places[3].id)
    if (change === "blank-note") db.prepare("UPDATE revisions SET decision_note=NULL WHERE place_id=?").run(places[1].id)
    if (change === "blank-report-code") db.exec("UPDATE reports SET reporter_key=NULL")
    if (change === "due-contact") db.exec("UPDATE contacts SET purge_after='2000-01-01'")
    if (change === "due-place") db.prepare("UPDATE places SET status_changed_at='2000-01-01' WHERE id=?").run(places[1].id)
    if (change === "due-report") db.exec("UPDATE reports SET purge_after='2000-01-01'")
    if (change === "due-tribute") db.exec("UPDATE tribute_events SET received_at='2000-01-01'")
    const s = await snapshot()
    assert.throws(() => assertBaseline(c, s, now))
  })
}
test("actual result oracle passes complete deletion; rejects retained notes, coordinates and every report field", async (t) => {
  const due = fixture(t),
    control = fixture(t, 20)
  const seed = {
    status: "awaiting_real_cron",
    at: new Date(now).toISOString(),
    due: due.c,
    control: control.c,
    before: { due: await due.snapshot(), control: await control.snapshot() },
  }
  const runs = [
    {
      ok: 1,
      started_at: new Date(now + 1000).toISOString(),
      finished_at: new Date(now + 2000).toISOString(),
      counts: JSON.stringify({ erased: 2, contacts: 1, reports: 1, tributes: 1 }),
    },
  ]
  for (const p of due.places.filter((p) => ["returned", "rejected"].includes(p.status))) {
    due.db.prepare("UPDATE places SET status='erased',erased_reason=? WHERE id=?").run(`${p.status}_expired`, p.id)
    due.db.prepare(`UPDATE revisions SET ${ERASE_FIELDS.map((f) => `${f}=NULL`).join(",")} WHERE place_id=?`).run(p.id)
    due.db.prepare("DELETE FROM contacts WHERE place_id=?").run(p.id)
  }
  due.db.prepare("DELETE FROM contacts WHERE place_id=?").run(due.places[0].id)
  due.db.exec("DELETE FROM tribute_events")
  due.db.exec(`UPDATE reports SET ${REPORT_FIELDS.map((f) => `${f}=NULL`).join(",")}`)
  const actual = async () => ({ due: await due.snapshot(), control: await control.snapshot() })
  assertOutcome(due.c, control.c, await actual(), seed, runs)
  for (const field of ["decision_note", "lat", "lng", "story_he", "photo_key"]) {
    due.db
      .prepare(`UPDATE revisions SET ${field}=? WHERE place_id=?`)
      .run(field === "lat" || field === "lng" ? 31 : "synthetic", due.places[1].id)
    const snapshot = await actual()
    assert.throws(() => assertOutcome(due.c, control.c, snapshot, seed, runs), field)
    due.db.prepare(`UPDATE revisions SET ${field}=NULL WHERE place_id=?`).run(due.places[1].id)
  }
  for (const field of REPORT_FIELDS) {
    due.db.exec(`UPDATE reports SET ${field}='synthetic'`)
    const snapshot = await actual()
    assert.throws(() => assertOutcome(due.c, control.c, snapshot, seed, runs), field)
    due.db.exec(`UPDATE reports SET ${field}=NULL`)
  }
  const partial = { ...seed, status: "seeding" }
  const snapshot = await actual()
  assert.throws(() => assertOutcome(due.c, control.c, snapshot, partial, runs))
  control.db.exec("DELETE FROM contacts")
  const changed = await actual()
  assert.throws(() => assertOutcome(due.c, control.c, changed, seed, runs))
  const deficient = structuredClone(seed)
  deficient.before.control.contacts = []
  deficient.before.control.places[0].contacts = 0
  assert.throws(() => assertOutcome(due.c, control.c, changed, deficient, runs))
})
