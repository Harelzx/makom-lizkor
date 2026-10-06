// node --test scripts/release-manifest.test.mjs
import assert from "node:assert/strict"
import { after, test } from "node:test"
import { manifest, manifestHash, OPS_SCHEMA, opsFieldsAdded, render } from "./release-manifest.mjs"
import { fixtureRepo } from "./release-fixture.mjs"

const repo = fixtureRepo()
after(() => repo.remove())

const schema = (properties) => JSON.stringify({ type: "object", properties, additionalProperties: false })
const COUNT = { type: "integer", minimum: 0 }
const first = repo.commit("first release", {
  "worker/index.ts": 'fetch("https://challenges.cloudflare.com/turnstile")\n',
  "migrations/0001_init.sql": "CREATE TABLE places (id TEXT PRIMARY KEY);\n",
  [OPS_SCHEMA]: schema({ places: COUNT }),
  "src/data/places.json": '{"source":"https://news.example/a"}\n',
  "README.md": "x\n",
})
const second = repo.commit("second release", {
  "worker/db/places.ts": "export const x = 1\n",
  "worker/lib/send.ts": 'fetch("https://collector.example.net/in")\n',
  "worker/test/x.test.ts": 'fetch("https://test-only.example")\n',
  "src/data/places.json": '{"source":"https://other-news.example/b"}\n',
  "migrations/0002_more.sql": "-- why\nALTER TABLE places ADD COLUMN note TEXT;\n",
  ".github/workflows/ci.yml": "on: push\n",
  "package.json": "{}\n",
  "patches/x.patch": "diff\n",
  ".claude/settings.json": "{}\n",
  "wrangler.jsonc": "{}\n",
  [OPS_SCHEMA]: schema({
    places: COUNT,
    seen_at: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$" },
    last_note: { anyOf: [{ type: "string" }, { type: "null" }] },
  }),
  "README.md": "y\n",
})

test("names the commit range, every file changed, and the new migration's SQL as it will run", () => {
  const m = manifest({ cwd: repo.dir, to: second, from: first })
  assert.equal(m.to, second)
  assert.equal(m.from, first)
  assert.deepEqual(
    m.commits.map((c) => c.slice(41)),
    ["second release"],
  )
  assert.ok(m.files.some((f) => f.path === "README.md" && f.status === "M"))
  assert.deepEqual(m.migrations, [
    { file: "migrations/0002_more.sql", status: "A", sql: "-- why\nALTER TABLE places ADD COLUMN note TEXT;\n" },
  ])
})

test("flags each risk the owner must read, by its own name", () => {
  const risks = Object.fromEntries(manifest({ cwd: repo.dir, to: second, from: first }).risks.map((r) => [r.flag, r]))
  assert.deepEqual(Object.keys(risks).sort(), [
    "agent_settings",
    "data_access",
    "dependencies",
    "github",
    "new_hosts",
    "ops_output",
    "platform_config",
  ])
  assert.deepEqual(risks.dependencies.files, ["package.json", "patches/x.patch"])
  // A host in the code is flagged; one in the curated data or in a test is not.
  assert.deepEqual(risks.new_hosts.files, ["https://collector.example.net"])
})

test("says when a field added to what the diagnostic agent sees may hold text or an id (the privacy review rule)", () => {
  const ops = manifest({ cwd: repo.dir, to: second, from: first }).risks.find((r) => r.flag === "ops_output")
  assert.equal(ops.privacy_review, true)
  assert.deepEqual(ops.fields, [
    { path: "seen_at", kind: "date" },
    { path: "last_note", kind: "text_or_id" },
  ])
  assert.match(render(manifest({ cwd: repo.dir, to: second, from: first })), /privacy session's review is required before merge/)
  // Counts, flags, dates and codes don't need it, nor a record keyed by codes; a record keyed by anything does.
  const code = { type: "string", pattern: "^[a-z][a-z0-9_]{0,47}$" }
  const fine = opsFieldsAdded(
    schema({}),
    schema({
      n: COUNT,
      ok: { type: ["boolean", "null"] },
      kind: { enum: ["a", "b"] },
      failure: code,
      by: { type: "object", propertyNames: code, additionalProperties: COUNT },
    }),
  )
  assert.ok(
    fine.every((f) => f.kind !== "text_or_id"),
    JSON.stringify(fine),
  )
  const keyed = opsFieldsAdded(schema({}), schema({ by: { type: "object", additionalProperties: COUNT } }))
  assert.deepEqual(keyed, [
    { path: "by.*", kind: "count" },
    { path: "by.<key>", kind: "text_or_id" },
  ])
  // A union whose branches disagree is the wider kind, whichever comes first.
  assert.deepEqual(opsFieldsAdded(schema({}), schema({ f: { anyOf: [{ type: "string" }, code] } })), [{ path: "f", kind: "text_or_id" }])
  // A field that widens from a code to free text is flagged too.
  assert.deepEqual(opsFieldsAdded(schema({ failure: code }), schema({ failure: { type: "string" } })), [
    { path: "failure", kind: "text_or_id" },
  ])
})

test("flags a released migration that was edited", () => {
  const third = repo.commit("edit", { "migrations/0001_init.sql": "CREATE TABLE places (id TEXT PRIMARY KEY, x TEXT);\n" })
  const m = manifest({ cwd: repo.dir, to: third, from: second })
  assert.deepEqual(m.risks.find((r) => r.flag === "migration_edited")?.files, ["migrations/0001_init.sql"])
})

test("is the same for the same commits, so release.yml can compare its hash", () => {
  const a = manifest({ cwd: repo.dir, to: second, from: first })
  const b = manifest({ cwd: repo.dir, to: second, from: first })
  assert.equal(manifestHash(a), manifestHash(b))
  assert.notEqual(manifestHash(a), manifestHash(manifest({ cwd: repo.dir, to: first })))
})

test("a first release lists every file as added", () => {
  const m = manifest({ cwd: repo.dir, to: first })
  assert.equal(m.from, null)
  assert.ok(m.files.every((f) => f.status === "A"))
  assert.equal(m.migrations.length, 1)
})
