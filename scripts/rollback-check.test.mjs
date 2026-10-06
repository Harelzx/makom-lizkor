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
    "wrangler.jsonc": '{ "triggers": { "crons": ["*/15 * * * *"] } }\n',
  })
  return { repo, base }
}

test("allows going back across code and additive migrations", () => {
  const { repo, base } = start()
  const now = repo.commit("next", {
    "worker/routes/feed.ts": "export const feed = 2\n",
    "migrations/0002_add.sql":
      "-- DROP TABLE in a comment is not SQL\nALTER TABLE places ADD COLUMN note TEXT;\nALTER TABLE places ADD COLUMN n INTEGER NOT NULL DEFAULT 0;\nCREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL);\nCREATE INDEX notes_by ON notes(body);\n",
  })
  assert.deepEqual(rollbackProblems({ cwd: repo.dir, target: base, deployed: now }), [])
})

test("refuses when today's schema would break the earlier code", () => {
  const cases = {
    "DROP TABLE places;": "drops something",
    "ALTER TABLE places DROP COLUMN id;": "drops something",
    "ALTER TABLE places RENAME TO sites;": "renames something",
    "ALTER TABLE places ADD COLUMN must TEXT NOT NULL;": "adds a required column without a default",
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
