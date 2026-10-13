// node --test scripts/rollback-check.test.mjs
import assert from "node:assert/strict"
import { after, test } from "node:test"
import { fixtureRepo } from "./release-fixture.mjs"
import { rollbackProblems, SAFEGUARDS } from "./rollback-check.mjs"

const repos = []
after(() => repos.forEach((r) => r.remove()))
const start = () => {
  const repo = fixtureRepo()
  repos.push(repo)
  const base = repo.commit("released", {
    "migrations/0001_init.sql": "CREATE TABLE places (id TEXT PRIMARY KEY);\n",
    "worker/db/retention.ts": "export const days = 30\n",
    "worker/routes/feed.ts": "export const feed = 1\n",
    "src/config.ts": "export const RETENTION = { returnedDays: 30 }\n",
    "wrangler.jsonc": '{ "triggers": { "crons": ["*/15 * * * *"] } }\n',
  })
  return { repo, base }
}

test("allows going back across code and additive migrations", () => {
  const { repo, base } = start()
  const now = repo.commit("next", {
    "worker/routes/feed.ts": "export const feed = 2\n",
    "migrations/0002_add.sql":
      "-- DROP TABLE in a comment is not SQL\nALTER TABLE places ADD COLUMN note TEXT;\nALTER TABLE places ADD COLUMN n INTEGER NOT NULL DEFAULT 0;\nALTER TABLE places ADD kind TEXT DEFAULT 'a;b' NOT NULL; /* a comment; DROP TABLE x */\nALTER TABLE places ADD seen INTEGER DEFAULT NULL;\nCREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL);\nCREATE INDEX notes_by ON notes(body);\n",
  })
  assert.deepEqual(rollbackProblems({ cwd: repo.dir, target: base, deployed: now }), [])
})

test("refuses when today's schema would break the earlier code", () => {
  const cases = {
    "DROP TABLE places;": "drops something",
    "ALTER TABLE places DROP COLUMN id;": "drops something",
    "ALTER TABLE places RENAME TO sites;": "renames something",
    "ALTER TABLE places ADD COLUMN must TEXT NOT NULL;": "adds a required column without a default",
    // SQLite's ADD without COLUMN is the same statement (a51, P6-ROLLBACK-2).
    "ALTER TABLE places ADD required TEXT NOT NULL;": "adds a required column without a default",
    "alter table places add   required text not null;": "adds a required column without a default",
    // What the check can't read, it refuses rather than passes.
    "CREATE VIEW v AS SELECT id FROM places;": "has a statement the check doesn't recognize (CREATE VIEW v)",
    "PRAGMA foreign_keys = ON;": "has a statement the check doesn't recognize (PRAGMA foreign_keys =)",
    // A DEFAULT in a comment is no default (a52).
    "ALTER TABLE places ADD required TEXT NOT NULL /* DEFAULT omitted */;": "adds a required column without a default",
    "ALTER TABLE places ADD required TEXT NOT NULL -- DEFAULT 'x'\n;": "adds a required column without a default",
    // A constraint the earlier code's inserts may break (proved with SQLite below): refused, not passed.
    "ALTER TABLE places ADD flag INTEGER DEFAULT 0 CHECK (flag IN (1, 2));":
      "adds a column with a constraint the check can't establish as compatible",
    "ALTER TABLE places ADD code TEXT UNIQUE;": "adds a column with a constraint the check can't establish as compatible",
    "ALTER TABLE places ADD code TEXT CHECK (id IS NOT NULL AND code IN ('due', 'sent'));":
      "adds a column with a constraint the check can't establish as compatible",
    "ALTER TABLE places ADD code TEXT CHECK (code IS NOT NULL);": "adds a column with a constraint the check can't establish as compatible",
    "ALTER TABLE places ADD code TEXT CHECK (other IN ('due'));": "adds a column with a constraint the check can't establish as compatible",
    // A required column whose default is NULL, in either order: on an empty table it is added, and the earlier code's
    // insert then fails (proved with SQLite below; a53, P6-ROLLBACK-2).
    "ALTER TABLE places ADD must TEXT NOT NULL DEFAULT NULL;": "adds a required column whose default is NULL",
    "ALTER TABLE places ADD must TEXT DEFAULT NULL NOT NULL;": "adds a required column whose default is NULL",
    "CREATE TRIGGER t BEFORE INSERT ON places BEGIN SELECT 1; END;": "adds a trigger",
    "CREATE UNIQUE INDEX u ON places(id);": "adds a unique index",
  }
  for (const [sql, what] of Object.entries(cases)) {
    const { repo, base } = start()
    const now = repo.commit("contract", { "migrations/0002_change.sql": sql + "\n" })
    assert.deepEqual(
      rollbackProblems({ cwd: repo.dir, target: base, deployed: now }),
      [`migrations/0002_change.sql ${what}: the earlier code may fail on today's schema`],
      sql,
    )
  }
})

test("only a nullable new-column literal IN check is compatible, proven against actual SQLite older INSERTs", async () => {
  const { repo, base } = start()
  const sql = "ALTER TABLE places ADD COLUMN mail_state TEXT CHECK (mail_state IN ('due', 'sent'));"
  const now = repo.commit("nullable constrained metadata", { "migrations/0002_state.sql": sql })
  assert.deepEqual(rollbackProblems({ cwd: repo.dir, target: base, deployed: now }), [])
  const { DatabaseSync } = await import("node:sqlite")
  const db = new DatabaseSync(":memory:")
  db.exec("CREATE TABLE places (id TEXT PRIMARY KEY); INSERT INTO places(id) VALUES ('before');" + sql)
  db.exec("INSERT INTO places(id) VALUES ('older-code'); INSERT INTO places(id,mail_state) VALUES ('newer-code','due')")
  assert.equal(db.prepare("SELECT mail_state FROM places WHERE id = 'older-code'").get().mail_state, null)
  assert.throws(() => db.exec("INSERT INTO places(id,mail_state) VALUES ('bad','unknown')"), /CHECK/)
  db.close()
})

