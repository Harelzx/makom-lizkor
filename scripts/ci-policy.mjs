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

/** A pipe (not ||) outside single quotes, where jq filters keep theirs. */
const hidesFailure = (run) => /(^|[^|])\|(?!\|)/.test(run.replace(/'[^']*'/g, "''"))
const pipefail = (step, job, w) =>
  /^\s*set -[a-z]*o pipefail\b/.test(step.run) || [step.shell, job.defaults?.run?.shell, w.defaults?.run?.shell].includes("bash")

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
      // The retention time scale is staging's alone (L-RET A2, a87): no other workflow may name it.
      if (name !== STAGING && /RETENTION_DAY_SECONDS/.test(body)) say(`job ${id} sets RETENTION_DAY_SECONDS, which only staging.yml may`)
      // So are its export keys (L-RET A2, a104): no other workflow may give them to a deploy.
      if (name !== STAGING && /STAGING_EXPORT_PUBLIC_KEYS/.test(body))
        say(`job ${id} names STAGING_EXPORT_PUBLIC_KEYS, which only staging.yml may`)
      // A Cloudflare token reaches only the steps that call wrangler: in a job's env it would be in every step's,
      // `npm ci` included, where any dependency's install script runs (the repository is public).
      const cloudflare = (env) => Object.entries(env ?? {}).some(([k, v]) => /CLOUDFLARE_(API_TOKEN|ACCOUNT_ID)/.test(`${k} ${v}`))
      if (cloudflare(job.env)) say(`job ${id} gives a Cloudflare token to every step; give it to the wrangler steps alone`)
      for (const step of job.steps ?? [])
        if (cloudflare(step.env) && !/\bwrangler\b/.test(String(step.run ?? "")))
          say(`job ${id} gives a Cloudflare token to a step that doesn't call wrangler`)
      // GitHub runs a step with no shell named as `bash -e {0}`, without pipefail: a failure before a pipe would pass.
      for (const step of job.steps ?? [])
        if (typeof step.run === "string" && hidesFailure(step.run) && !pipefail(step, job, w))
          say(`job ${id} has a pipe that hides a failure; start the step with set -o pipefail`)
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
    if (name === "ci.yml") {
      if (w.jobs?.regression?.uses !== "./.github/workflows/browser-suite.yml") say("CI must retain the full browser suite")
      if (w.jobs?.ready?.if !== "always()" || !runs(w.jobs?.ready ?? {}).some((r) => r.includes("node scripts/ci-evidence.mjs ready")))
        say("CI must aggregate every required job, even on failure")
      for (const id of ["plan", "static", "worker", "client", "core", "webkit", "dev", "regression"])
        if (!w.jobs?.ready?.needs?.includes(id)) say(`readiness must wait for ${id}`)
    }
    if (name === "browser-suite.yml") {
      if (text(w.jobs?.browser?.strategy?.matrix?.shard) !== text([1, 2]) || w.jobs?.browser?.strategy?.["fail-fast"] !== false)
        say("full regression needs two independent shards")
      if (!runs(w.jobs?.browser ?? {}).some((r) => r.includes('node scripts/ci-browser.mjs run full "$SHARD/2"')))
        say("full regression must run production-build browser tests")
      if (
        !runs(w.jobs?.coverage ?? {}).some((r) => r.includes("node scripts/ci-browser.mjs verify-full")) ||
        w.jobs?.coverage?.if !== "always()" ||
        w.jobs?.coverage?.needs !== "browser"
      )
        say("full regression must verify complete shard coverage")
    }
    // Workers Caching stays off in production (L-CACHE-STG, a95): the release reads the configuration it built, the one
    // it deploys, after the build and before any migration or deploy.
    if (name === "release.yml") {
      const cacheChecked = Object.values(w.jobs ?? {}).some((job) => {
        const steps = runs(job)
        const build = steps.findIndex((r) => /npm run build\b/.test(r))
        const check = steps.findIndex((r) => /node scripts\/release-cache\.mjs dist\/makom_lizkor\/wrangler\.json/.test(r))
        const change = steps.findIndex((r) => /\bwrangler\s+(deploy|d1\s+migrations\s+apply)\b/.test(r))
        return build >= 0 && check > build && (change < 0 || check < change)
      })
      if (!cacheChecked) say("release.yml must check its built configuration for Workers Caching after the build, before any change")
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
      ["full regression on that commit", /node scripts\/ci-evidence\.mjs release "\$SHA"/],
      ["staging on that commit", /node scripts\/staging-evidence\.mjs check "\$SHA"/],
      ["the attached manifest's content for that commit", /release-manifest\.mjs "\$SHA"[^\n]*--verify "\$RUNNER_TEMP\/manifest\.json"/],
      ["the release tag's commit", /release-manifest\.mjs "\$SHA"[^\n]*--verify[^\n]*--tag "\$RELEASE"/],
    ])
      if (!pattern.test(all)) problems.push(`verify doesn't check ${what}`)
    if (verify.outputs?.sha !== "${{ steps.bind.outputs.sha }}") problems.push("verify must output the bound commit as sha")
    if (w["run-name"] !== "release ${{ inputs.release }}")
      problems.push("the run must be named for its release (run-name: release <release>)")
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
    // The attempt's record, uploaded before anything changes production, for a later rollback (P6-ROLLBACK-1).
    const all = job.steps ?? []
    const record = all.findIndex(
      (st) =>
        String(st.uses ?? "").startsWith("actions/upload-artifact") &&
        st.with?.name === "release-attempt-${{ inputs.release }}-${{ github.run_attempt }}" &&
        !("if" in st),
    )
    const bookmark = all.findIndex((st) => /d1 time-travel info/.test(st.run ?? ""))
    if (record < 0 || bookmark < 0 || record > bookmark || all.slice(record, bookmark + 1).some((st) => "if" in st))
      problems.push(`job ${id} must record its attempt (release-attempt-<release>-<attempt>) before the bookmark, unconditionally`)
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
    // The production checks get the synthetic owners and the workers.dev address to probe (staging harness).
    const checks = Object.values(w.jobs ?? {})
      .flatMap((j) => j.steps ?? [])
      .find((st) => /edge-check\.mjs/.test(st.run ?? ""))
    if (checks?.env?.EDGE_IDENTITIES !== "${{ secrets.EDGE_IDENTITIES }}")
      problems.push("release.yml's production checks must be given EDGE_IDENTITIES (secrets.EDGE_IDENTITIES)")
    // Production's purge_freshness comes from the content-free probe, with its own token (L-PURGE).
    if (checks?.env?.EDGE_PROBE !== "${{ secrets.EDGE_PROBE }}")
      problems.push("release.yml's production checks must be given EDGE_PROBE (secrets.EDGE_PROBE)")
    if (!/edge-check\.mjs[^\n]*--probe-freshness/.test(checks?.run ?? ""))
      problems.push("release.yml's production checks must let the probe answer purge_freshness (--probe-freshness)")
    // Production's Worker cache stays off (release-cache.mjs), and its checks are told so (C-CACHE).
    if (!/edge-check\.mjs[^\n]*--edge-cache off(\s|$)/.test(checks?.run ?? ""))
      problems.push("release.yml's production checks must say the Worker cache is off (--edge-cache off), as production's stays off")
    if (checks?.env?.WORKERS_DEV_URL !== "${{ vars.WORKERS_DEV_URL }}" || !/--workers-dev "\$WORKERS_DEV_URL"/.test(checks?.run ?? ""))
      problems.push('release.yml\'s production checks must be given --workers-dev "$WORKERS_DEV_URL" (vars.WORKERS_DEV_URL)')
    // The checks wait for the version this deploy tagged, and hold the Worker's answers to it (a61).
    if (!steps.some((r) => /edge-check\.mjs[^\n]*--expect-tag "\$RELEASE"/.test(r)))
      problems.push(`job ${id}'s production checks must expect the version it deployed (--expect-tag "$RELEASE")`)
    // A failed or cancelled release says what it left in production, from the outcomes of the steps that change and
    // check it (L-RELEASE-FAIL): a failed final check is not proof that nothing was deployed.
    const last = all.at(-1) ?? {}
    const ids = { migrate: /d1 migrations apply/, deploy: /wrangler deploy --tag/, checks: /edge-check\.mjs/, publish: /gh release edit/ }
    const wired = Object.entries(ids).every(([sid, p]) => all.find((st) => st.id === sid && p.test(st.run ?? "")))
    const env = { MIGRATED: "migrate", DEPLOYED: "deploy", CHECKED: "checks", PUBLISHED: "publish" }
    if (
      !wired ||
      String(last.if).replace(/\s/g, "") !== "failure()||cancelled()" ||
      !/node scripts\/release-outcome\.mjs "\$RELEASE" "\$MIGRATED" "\$DEPLOYED" "\$CHECKED" "\$PUBLISHED"/.test(last.run ?? "") ||
      !/\$GITHUB_STEP_SUMMARY/.test(last.run ?? "") ||
      Object.entries(env).some(([k, sid]) => last.env?.[k] !== `\${{ steps.${sid}.outcome }}`)
    )
      problems.push(
        `job ${id} must end by saying what a failed release left in production (scripts/release-outcome.mjs, on failure() || cancelled())`,
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
  const preflight = w.jobs?.verify
  if (
    !String(preflight?.if).includes("workflow_run.conclusion == 'success'") ||
    !String(preflight?.if).includes("workflow_run.event == 'push'")
  )
    problems.push("preflight runs only when CI passed on a push")
  if (
    preflight?.steps?.find((s) => String(s.uses ?? "").startsWith("actions/checkout"))?.with?.ref !==
    "${{ github.event.workflow_run.head_sha }}"
  )
    problems.push("preflight must check out the commit CI passed")
  if (
    preflight?.permissions?.actions !== "read" ||
    !runs(preflight ?? {}).includes("node scripts/ci-evidence.mjs staging") ||
    !String(preflight?.if).includes("workflow_run.head_repository.full_name == github.repository") ||
    preflight?.outputs?.allowed !== "${{ steps.check.outputs.allowed }}"
  )
    problems.push("staging must verify trusted same-SHA readiness before using credentials")
  if (w.jobs?.deploy?.needs !== "verify" || !String(w.jobs?.deploy?.if).includes("needs.verify.outputs.allowed == 'true'"))
    problems.push("staging deploy must wait for explicit readiness permission")
  for (const [id, job] of Object.entries(w.jobs ?? {}).filter(([id]) => id !== "verify")) {
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
    const drillMigration = steps.findIndex((r) => /wrangler d1 migrations apply DRILL_DB --remote/.test(r))
    const deployStep = (job.steps ?? []).find((st) => /wrangler deploy --tag/.test(st.run ?? ""))
    if (
      drillMigration < at[1] ||
      drillMigration >= at[3] ||
      deployStep?.env?.DRILL_PRIVATE_KEY !== "${{ secrets.STAGING_DRILL_PRIVATE_KEY }}" ||
      !/test -n "\$DRILL_PRIVATE_KEY"/.test(deployStep?.run ?? "") ||
      !/DRILL_PRIVATE_KEY:e\.DRILL_PRIVATE_KEY/.test(deployStep?.run ?? "")
    )
      problems.push(`job ${id} must migrate the separate drill database before deployment and provide the staging drill secret`)
    // The edge checks wait for the version this deploy tagged, and hold the Worker's answers to it (a61).
    if (
      !steps.some((r) => /wrangler deploy --tag "staging-\$\{SHA:0:12\}"/.test(r)) ||
      !steps.some((r) => /edge-check\.mjs[^\n]*--expect-tag "staging-\$\{SHA:0:12\}"/.test(r))
    )
      problems.push(`job ${id}'s edge checks must expect the version it deployed (--expect-tag "staging-\${SHA:0:12}")`)
    // Staging runs as production does, its Worker cache off (wrangler.jsonc's env.staging), and its checks are told so.
    if (!steps.some((r) => /edge-check\.mjs[^\n]*--edge-cache off(\s|$)/.test(r)))
      problems.push(`job ${id}'s edge checks must say the Worker cache is off (--edge-cache off), as env.staging sets it (C-CACHE)`)
    // Staging's retention scale comes from its own repository variable alone, given to the deploy (L-RET A2, a87); the
    // Worker accepts only 7200 there, so a wrong value fails the deploy's own checks rather than shortening anything.
    if (
      job.env?.STAGING_RETENTION_DAY_SECONDS !== "${{ vars.STAGING_RETENTION_DAY_SECONDS }}" ||
      !steps.some((r) => /wrangler deploy --tag "staging-[\s\S]*--var "RETENTION_DAY_SECONDS:\$STAGING_RETENTION_DAY_SECONDS"/.test(r))
    )
      problems.push(`job ${id} must give the deploy RETENTION_DAY_SECONDS from vars.STAGING_RETENTION_DAY_SECONDS`)
    // Staging's export keys (L-RET A2, a104) come from a repository variable, never a secret, where a private key could
    // sit unseen; staging-check refuses anything but public RSA keys of staging's own.
    if (
      job.env?.STAGING_EXPORT_PUBLIC_KEYS !== "${{ vars.STAGING_EXPORT_PUBLIC_KEYS }}" ||
      !steps.some((r) => /wrangler deploy --tag "staging-[\s\S]*--var "EXPORT_PUBLIC_KEYS:\$STAGING_EXPORT_PUBLIC_KEYS"/.test(r))
    )
      problems.push(`job ${id} must give the deploy EXPORT_PUBLIC_KEYS from vars.STAGING_EXPORT_PUBLIC_KEYS`)
    // The receipt release.yml reads (P6-STAGING-1): the last step, so it exists only if every step before it passed,
    // named for the commit deployed, from the edge check's own report, kept a modest while.
    const all = job.steps ?? []
    const last = all[all.length - 1] ?? {}
    const edge = all.findIndex((st) => /edge-check\.mjs[^\n]*--report/.test(st.run ?? ""))
    // What the edge checks need, from the repository (staging harness); unset, each stays incomplete.
    for (const [name, value] of [
      ["EDGE_IDENTITIES", "${{ secrets.STAGING_EDGE_IDENTITIES }}"],
      ["EDGE_PLACE", "${{ vars.STAGING_EDGE_PLACE }}"],
      ["EDGE_PURGE", "${{ secrets.STAGING_EDGE_PURGE }}"],
      ["EDGE_PROBE", "${{ secrets.STAGING_EDGE_PROBE }}"],
    ])
      if (all[edge]?.env?.[name] !== value) problems.push(`staging.yml's edge checks must be given ${name} (${value.slice(4, -3)})`)
    // Staging's purge_freshness is its synthetic exercise; the probe never stands for it there (L-PURGE-STAGING-1).
    if (all.some((st) => /--probe-freshness/.test(st.run ?? "")))
      problems.push("staging.yml's edge checks must not let the probe answer purge_freshness (--probe-freshness is production's)")
    if (
      !String(last.uses ?? "").startsWith("actions/upload-artifact") ||
      "if" in last ||
      last.with?.name !== "staging-receipt-${{ github.event.workflow_run.head_sha }}" ||
      !(Number(last.with?.["retention-days"]) > 0 && Number(last.with?.["retention-days"]) <= 90) ||
      edge < 0 ||
      !all
        .slice(edge + 1)
        .some((st) => /node scripts\/staging-receipt\.mjs "\$RUNNER_TEMP\/edge\.json"[^\n]*receipt\.json/.test(st.run ?? ""))
    )
      problems.push(`job ${id} must upload its receipt last, named for the commit, from the edge check's report, kept at most 90 days`)
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
  // The check runs against every state production may hold (scripts/rollback-state.mjs runs rollback-check for each).
  const check = all.indexOf('node scripts/rollback-state.mjs "$target"')
  const move = all.indexOf("versions deploy --version-tag")
  if (check < 0 || move < 0 || move < check)
    problems.push("a rollback must pass scripts/rollback-state.mjs before it deploys the earlier version")
  for (const [id, job] of Object.entries(w.jobs ?? {}))
    if (job.permissions?.actions !== "read") problems.push(`job ${id} must read the release runs (permissions: actions: read)`)
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
