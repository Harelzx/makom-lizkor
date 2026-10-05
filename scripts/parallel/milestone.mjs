// scripts/milestone "<text>": tell the other sessions what this one finished, in words richer than a commit subject.
import { checkout, git } from "./lib.mjs"
import { append, topPaths } from "./milestones.mjs"

const summary = process.argv.slice(2).join(" ").trim()
if (!summary) {
  console.error('usage: scripts/milestone "<what changed and who it affects>"')
  process.exit(64)
}
const co = checkout(import.meta.dirname) // the checkout this script lives in, whatever the cwd
const tryGit = (args) => {
  try {
    return git(args, co.root)
  } catch {
    return ""
  }
}
const branch = tryGit(["rev-parse", "--abbrev-ref", "HEAD"]) || "?"
// What this branch changed against main, committed or not.
const names = [...tryGit(["diff", "--name-only", "main...HEAD"]).split("\n"), ...tryGit(["diff", "--name-only", "HEAD"]).split("\n")]
append(co, { kind: "milestone", branch, summary, paths: topPaths(names), worktree: co.root })
console.log(`milestone logged for ${branch}: ${summary}`)