test("refuses when a released migration was edited", () => {
  const { repo, base } = start()
  const now = repo.commit("edit", { "migrations/0001_init.sql": "CREATE TABLE places (id TEXT PRIMARY KEY, x TEXT);\n" })
  assert.deepEqual(rollbackProblems({ cwd: repo.dir, target: base, deployed: now }), [
    "migrations/0001_init.sql: a released migration was changed or removed",
  ])
})

test("refuses to go back across a change to a deletion safeguard or the job schedule", () => {
  const { repo, base } = start()
  const now = repo.commit("safeguard", {
    "worker/db/retention.ts": "export const days = 14\n",
    "wrangler.jsonc": '{ "triggers": { "crons": ["*/5 * * * *"] } }\n',
  })
  assert.deepEqual(rollbackProblems({ cwd: repo.dir, target: base, deployed: now }), [
    "worker/db/retention.ts changed since the target: rolling back could undo a deletion safeguard",
    "wrangler.jsonc: the job schedule changed since the target",
  ])
  assert.ok(SAFEGUARDS.includes("worker/db/retention.ts") && SAFEGUARDS.includes("worker/jobs.ts"))
})

test("refuses to go back across a change to the retention policy's values, which the deletion jobs read (P6-ROLLBACK-2)", () => {
  const { repo, base } = start()
  const now = repo.commit("policy", { "src/config.ts": "export const RETENTION = { returnedDays: 14 }\n" })
  assert.deepEqual(rollbackProblems({ cwd: repo.dir, target: base, deployed: now }), [
    "src/config.ts changed since the target: rolling back could undo a deletion safeguard",
  ])
})

test("refuses a target that isn't an earlier commit of the deployed one", () => {
  const { repo, base } = start()
  const now = repo.commit("next", { "worker/routes/feed.ts": "export const feed = 2\n" })
  repo.branch("other", base)
  const sibling = repo.commit("elsewhere", { "worker/routes/feed.ts": "export const feed = 3\n" })
  assert.deepEqual(rollbackProblems({ cwd: repo.dir, target: sibling, deployed: now }), [
    "the target is not an earlier commit of the deployed one",
  ])
  assert.deepEqual(rollbackProblems({ cwd: repo.dir, target: now, deployed: now }), ["the target is the deployed commit"])
})

test("every safeguard path exists in this repository, so the list can't silently go stale", async () => {
  const { existsSync } = await import("node:fs")
  for (const path of SAFEGUARDS) assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), path)
})

test("every migration since the rule existed can be rolled back across, one at a time", async () => {
  const { readdirSync, readFileSync } = await import("node:fs")
  const dir = new URL("../migrations/", import.meta.url)
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
  // 0001–0016 came before the rule and before any release (nothing has been deployed): 0002's unique index and 0010's
  // trigger would be refused now. From 0017 on, each must leave the code before it working.
  const since = files.filter((f) => f >= "0017")
  assert.ok(since.length >= 1)
  for (const file of since) {
    const { repo, base } = start()
    const now = repo.commit(file, { [`migrations/${file}`]: readFileSync(new URL(file, dir), "utf8") })
    assert.deepEqual(rollbackProblems({ cwd: repo.dir, target: base, deployed: now }), [], file)
  }
})

test("the CHECK it refuses really does break the earlier code's insert (SQLite)", async () => {
  const { DatabaseSync } = await import("node:sqlite")
  const db = new DatabaseSync(":memory:")
  db.exec("CREATE TABLE places (id TEXT PRIMARY KEY)")
  db.exec("ALTER TABLE places ADD flag INTEGER DEFAULT 0 CHECK (flag IN (1, 2))")
  // The earlier code knows nothing of flag: its insert takes the default, which the CHECK refuses.
  assert.throws(() => db.exec("INSERT INTO places (id) VALUES ('a')"), /CHECK constraint failed/)
})

test("a required column whose default is NULL is added to an empty table, then breaks the earlier code's insert (SQLite)", async () => {
  const { DatabaseSync } = await import("node:sqlite")
  for (const add of ["ADD must TEXT NOT NULL DEFAULT NULL", "ADD must TEXT DEFAULT NULL NOT NULL"]) {
    const db = new DatabaseSync(":memory:")
    db.exec("CREATE TABLE places (id TEXT PRIMARY KEY)")
    db.exec(`ALTER TABLE places ${add}`)
    assert.throws(() => db.exec("INSERT INTO places (id) VALUES ('a')"), /NOT NULL constraint failed/, add)
  }
  // Nullable with DEFAULT NULL, or required with a value for its default: the earlier insert still works.
  const db = new DatabaseSync(":memory:")
  db.exec("CREATE TABLE places (id TEXT PRIMARY KEY)")
  db.exec("ALTER TABLE places ADD seen INTEGER DEFAULT NULL")
  db.exec("ALTER TABLE places ADD n INTEGER NOT NULL DEFAULT 0")
  db.exec("INSERT INTO places (id) VALUES ('a')")
})
