// Read-only GitHub evidence, bound to a successful trusted workflow and the exact commit. Neither a green docs run
// nor a green preview is full release evidence. The first run without an eligible ancestor takes the full path.
import { execFileSync } from "node:child_process"
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { classify, gitChanges, POLICY } from "./ci-plan.mjs"
const shaPattern = /^[a-f0-9]{40}$/
const json = (p) => JSON.parse(readFileSync(p, "utf8"))
const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })
const api = (p) => JSON.parse(gh("api", p))
const repo = () => {
  if (!/^[\w.-]+\/[\w.-]+$/.test(process.env.GITHUB_REPOSITORY || "")) throw new Error("Repository identity required")
  return process.env.GITHUB_REPOSITORY
}
export function trustedCI(run, sha, repository) {
  return (
    run.path === ".github/workflows/ci.yml" &&
    run.event === "push" &&
    run.head_branch === "main" &&
    run.head_sha === sha &&
    run.head_repository?.full_name === repository &&
    run.status === "completed" &&
    run.conclusion === "success"
  )
}
export function checkReceipt({ kind, sha, receipt, run, repository, sourceRun }) {
  if (
    !shaPattern.test(sha) ||
    receipt.policy !== POLICY ||
    receipt.kind !== kind ||
    receipt.sha !== sha ||
    receipt.run_id !== run.id ||
    receipt.attempt !== run.run_attempt
  )
    throw new Error("Evidence identity mismatch")
  if (run.status !== "completed" || run.conclusion !== "success" || run.head_repository?.full_name !== repository)
    throw new Error("Evidence run did not pass in this repository")
  if (run.path === ".github/workflows/ci.yml") {
    if (!trustedCI(run, sha, repository)) throw new Error("CI evidence is not a successful main push")
  } else if (kind === "full" && run.path === ".github/workflows/regression.yml") {
    if (
      run.event !== "workflow_run" ||
      run.head_branch !== "main" ||
      receipt.source_ci_run !== sourceRun?.id ||
      !Number.isInteger(receipt.source_ci_attempt) ||
      receipt.source_ci_attempt < 1 ||
      receipt.source_ci_attempt !== sourceRun?.run_attempt ||
      !trustedCI(sourceRun, sha, repository)
    )
      throw new Error("Regression source is not trusted CI for this commit")
  } else throw new Error("Unexpected evidence workflow")
  if (kind === "full" && (receipt.full !== true || receipt.deploy_allowed !== true || !["full", "preview"].includes(receipt.mode)))
    throw new Error("No full regression evidence")
  if (kind === "ready" && !["docs", "preview", "full"].includes(receipt.mode)) throw new Error("Invalid readiness mode")
  if (kind === "ready" && (receipt.deploy_allowed !== (receipt.mode !== "docs") || receipt.full !== (receipt.mode === "full")))
    throw new Error("Readiness flags disagree")
  return receipt
}
// The immutable workflow_run event names the attempt whose work is being admitted/recorded. Fetching a newer
// successful readiness receipt must never relabel an older event's work after the source CI has been rerun.
export function checkTriggerReadiness(eventRun, ready, sha, repository) {
  return checkReceipt({ kind: "ready", sha, receipt: ready, run: eventRun, repository })
}
function download(artifact) {
  const dir = mkdtempSync(join(tmpdir(), "makom-ci-"))
  try {
    const archive = execFileSync("gh", ["api", `repos/${repo()}/actions/artifacts/${artifact.id}/zip`], { maxBuffer: 4 * 1024 * 1024 })
    writeFileSync(join(dir, "receipt.zip"), archive)
    const raw = execFileSync("unzip", ["-p", join(dir, "receipt.zip"), "receipt.json"], { encoding: "utf8", maxBuffer: 1024 * 1024 })
    return JSON.parse(raw)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
export function artifactFor(artifacts, kind, sha, runId) {
  const a = artifacts
    .filter((a) => a.name === `ci-${kind}-${sha}` && !a.expired && (!runId || a.workflow_run?.id === Number(runId)))
    .sort((a, b) => b.id - a.id)[0]
  if (!a) throw new Error(`No ${kind} receipt for ${sha}`)
  return a
}
function fetchEvidence(kind, sha, runId) {
  if (!shaPattern.test(sha)) throw new Error("Invalid SHA")
  const listing = api(`repos/${repo()}/actions/artifacts?name=ci-${kind}-${sha}&per_page=100`)
  const artifact = artifactFor(listing.artifacts, kind, sha, runId)
  const run = api(`repos/${repo()}/actions/runs/${artifact.workflow_run.id}`)
  const receipt = download(artifact)
  const sourceRun = receipt.source_ci_run ? api(`repos/${repo()}/actions/runs/${receipt.source_ci_run}`) : undefined
  return checkReceipt({ kind, sha, receipt, run, repository: repo(), sourceRun })
}
function output(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}
function summary(s) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, s + "\n")
}
function ancestor(base, sha) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", base, sha], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}
function baseline(sha) {
  const artifacts = api(`repos/${repo()}/actions/artifacts?per_page=100`).artifacts
  for (const a of artifacts.filter((a) => /^ci-full-[a-f0-9]{40}$/.test(a.name) && !a.expired).slice(0, 12)) {
    const base = a.name.slice("ci-full-".length)
    if (!ancestor(base, sha)) continue
    try {
      fetchEvidence("full", base, a.workflow_run.id)
      return base
    } catch {
      /* An invalid/stale receipt cannot grant the fast path. */
    }
  }
  return null
}
export function readiness(plan, needs) {
  const required =
    plan.mode === "docs" ? ["plan"] : ["plan", "static", "worker", "client", "webkit", plan.mode === "full" ? "regression" : "core"]
  if (plan.dev) required.push("dev")
  if (!["docs", "preview", "full"].includes(plan.mode)) throw new Error("Unknown plan mode")
  for (const job of required) if (needs[job]?.result !== "success") throw new Error(`Required ${job}: ${needs[job]?.result || "missing"}`)
  for (const [job, state] of Object.entries(needs)) {
    if (!required.includes(job) && state.result !== "skipped") throw new Error(`Unexpected result for unselected ${job}: ${state.result}`)
  }
  return { deploy_allowed: plan.mode !== "docs", full: plan.mode === "full" }
}
function writeReceipt(kind, data) {
  const dir = join("ci-evidence", kind)
  mkdirSync(dir, { recursive: true })
  const receipt = {
    policy: POLICY,
    kind,
    sha: process.env.TARGET_SHA || process.env.GITHUB_SHA,
    run_id: Number(process.env.GITHUB_RUN_ID),
    attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
    ...data,
  }
  writeFileSync(join(dir, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n")
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, arg] = process.argv.slice(2)
  if (command === "plan") {
    const sha = process.env.GITHUB_SHA
    let base = null
    try {
      base = baseline(sha)
    } catch {
      summary("Verified baseline unavailable; using full checks.")
    }
    const changes = base ? gitChanges(base, sha) : []
    const plan = {
      ...classify(changes, { baseline: base, sha }),
      dev: !base || changes.some((c) => /^(vite\.config|playwright|package|patches\/)/.test(c.path)),
    }
    writeFileSync("ci-plan.json", JSON.stringify(plan, null, 2))
    output("mode", plan.mode)
    output("groups", JSON.stringify(plan.groups))
    output("dev", String(plan.dev))
    summary(
      `## CI plan: ${plan.mode}\nCommit: ${sha}\n\n${plan.reason}\n\nBaseline: ${base || "none"}; groups: ${plan.groups.join(", ") || "none"}.`,
    )
  } else if (command === "ready") {
    const plan = json("ci-plan.json")
    if (plan.sha !== process.env.GITHUB_SHA || plan.policy !== POLICY) throw new Error("Readiness plan identity mismatch")
    const flags = readiness(plan, JSON.parse(process.env.CI_NEEDS))
    writeReceipt("ready", { ...flags, mode: plan.mode, baseline: plan.baseline })
    if (flags.full) writeReceipt("full", { ...flags, mode: plan.mode })
    summary(
      `## ${flags.full ? "Full candidate verified" : flags.deploy_allowed ? "Protected preview ready; full regression pending" : "Documentation only; no deployment"}\n${process.env.GITHUB_SHA}`,
    )
  } else if (command === "staging" || command === "background") {
    const event = json(process.env.GITHUB_EVENT_PATH),
      run = event.workflow_run,
      sha = run?.head_sha
    if (!trustedCI(run, sha, repo())) throw new Error("Untrusted triggering run")
    const ready = fetchEvidence("ready", sha, run.id)
    checkTriggerReadiness(run, ready, sha, repo())
    let allowed = ready.deploy_allowed && (command === "staging" || ready.mode === "preview")
    // A queued deployment may not overwrite newer application code. Documentation after this SHA is harmless.
    if (command === "staging" && allowed) {
      const tip = execFileSync("git", ["rev-parse", "origin/main"], { encoding: "utf8" }).trim()
      allowed =
        ancestor(sha, tip) && gitChanges(sha, tip).every((c) => c.status === "M" && /^(docs\/.*\.md|README\.md|CLAUDE\.md)$/.test(c.path))
    }
    output("allowed", String(allowed))
    output("sha", sha)
    output("mode", ready.mode)
    summary(
      `${command}: ${allowed ? "eligible" : "skipped (docs, superseded, or already fully checked)"}; ${sha}. ${ready.mode === "preview" ? "Preview is not production approval." : ""}`,
    )
  } else if (command === "full") {
    const needs = JSON.parse(process.env.CI_NEEDS)
    if (needs.verify?.result !== "success" || needs.regression?.result !== "success") throw new Error("Full regression did not complete")
    const event = json(process.env.GITHUB_EVENT_PATH),
      run = event.workflow_run
    const ready = fetchEvidence("ready", process.env.TARGET_SHA, run.id)
    checkTriggerReadiness(run, ready, process.env.TARGET_SHA, repo())
    if (ready.mode !== "preview") throw new Error("Background full evidence requires a preview readiness receipt")
    writeReceipt("full", { mode: "preview", full: true, deploy_allowed: true, source_ci_run: run.id, source_ci_attempt: run.run_attempt })
    summary(`Full regression verified: ${process.env.TARGET_SHA}. Release still requires staging and all launch checks.`)
  } else if (command === "release") {
    const ready = fetchEvidence("ready", arg),
      full = fetchEvidence("full", arg)
    if (!ready.deploy_allowed || !full.full) throw new Error("Not a fully verified runtime candidate")
    console.log(`Readiness and full regression passed on ${arg}.`)
  } else throw new Error("Unknown CI evidence command")
}
