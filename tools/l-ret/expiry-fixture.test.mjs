import { test } from "node:test"
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { readFileSync, readdirSync } from "node:fs"
import { expiryUpdates, validateCohorts } from "./expiry-fixture.mjs"
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
function fixture(t) {
  const db = new DatabaseSync(":memory:")
  t.after(() => db.close())
  const migrations = new URL("../../migrations/", import.meta.url)
  for (const name of readdirSync(migrations)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(new URL(name, migrations), "utf8"))
  const c = cohort()
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
  }
  const published = places[0].id
  const future = new Date(now + 100_000).toISOString()
  db.prepare("INSERT INTO contacts(id,place_id,name,created_at,ceiling_at,purge_after) VALUES ('c',?,?,?,?,?)").run(
    published,
    `[סינתטי] ${c.marker}`,
    started,
    future,
    future,
  )
  db.prepare(
    `INSERT INTO reports(id,place_id,origin,elements,requester_type,explanation,notice_version,submit_key_hash,body_hash,complete,outcome,status,received_at,ceiling_at,purge_after)
    VALUES (?,?,'contribution','[]','other',?,'test','test','test',1,'received','open',?,?,?)`,
  ).run(c.items.at(-1).id, published, `[סינתטי] ${c.marker}`, started, future, future)
  db.prepare("INSERT INTO tribute_events VALUES ('key','nonce',?,'day','device',?)").run(published, started)
  return { db, c, places, updates: expiryUpdates(c, places, now) }
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
