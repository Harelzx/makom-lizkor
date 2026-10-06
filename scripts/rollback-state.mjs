// What may be running on production when a rollback is asked for (spec 14.2; adviser a51, a52, P6-ROLLBACK-1): every
// published release, and every release attempt whose release job started (it may have applied its migrations or
// deployed before it failed and stayed a draft), in the whole history and every rerun, never cut off by when a run was
// created. One state covers another only when it descends from it: its code carries the other's migrations and
// changes. rollback.yml checks the target against each state nothing covers; when the history can't be read whole, a
// release is still running, or an attempt started with no record of its commit, the rollback is refused and the owner
// decides in the dashboard (deleting a run whose record is lost, once decided, lets it through).
//   node scripts/rollback-state.mjs <target-sha>     (in rollback.yml, with GH_TOKEN and GITHUB_REPOSITORY)
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { rollbackProblems } from "./rollback-check.mjs"

/**
 * published: every published release's commit; runs: every release.yml run, each with every attempt's status, jobs
 * and record ({ sha } from its attempt artifact, or from its published release tag) or null; complete: whether the
 * history was read whole; isAncestor(a, b): a is b or an ancestor of it. Returns the states no other state covers.
 */
export function deployedStates({ published, runs, complete, isAncestor }) {
  if (!complete) throw new Error("the release history couldn't be read whole")
  const candidates = [...published]
  for (const run of runs)
    for (const a of run.attempts) {
      if (a.status !== "completed") throw new Error(`release run ${run.id}, attempt ${a.n}, is still running`)
      const job = a.jobs.find((j) => j.name === "release")
      // Never started (verify refused it): production untouched.
      if (!job || job.conclusion === "skipped" || !job.started_at) continue
      if (!a.record?.sha) throw new Error(`release run ${run.id}, attempt ${a.n}, started its release job with no record of its commit`)
      candidates.push(a.record.sha)
    }
  const unique = [...new Set(candidates)]
  if (!unique.length) throw new Error("nothing has been released: there is nothing to roll back")
  return unique.filter((s) => !unique.some((o) => o !== s && isAncestor(s, o)))
}

/** Every item of a paginated listing, and whether they add up to the total the API reports on its first page. */
export function collect(pages, key) {
  const items = pages.flatMap((p) => p[key] ?? [])
  return { items, complete: pages.length > 0 && items.length === pages[0].total_count }
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
  const [target] = process.argv.slice(2)
  if (!target) {
    console.error("usage: node scripts/rollback-state.mjs <target-sha>")
    process.exit(2)
  }
  const repo = process.env.GITHUB_REPOSITORY
  const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
  const all = (path, key) =>
    collect(JSON.parse(run("gh", ["api", "--paginate", "--slurp", `${path}${path.includes("?") ? "&" : "?"}per_page=100`])), key)
  const commitOf = (tag) => {
    try {
      return run("git", ["rev-list", "-n", "1", `refs/tags/${tag}`]).trim()
    } catch {
      return null
    }
  }
  try {
    const releases = JSON.parse(run("gh", ["release", "list", "--exclude-drafts", "--limit", "1000", "--json", "tagName"]))
    const published = releases.map((r) => commitOf(r.tagName))
    const listed = all(`repos/${repo}/actions/workflows/release.yml/runs`, "workflow_runs")
    let complete = listed.complete && releases.length < 1000 && published.every(Boolean)
    const runs = []
    for (const r of listed.items) {
      const artifacts = all(`repos/${repo}/actions/runs/${r.id}/artifacts`, "artifacts")
      complete &&= artifacts.complete
      // The run's name carries its release tag (release.yml: run-name), so a published tag stands for an expired record.
      const tag = /^release (release-[0-9-]+)$/.exec(r.display_title ?? "")?.[1]
      const attempts = []
      for (let n = 1; n <= r.run_attempt; n++) {
        const jobs = all(`repos/${repo}/actions/runs/${r.id}/attempts/${n}/jobs`, "jobs")
        complete &&= jobs.complete
        const art = artifacts.items.find((a) => a.name === `release-attempt-${tag}-${n}` && !a.expired)
        let record = null
        if (art) {
          const dir = mkdtempSync(join(tmpdir(), "attempt-"))
          run("gh", ["run", "download", String(r.id), "--name", art.name, "--dir", dir])
          record = JSON.parse(readFileSync(join(dir, "attempt.json"), "utf8"))
        } else if (tag && commitOf(tag)) record = { sha: commitOf(tag) }
        attempts.push({ n, status: n === r.run_attempt ? r.status : "completed", jobs: jobs.items, record })
      }
      runs.push({ id: r.id, attempts })
    }
    const isAncestor = (a, b) => {
      try {
        run("git", ["merge-base", "--is-ancestor", a, b])
        return true
      } catch {
        return false
      }
    }
    const states = deployedStates({ published, runs, complete, isAncestor })
    const problems = rollbackStateProblems(run("git", ["rev-parse", `${target}^{commit}`]).trim(), states)
    if (problems.length) throw new Error("\n" + problems.map((p) => `  - ${p}`).join("\n"))
    console.log(`Rollback to ${target}: allowed against ${states.join(", ")}.`)
  } catch (e) {
    console.error(`Rollback refused: ${e.message}`)
    process.exit(1)
  }
}
