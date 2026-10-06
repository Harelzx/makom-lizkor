// The rules every workflow in .github/workflows keeps (spec 12.2, 14.2; adviser a49), checked by CI on every change:
// only release.yml and rollback.yml reach the production environment, and only through workflow_dispatch; nothing
// else reads a secret; the release checks out and deploys the one commit it verified, in the order 14.2 sets; and a
// rollback moves code only. What this can't see is set in GitHub itself (the environment's branch and reviewers).
//   node scripts/ci-policy.mjs
import { readdirSync, readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { parse } from "yaml"

const PRODUCTION = ["release.yml", "rollback.yml"]
const STAGING = "staging.yml"
const SHA_REF = "${{ needs.verify.outputs.sha }}"

const runs = (job) => (job.steps ?? []).map((s) => (typeof s.run === "string" ? s.run : ""))
const text = (o) => JSON.stringify(o ?? null)

export function policyProblems(workflows) {
  const problems = []
  for (const [name, source] of Object.entries(workflows)) {
    let w
    try {
      w = parse(source)
    } catch (e) {
      problems.push(`${name}: not valid YAML (${e.name})`)
      continue
    }
    const say = (p) => problems.push(`${name}: ${p}`)
    const production = PRODUCTION.includes(name)
    const triggers = typeof w.on === "string" ? [w.on] : Array.isArray(w.on) ? w.on : Object.keys(w.on ?? {})
    if (!w.permissions) say("no top-level permissions")
    if (triggers.includes("pull_request_target")) say("pull_request_target runs a fork's change with this repository's secrets")
    if (production && text(triggers) !== text(["workflow_dispatch"]))
      say("a production workflow runs only when the owner starts it (workflow_dispatch)")
    for (const [id, job] of Object.entries(w.jobs ?? {})) {
      const env = typeof job.environment === "object" ? job.environment?.name : job.environment
      const body = text({ env: job.env, steps: job.steps, with: job.with })
      if (env === "production" && !production) say(`job ${id} uses the production environment`)
      if (env && env !== "production") say(`job ${id} uses an unknown environment '${env}'`)
      const secrets = [...body.matchAll(/\$\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]).filter((s) => s !== "GITHUB_TOKEN")
      // Staging's own secrets (STAGING_*, scoped to the staging account) in staging.yml; any other only in production's.
      const staging = name === STAGING && secrets.every((s) => s.startsWith("STAGING_"))
      if (secrets.length && env !== "production" && !staging)
        say(`job ${id} reads ${secrets.join(", ")} outside the production environment`)
      if (production && secrets.some((s) => s.startsWith("STAGING_"))) say(`job ${id} reads staging secrets in a production workflow`)
      // An input or event field written into a script is a script injection; it goes through env instead.
      for (const run of runs(job))
        if (/\$\{\{\s*(inputs\.|github\.event\.)/.test(run)) say(`job ${id} writes an input into a script; pass it through env`)
      const deploys = runs(job).some((r) =>
        /\bwrangler\s+(deploy|rollback|versions\s+(deploy|upload)|d1\s+(migrations\s+apply|execute|time-travel\s+restore))\b/.test(r),
      )
      const toStaging = name === STAGING && job.env?.CLOUDFLARE_ENV === "staging" && !runs(job).some((r) => /--env\s+(?!staging\b)/.test(r))
      if (deploys && !production && !toStaging) say(`job ${id} changes production from outside release.yml and rollback.yml`)
    }
    // Phase 7 task 6: a build that is checked or deployed is searched for curated records first, before anything
    // migrates or deploys (the records live in D1 alone; a copy in the bundle would outlive a takedown).
    if (["ci.yml", STAGING, "release.yml"].includes(name)) {
      const searched = Object.values(w.jobs ?? {}).some((job) => {
        const steps = runs(job)
        const build = steps.findIndex((r) => /npm run build\b/.test(r))
        return build >= 0 && steps.findIndex((r, i) => i > build && /node scripts\/bundle-check\.mjs/.test(r)) > build
      })
      if (!searched) say(`${name} must build, then run scripts/bundle-check.mjs`)
      for (const [id, job] of Object.entries(w.jobs ?? {})) {
        const steps = runs(job)
        const check = steps.findIndex((r) => /node scripts\/bundle-check\.mjs/.test(r))
        const change = steps.findIndex((r) => /\bwrangler\s+(deploy|d1\s+migrations\s+apply)\b/.test(r))
        if (change >= 0 && (check < 0 || check > change)) say(`job ${id} must search its build before the migrations and the deploy`)
      }
    }
    if (name === "release.yml") problems.push(...releaseProblems(w).map((p) => `${name}: ${p}`))
    if (name === STAGING) problems.push(...stagingProblems(w, triggers).map((p) => `${name}: ${p}`))
    if (name === "ci.yml" && text(w.on?.push?.branches) !== text(["main"]))
      say("CI runs once per commit: on pushes to main and on pull requests")
    if (name === "rollback.yml") problems.push(...rollbackProblems(w).map((p) => `${name}: ${p}`))
  }
  for (const name of PRODUCTION) if (!(name in workflows)) problems.push(`${name} is missing`)
  return problems
}

function releaseProblems(w) {
  const problems = []
  const jobs = Object.entries(w.jobs ?? {})
  const verify = w.jobs?.verify
  if (!verify || verify.environment) problems.push("needs a verify job, outside the production environment, that binds the commit")
  else {
    const all = runs(verify).join("\n")
    for (const [what, pattern] of [
      ["the draft release's target commit", /targetCommitish/],
      ["the commit being on main", /merge-base --is-ancestor "\$sha" origin\/main/],
      ["CI on that commit", /--workflow ci\.yml --commit "\$SHA" --status success/],
      ["staging on that commit", /--workflow staging\.yml --commit "\$SHA" --status success/],
      ["the manifest's hash for that commit", /release-manifest\.mjs "\$SHA"[^\n]*--hash/],
    ])
      if (!pattern.test(all)) problems.push(`verify doesn't check ${what}`)
    if (verify.outputs?.sha !== "${{ steps.bind.outputs.sha }}") problems.push("verify must output the bound commit as sha")
  }
  for (const [id, job] of jobs) {
    if (job.environment !== "production") continue
    if (!text(job.needs).includes("verify")) problems.push(`job ${id} doesn't wait for verify`)
    const checkout = (job.steps ?? []).find((s) => String(s.uses ?? "").startsWith("actions/checkout"))
    if (checkout?.with?.ref !== SHA_REF) problems.push(`job ${id} must check out ${SHA_REF}`)
    const steps = runs(job)
    if (!steps.some((r) => r.includes('test "$(git rev-parse HEAD)" = "$SHA"')))
      problems.push(`job ${id} doesn't confirm the commit it checked out`)
    if (job.env?.SHA !== SHA_REF) problems.push(`job ${id} must take SHA from verify`)
    // Spec 14.2's order: the release check, the bookmark, the migrations, the deploy, the production checks.
    const order = [
      /npm run release:check/,
      /d1 time-travel info/,
      /d1 migrations apply/,
      /wrangler deploy --tag "\$RELEASE" --message "release \$RELEASE \$SHA"/,
      /edge-check/,
    ]
    const at = order.map((p) => steps.findIndex((r) => p.test(r)))
    if (at.some((i) => i < 0) || at.some((i, k) => k && i < at[k - 1]))
      problems.push(
        `job ${id} must run, in order: release:check, the Time Travel bookmark, the migrations, the deploy (tagged with the release and its commit), the production checks`,
      )
  }
  return problems
}

/** Staging deploys only what CI passed on main, the very commit, checked before and after. */
function stagingProblems(w, triggers) {
  const problems = []
  if (
    text(triggers) !== text(["workflow_run"]) ||
    text(w.on.workflow_run?.workflows) !== text(["ci"]) ||
    text(w.on.workflow_run?.branches) !== text(["main"])
  )
    problems.push("staging runs only after CI completes on main (workflow_run of ci, branches main)")
  for (const [id, job] of Object.entries(w.jobs ?? {})) {
    if (!/workflow_run\.conclusion == 'success'/.test(String(job.if)) || !/workflow_run\.event == 'push'/.test(String(job.if)))
      problems.push(`job ${id} must run only when CI passed on a push`)
    if (job.environment) problems.push(`job ${id} uses an environment: staging has none (GitHub Free)`)
    if (job.env?.CLOUDFLARE_ENV !== "staging") problems.push(`job ${id} must set CLOUDFLARE_ENV to staging`)
    const checkout = (job.steps ?? []).find((s) => String(s.uses ?? "").startsWith("actions/checkout"))
    if (checkout?.with?.ref !== "${{ github.event.workflow_run.head_sha }}") problems.push(`job ${id} must check out the commit CI passed`)
    const steps = runs(job)
    const at = [
      /test "\$\(git rev-parse HEAD\)" = "\$SHA"/,
      /staging-check\.mjs --deploy/,
      /wrangler d1 migrations apply/,
      /wrangler deploy --tag "staging-/,
      /edge-check\.mjs/,
    ].map((p) => steps.findIndex((r) => p.test(r)))
    if (at.some((i) => i < 0) || at.some((i, k) => k && i < at[k - 1]))
      problems.push(
        `job ${id} must confirm the commit, check the staging config, migrate, deploy tagged with the commit, then run the edge checks`,
      )
  }
  return problems
}

function rollbackProblems(w) {
  const problems = []
  const all = Object.values(w.jobs ?? {})
    .flatMap(runs)
    .join("\n")
  // Code only: nothing that brings data back or changes the schema.
  for (const [what, pattern] of [
    ["Time Travel", /time-travel/],
    ["a migration", /migrations\s+apply|d1\s+execute/],
    ["a bucket command", /\br2\b/],
    ["a fresh deploy", /wrangler\s+deploy\b/],
  ])
    if (pattern.test(all)) problems.push(`a rollback runs ${what}`)
  const check = all.indexOf("scripts/rollback-check.mjs")
  const move = all.indexOf("versions deploy --version-tag")
  if (check < 0 || move < 0 || move < check)
    problems.push("a rollback must pass scripts/rollback-check.mjs before it deploys the earlier version")
  return problems
}

export const readWorkflows = (dir = new URL("../.github/workflows/", import.meta.url)) =>
  Object.fromEntries(
    readdirSync(dir)
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => [f, readFileSync(new URL(f, dir), "utf8")]),
  )

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = policyProblems(readWorkflows())
  if (problems.length) {
    console.error("Workflow policy:\n" + problems.map((p) => `  - ${p}`).join("\n"))
    process.exit(1)
  }
  console.log("Workflow policy holds.")
}
