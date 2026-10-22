// Refuses a migration the code before it can't live with, before it is merged (CI's static job) and again before it
// is released (scripts/release/release.mjs): a released migration edited or removed, or a new one that drops, renames,
// or adds a trigger, a unique index or a column the earlier code's inserts would fail on (rollback-check.mjs's grammar).
// Production runs the migration first and the new code after, and a rollback takes back only the code, so every
// migration must leave a schema both versions work on. A change that has to contract the schema is split in two:
// stop using the thing in one release, remove it in a later one, with the owner's decision.
//   node scripts/migration-check.mjs [base]   base: the pull request's target, else the commit's first parent
import { execFileSync } from "node:child_process"
import { migrationProblems } from "./rollback-check.mjs"

const git = (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
const base = process.argv[2] ?? (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "HEAD^1")
const from = git(["merge-base", base, "HEAD"])
const problems = migrationProblems({ from, to: git(["rev-parse", "HEAD"]) })
if (problems.length) {
  console.error("Migration refused (expand-only; see scripts/migration-check.mjs):\n" + problems.map((p) => `  - ${p}`).join("\n"))
  process.exit(1)
}
console.log(`Migrations since ${from.slice(0, 7)}: expand-only.`)
