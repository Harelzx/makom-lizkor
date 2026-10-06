// What may have touched production when a rollback is asked for (spec 14.2; adviser a51, a52, a53, P6-ROLLBACK-1):
// every published release, and every release attempt whose release job started (it may have applied its migrations
// or deployed before it failed and stayed a draft), in the whole history and every rerun, never cut off by when a run
// was created. None is set aside because a later one descends from it: a descendant may have taken an applied
// migration out or undone a safeguard change, and its own diff would no longer show what the database and the jobs
// went through. rollback.yml checks the target against each. When the history can't be read whole, a release is still
// running, or an attempt started with no record of its own commit (a release tag says what was published under that
// name, not what an attempt ran), the rollback is refused: fix forward, or a separately authorized recovery decision.
// Records are kept as long as a private repository allows (400 days), so past that every rollback is refused.
//   node scripts/rollback-state.mjs <target-sha>     (in rollback.yml, with GH_TOKEN and GITHUB_REPOSITORY)
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { appliedMigrationProblems, rollbackProblems } from "./rollback-check.mjs"

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
const isAncestor = (cwd, a, b) => {
  try {
    git(cwd, ["merge-base", "--is-ancestor", a, b])
    return true
  } catch {
    return false
  }
}

/**
 * published: every published release's commit; runs: every release.yml run, each with every attempt's status, jobs
 * and record ({ sha } from its own attempt artifact) or null; complete: whether the history was read whole. Returns
 * every state production may have been through, in that order, each once.
 */
export function deployedStates({ published, runs, complete }) {
  if (!complete) throw new Error("the release history couldn't be read whole")
  const candidates = [...published]
  for (const run of runs)
    for (const a of run.attempts) {
      if (a.status !== "completed") throw new Error(`release run ${run.id}, attempt ${a.n}, is still running`)
      const job = a.jobs.find((j) => j.name === "release")
      // Never started (verify refused it): production untouched.
      if (!job || job.conclusion === "skipped" || !job.started_at) continue
      if (!a.record?.sha) throw new Error(`release run ${run.id}, attempt ${a.n}, started its release job with no record of its own commit`)
      candidates.push(a.record.sha)
    }
  if (!candidates.length) throw new Error("nothing has been released: there is nothing to roll back")
  return [...new Set(candidates)]
}

/** Every item of a paginated listing, and whether they add up to the total the API reports on its first page. */
export function collect(pages, key) {
  const items = pages.flatMap((p) => p[key] ?? [])
  return { items, complete: pages.length > 0 && items.length === pages[0].total_count }
}

/**
 * The release history as GitHub holds it, through `gh(args)` (the GitHub CLI's output): published releases' commits
 * from this checkout's tags, and each run's attempts with their jobs and their own records. A record is the attempt's
 * artifact, written before the release job changes anything; one that is missing, expired, or names another release
 * is no record.
 */
export function readHistory({ repo, gh, cwd = process.cwd() }) {
  const all = (path, key) =>
    collect(JSON.parse(gh(["api", "--paginate", "--slurp", `${path}${path.includes("?") ? "&" : "?"}per_page=100`])), key)
  const commitOf = (tag) => {
    try {
      return git(cwd, ["rev-list", "-n", "1", `refs/tags/${tag}`])
    } catch {
      return null
    }
  }
  const releases = JSON.parse(gh(["release", "list", "--exclude-drafts", "--limit", "1000", "--json", "tagName"]))
  const published = releases.map((r) => commitOf(r.tagName))
  const listed = all(`repos/${repo}/actions/workflows/release.yml/runs`, "workflow_runs")
  let complete = listed.complete && releases.length < 1000 && published.every(Boolean)
  const runs = []
  for (const r of listed.items) {
    const artifacts = all(`repos/${repo}/actions/runs/${r.id}/artifacts`, "artifacts")
    complete &&= artifacts.complete
    // The run's name carries its release tag (release.yml: run-name), which names each attempt's record.
    const tag = /^release (release-[0-9-]+)$/.exec(r.display_title ?? "")?.[1]
    const attempts = []
    for (let n = 1; n <= r.run_attempt; n++) {
      const jobs = all(`repos/${repo}/actions/runs/${r.id}/attempts/${n}/jobs`, "jobs")
      complete &&= jobs.complete
      const art = tag && artifacts.items.find((a) => a.name === `release-attempt-${tag}-${n}` && !a.expired)
      let record = null
      if (art) {
        const dir = mkdtempSync(join(tmpdir(), "attempt-"))
        gh(["run", "download", String(r.id), "-R", repo, "--name", art.name, "--dir", dir])
        const kept = JSON.parse(readFileSync(join(dir, "attempt.json"), "utf8"))
        if (kept?.release === tag && /^[0-9a-f]{40}$/.test(kept.sha ?? "")) record = { sha: kept.sha }
      }
      attempts.push({ n, status: n === r.run_attempt ? r.status : "completed", jobs: jobs.items, record })
    }
    runs.push({ id: r.id, attempts })
  }
  return { published: published.filter(Boolean), runs, complete }
}

/**
 * The rollback to `target` checked against each state production may have been through: a later one by the whole
 * rollback check (its migrations, safeguards and schedule), an earlier one for the migrations it applied, which the
 * target must still have as they were. The target itself is skipped (going back to it after a failed attempt is the
 * usual case); one off the target's line is refused by the check.
 */
export function rollbackStateProblems({ cwd = process.cwd(), target, states }) {
  const t = git(cwd, ["rev-parse", `${target}^{commit}`])
  const others = [...new Set(states.map((s) => git(cwd, ["rev-parse", `${s}^{commit}`])))].filter((s) => s !== t)
  if (!others.some((s) => !isAncestor(cwd, s, t))) return ["nothing production may run is newer than the target"]
  return others.flatMap((s) =>
    (isAncestor(cwd, s, t)
      ? appliedMigrationProblems({ cwd, target: t, earlier: s })
      : rollbackProblems({ cwd, target: t, deployed: s })
    ).map((p) => `against ${s.slice(0, 12)}: ${p}`),
  )
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [target] = process.argv.slice(2)
  if (!target) {
    console.error("usage: node scripts/rollback-state.mjs <target-sha>")
    process.exit(2)
  }
  const gh = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
  try {
    const states = deployedStates(readHistory({ repo: process.env.GITHUB_REPOSITORY, gh }))
    const problems = rollbackStateProblems({ target, states })
    if (problems.length) throw new Error("\n" + problems.map((p) => `  - ${p}`).join("\n"))
    console.log(`Rollback to ${target}: allowed against ${states.join(", ")}.`)
  } catch (e) {
    console.error(`Rollback refused: ${e.message}`)
    process.exit(1)
  }
}
