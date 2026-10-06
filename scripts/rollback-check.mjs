// Whether rolling the Worker's code back from the deployed commit to an earlier one is safe (spec 14.2, adviser a49):
// the old code must still work on today's schema, and the rollback must not take back a deletion safeguard. Only the
// code goes back: a rollback never restores data (rollback.yml runs no Time Travel, no migration, no bucket command).
// A refusal means fix forward, or the owner decides in the dashboard.
//   node scripts/rollback-check.mjs <target-sha> <deployed-sha>
import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })

/** SQL the code before it can't live with: removed or renamed objects, a required column it doesn't write, or a new
 * trigger or unique index that may refuse what it writes. */
const INCOMPATIBLE = [
  [/\bDROP\s+(TABLE|COLUMN|INDEX|TRIGGER|VIEW)\b/i, "drops something"],
  [/\bRENAME\b/i, "renames something"],
  [/\bADD\s+COLUMN\b[^;]*\bNOT\s+NULL\b(?![^;]*\bDEFAULT\b)/i, "adds a required column without a default"],
  [/\bCREATE\s+TRIGGER\b/i, "adds a trigger"],
  [/\bCREATE\s+UNIQUE\s+INDEX\b/i, "adds a unique index"],
]

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
]
const crons = (cwd, rev) => {
  try {
    return (git(cwd, ["show", `${rev}:wrangler.jsonc`]).match(/"crons"\s*:\s*\[[^\]]*\]/) ?? [""])[0]
  } catch {
    return ""
  }
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
  const problems = []
  for (const line of git(cwd, ["diff", "--name-status", "--no-renames", t, d, "--", "migrations"]).split("\n").filter(Boolean)) {
    const [status, file] = line.split("\t")
    if (status !== "A") {
      problems.push(`${file}: a released migration was changed or removed`)
      continue
    }
    const sql = git(cwd, ["show", `${d}:${file}`]).replace(/--.*$/gm, "")
    for (const [pattern, what] of INCOMPATIBLE)
      if (pattern.test(sql)) problems.push(`${file} ${what}: the earlier code may fail on today's schema`)
  }
  const touched = git(cwd, ["diff", "--name-only", t, d, "--", ...SAFEGUARDS])
    .split("\n")
    .filter(Boolean)
  for (const file of touched) problems.push(`${file} changed since the target: rolling back could undo a deletion safeguard`)
  if (crons(cwd, t) !== crons(cwd, d)) problems.push("wrangler.jsonc: the job schedule changed since the target")
  return problems
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
