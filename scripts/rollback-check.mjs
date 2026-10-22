// Whether rolling the Worker's code back from the deployed commit to an earlier one is safe (spec 14.2, adviser a49):
// the old code must still work on today's schema, and the rollback must not take back a deletion safeguard. Only the
// code goes back: a rollback never restores data (rollback.yml runs no Time Travel, no migration, no bucket command).
// A refusal means fix forward, or a separately authorized recovery decision.
//   node scripts/rollback-check.mjs <target-sha> <deployed-sha>
import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })

/** SQL the code before it can't live with, statement by statement: removed or renamed objects, or a new trigger or
 * unique index that may refuse what it writes. A column added is judged by its own grammar below. */
const INCOMPATIBLE = [
  [/^DROP\b|^ALTER TABLE \S+ DROP\b/i, "drops something"],
  [/^ALTER TABLE \S+ RENAME\b/i, "renames something"],
  [/^CREATE TRIGGER\b/i, "adds a trigger"],
  [/^CREATE UNIQUE INDEX\b/i, "adds a unique index"],
]
/** What the check knows to be compatible; any other statement is refused, not passed (a51). */
const KNOWN = [/^CREATE TABLE\b/i, /^CREATE INDEX\b/i, /^INSERT\b/i, /^UPDATE\b/i]

/**
 * The SQL as tokens can be read: comments removed (-- and /* *\/), each string literal masked as '?' (so a ; or a
 * keyword inside one is not SQL), a trigger's body kept inside its statement, then split into statements with spacing
 * even. Read without regard to case.
 */
function statements(sql) {
  let out = ""
  for (let i = 0; i < sql.length;) {
    if (sql.startsWith("--", i)) i = sql.indexOf("\n", i) < 0 ? sql.length : sql.indexOf("\n", i)
    else if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2)
      i = end < 0 ? sql.length : end + 2
      out += " "
    } else if (sql[i] === "'") {
      // To the closing quote; two quotes in a row are one quote inside the literal.
      let j = i + 1
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1
      out += "'?'"
      i = j + 1
    } else out += sql[i++]
  }
  return out
    .replace(/\bBEGIN\b[\s\S]*?\bEND\b/gi, "BEGIN END")
    .split(";")
    .map((st) => st.replace(/\s+/g, " ").trim())
    .filter(Boolean)
}

/**
 * A column added, by the only grammar the check accepts (a52): ALTER TABLE t ADD [COLUMN] c [type], then nothing, a
 * DEFAULT of a plain literal, or NOT NULL with a DEFAULT that is a value. A required column whose default is NULL is
 * added to an empty table, and the earlier code's insert then fails (a53). The nullable literal-enum CHECK below is
 * separately established as compatible. Other CHECK expressions, UNIQUE, REFERENCES,
 * COLLATE, a generated column, is refused: its compatibility with the earlier code's inserts isn't established.
 */
function addColumnProblem(st) {
  // A narrowly established nullable constraint: the earlier INSERT omits this new column, so it is NULL;
  // SQLite's CHECK(column IN(literals)) evaluates to NULL and passes. No DEFAULT, NOT NULL, other-column
  // reference, expression or extra constraint is accepted. Unknown grammar still fails closed below.
  if (
    /^ALTER TABLE [a-z_]\w* ADD (?:COLUMN )?([a-z_]\w*) (?:TEXT|INTEGER|REAL|BLOB|NUMERIC) CHECK \(\1 IN \('\?'(?:, ?'\?')*\)\)$/i.test(st)
  )
    return ""
  const m = /^ALTER TABLE \S+ ADD (?:COLUMN )?\S+(?: (?:TEXT|INTEGER|REAL|BLOB|NUMERIC))?(?: (.*))?$/i.exec(st)
  if (!m) return null
  const rest = (m[1] ?? "").trim()
  const VALUE = "(?:-?\\d+(?:\\.\\d+)?|'\\?')"
  if (!rest || new RegExp(`^(?:DEFAULT (?:${VALUE}|NULL)|DEFAULT ${VALUE} NOT NULL|NOT NULL DEFAULT ${VALUE})$`, "i").test(rest)) return ""
  if (/^NOT NULL$/i.test(rest)) return "adds a required column without a default"
  if (/^(?:NOT NULL DEFAULT NULL|DEFAULT NULL NOT NULL)$/i.test(rest)) return "adds a required column whose default is NULL"
  return "adds a column with a constraint the check can't establish as compatible"
}

