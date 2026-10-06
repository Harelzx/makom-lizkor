// What may be running on production when a rollback is asked for (spec 14.2; adviser a51, P6-ROLLBACK-1). The newest
// published release, and every release attempt since whose release job started: it may have applied its migrations or
// deployed before it failed, and stayed a draft. rollback.yml checks the target against each of them; when they can't
// be known (a release still running, or one that started with no record of its commit), the rollback is refused and
// the owner decides in the dashboard.
//   node scripts/rollback-state.mjs <target-sha>     (in rollback.yml, with GH_TOKEN and GITHUB_REPOSITORY)
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { rollbackProblems } from "./rollback-check.mjs"

/**
 * published: the newest published release ({ tag, sha, at }) or null; runs: release.yml's runs, each with its jobs
 * and the attempt record its release job uploaded ({ sha }) or null. Returns the commits production may be running.
 */
export function deployedStates({ published, runs }) {
  const since = runs.filter((r) => !published || r.created_at > published.at)
  const states = published ? [published.sha] : []
  for (const r of since.sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    if (r.status !== "completed") throw new Error(`release run ${r.id} is still running: what production holds isn't known yet`)
    const job = r.jobs.find((j) => j.name === "release")
    // Never started (verify refused it): production untouched.
    if (!job || job.conclusion === "skipped" || !job.started_at) continue
    if (!r.attempt?.sha) throw new Error(`release run ${r.id} started its release job with no record of the commit it was releasing`)
    if (!states.includes(r.attempt.sha)) states.push(r.attempt.sha)
  }
  if (!states.length) throw new Error("nothing has been released: there is nothing to roll back")
  return states
}

/**
 * The rollback to `target` checked against each state production may hold: the target itself is skipped (going back
 * to the published release after a failed attempt is the usual case), and every other state must allow it.
 */
export function rollbackStateProblems(target, states, check = (t, d) => rollbackProblems({ target: t, deployed: d })) {
  const others = states.filter((s) => s !== target)
  if (!others.length) return ["the target is what production already runs"]
  return others.flatMap((deployed) => check(target, deployed).map((p) => `against ${deployed.slice(0, 12)}: ${p}`))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = process.env.GITHUB_REPOSITORY
  const gh = (...args) => JSON.parse(execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }))
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim()
  const [target] = process.argv.slice(2)
  if (!target) {
    console.error("usage: node scripts/rollback-state.mjs <target-sha>")
    process.exit(2)
  }
  try {
    const [latest] = gh("release", "list", "--exclude-drafts", "--limit", "1", "--json", "tagName,publishedAt")
    const published = latest ? { tag: latest.tagName, sha: git("rev-list", "-n", "1", latest.tagName), at: latest.publishedAt } : null
    const runs = gh("api", `repos/${repo}/actions/workflows/release.yml/runs?per_page=100`).workflow_runs.filter(
      (r) => !published || r.created_at > published.at,
    )
    for (const r of runs) {
      r.jobs = gh("api", `repos/${repo}/actions/runs/${r.id}/jobs`).jobs
      const art = gh("api", `repos/${repo}/actions/runs/${r.id}/artifacts`).artifacts.find(
        (a) => a.name.startsWith("release-attempt-") && !a.expired,
      )
      r.attempt = null
      if (art) {
        const dir = mkdtempSync(join(tmpdir(), "attempt-"))
        execFileSync("gh", ["run", "download", String(r.id), "--name", art.name, "--dir", dir])
        r.attempt = JSON.parse(readFileSync(join(dir, "attempt.json"), "utf8"))
      }
    }
    const states = deployedStates({ published, runs })
    const problems = rollbackStateProblems(git("rev-parse", `${target}^{commit}`), states)
    if (problems.length) throw new Error("\n" + problems.map((p) => `  - ${p}`).join("\n"))
    console.log(`Rollback to ${target}: allowed against ${states.join(", ")}.`)
  } catch (e) {
    console.error(`Rollback refused: ${e.message}`)
    process.exit(1)
  }
}