function sqlProblems(sql) {
  const found = new Set()
  for (const st of statements(sql)) {
    const added = addColumnProblem(st)
    if (added !== null) {
      if (added) found.add(added)
      continue
    }
    const hit = INCOMPATIBLE.filter(([pattern]) => pattern.test(st))
    for (const [, what] of hit) found.add(what)
    if (!hit.length && !KNOWN.some((k) => k.test(st)))
      found.add(`has a statement the check doesn't recognize (${st.split(" ").slice(0, 3).join(" ")})`)
  }
  return [...found]
}

/** The code that deletes on schedule, purges on takedown, or keeps a restore from bringing back what was deleted:
 * rolling back across a change to it could undo a deletion fix. */
export const SAFEGUARDS = [
  "worker/db/retention.ts",
  "worker/db/exports.ts",
  "worker/db/photos.ts",
  "worker/db/ops.ts",
  "worker/db/import.ts",
  "worker/db/replay.ts",
  "worker/db/reconcile.ts",
  "worker/db/restore.ts",
  "worker/jobs.ts",
  "worker/lib/purge.ts",
  // The retention policy's values: the deletion job, the export audit and the import filter read their deadlines here.
  "src/config.ts",
]
const crons = (cwd, rev) => {
  try {
    return (git(cwd, ["show", `${rev}:wrangler.jsonc`]).match(/"crons"\s*:\s*\[[^\]]*\]/) ?? [""])[0]
  } catch {
    return ""
  }
}

/**
 * The migrations `to` adds over `from`, as the code at `from` would meet them: each must be new (a released migration
 * is never edited or removed) and expand-only by the grammar above. The pull-request and release gates
 * (scripts/migration-check.mjs, scripts/release/release.mjs) and the rollback check all read this one list.
 */
export function migrationProblems({ cwd = process.cwd(), from, to }) {
  const problems = []
  for (const line of git(cwd, ["diff", "--name-status", "--no-renames", from, to, "--", "migrations"]).split("\n").filter(Boolean)) {
    const [status, file] = line.split("\t")
    if (status !== "A") {
      problems.push(`${file}: a released migration was changed or removed`)
      continue
    }
    for (const what of sqlProblems(git(cwd, ["show", `${to}:${file}`])))
      problems.push(`${file} ${what}: the earlier code may fail on today's schema`)
  }
  return problems
}

export function rollbackProblems({ cwd = process.cwd(), target, deployed }) {
  const t = git(cwd, ["rev-parse", `${target}^{commit}`]).trim()
  const d = git(cwd, ["rev-parse", `${deployed}^{commit}`]).trim()
  if (t === d) return ["the target is the deployed commit"]
  try {
    git(cwd, ["merge-base", "--is-ancestor", t, d])
  } catch {
    return ["the target is not an earlier commit of the deployed one"]
  }
  const problems = migrationProblems({ cwd, from: t, to: d })
  const touched = git(cwd, ["diff", "--name-only", t, d, "--", ...SAFEGUARDS])
    .split("\n")
    .filter(Boolean)
  for (const file of touched) problems.push(`${file} changed since the target: rolling back could undo a deletion safeguard`)
  if (crons(cwd, t) !== crons(cwd, d)) problems.push("wrangler.jsonc: the job schedule changed since the target")
  return problems
}

/**
 * Against a release older than the target, whose migrations the database has been through: each must still be in the
 * target as it was applied, or the target's code was written for a schema the database never had (a53).
 */
export function appliedMigrationProblems({ cwd = process.cwd(), target, earlier }) {
  return git(cwd, ["diff", "--name-status", "--no-renames", earlier, target, "--", "migrations"])
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"))
    .filter(([status]) => status !== "A")
    .map(([, file]) => `${file}: applied by that release, changed or removed in the target`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [target, deployed] = process.argv.slice(2)
  if (!target || !deployed) {
    console.error("usage: node scripts/rollback-check.mjs <target-sha> <deployed-sha>")
    process.exit(2)
  }
  const problems = rollbackProblems({ target, deployed })
  if (problems.length) {
    console.error("Rollback refused:\n" + problems.map((p) => `  - ${p}`).join("\n"))
    process.exit(1)
  }
  console.log(`Rollback from ${deployed} to ${target}: the schema and the deletion safeguards allow it.`)
}
