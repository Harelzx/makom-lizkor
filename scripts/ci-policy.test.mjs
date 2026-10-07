// node --test scripts/ci-policy.test.mjs
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { parse } from "yaml"
import { policyProblems, readWorkflows } from "./ci-policy.mjs"

const real = readWorkflows()
const withChange = (name, from, to) => {
  assert.ok(real[name].includes(from), `${name} no longer contains: ${from}`)
  return { ...real, [name]: real[name].replace(from, to) }
}
const fails = (workflows, expected) => {
  const problems = policyProblems(workflows)
  assert.ok(
    problems.some((p) => p.includes(expected)),
    `expected a problem with "${expected}", got:\n${problems.join("\n")}`,
  )
}

test("the committed workflows keep the policy", () => {
  assert.deepEqual(policyProblems(real), [])
  assert.deepEqual(Object.keys(real).sort(), ["ci.yml", "release.yml", "rollback.yml", "staging.yml"])
})

test("only release and rollback reach production, and nothing else reads a secret", () => {
  fails(
    withChange("ci.yml", "  worker:\n    runs-on: ubuntu-latest\n", "  worker:\n    runs-on: ubuntu-latest\n    environment: production\n"),
    "job worker uses the production environment",
  )
  fails(
    withChange(
      "ci.yml",
      "      - run: npm test\n",
      "      - run: npm test\n        env:\n          T: ${{ secrets.CLOUDFLARE_API_TOKEN }}\n",
    ),
    "reads CLOUDFLARE_API_TOKEN outside the production environment",
  )
  fails(
    withChange("ci.yml", "      - run: npm test\n", "      - run: npx wrangler deploy\n"),
    "changes production from outside release.yml and rollback.yml",
  )
  fails(withChange("ci.yml", "  pull_request:\n", "  pull_request_target:\n"), "pull_request_target")
  fails(withChange("ci.yml", "permissions:\n  contents: read\n", ""), "no top-level permissions")
  fails({ ...real, "ci.yml": "on: [push\n" }, "not valid YAML")
})

test("a production workflow starts only by hand", () => {
  fails(
    withChange("release.yml", "on:\n  workflow_dispatch:\n", "on:\n  push:\n  workflow_dispatch:\n"),
    "runs only when the owner starts it",
  )
  fails(
    withChange("rollback.yml", "on:\n  workflow_dispatch:\n", "on:\n  schedule:\n    - cron: '0 0 * * *'\n  workflow_dispatch:\n"),
    "runs only when the owner starts it",
  )
})

test("a production workflow never writes an input into a script", () => {
  fails(
    withChange(
      "rollback.yml",
      'npx wrangler versions deploy --version-tag "$TO_RELEASE"',
      'npx wrangler versions deploy --version-tag "${{ inputs.to_release }}"',
    ),
    "writes an input into a script",
  )
})

test("the release binds one commit through every step", () => {
  fails(
    withChange("release.yml", "          ref: ${{ needs.verify.outputs.sha }}\n", "          ref: main\n"),
    "must check out ${{ needs.verify.outputs.sha }}",
  )
  fails(
    withChange("release.yml", '        run: test "$(git rev-parse HEAD)" = "$SHA"\n', "        run: true\n"),
    "doesn't confirm the commit it checked out",
  )
  fails(
    withChange("release.yml", "--workflow ci.yml --commit", "--workflow ci.yml --branch main --commit-any"),
    "doesn't check CI on that commit",
  )
  // Staging's receipt for this commit, never a run's own metadata (P6-STAGING-1).
  fails(withChange("release.yml", 'node scripts/staging-evidence.mjs check "$SHA"', "true"), "doesn't check staging on that commit")
  // The attachment compared whole, and the release tag's commit (P6-MANIFEST-1): a declared hash proves nothing.
  fails(
    withChange("release.yml", '"$SHA" $from --verify "$RUNNER_TEMP/manifest.json" --tag "$RELEASE"', '"$SHA" $from --hash'),
    "the attached manifest's content for that commit",
  )
  fails(
    withChange(
      "release.yml",
      '"$SHA" $from --verify "$RUNNER_TEMP/manifest.json" --tag "$RELEASE"',
      '"$SHA" $from --verify "$RUNNER_TEMP/manifest.json"',
    ),
    "the release tag's commit",
  )
  fails(withChange("release.yml", 'git merge-base --is-ancestor "$sha" origin/main', "true"), "the commit being on main")
  fails(withChange("release.yml", '--tag "$RELEASE" --message "release $RELEASE $SHA"', ""), "must run, in order")
})

test("the release runs 14.2's steps in their order", () => {
  const source = real["release.yml"]
  const check = "      - name: Release check\n        run: npm run release:check\n"
  const migrate =
    "      - name: Migrations (expand only; scripts/rollback-check.mjs refuses a rollback across anything else)\n        id: migrate\n        run: npx wrangler d1 migrations apply DB --remote\n"
  assert.ok(source.includes(check) && source.includes(migrate))
  // The migrations moved ahead of the release check.
  fails(
    {
      ...real,
      "release.yml": source
        .replace(check, "")
        .replace(migrate, migrate + check)
        .replace("      - name: Time Travel", migrate.replace("Migrations", "Early migrations") + "      - name: Time Travel"),
    },
    "must run, in order",
  )
})

test("a rollback moves code only, after its check", () => {
  for (const [line, what] of [
    ["npx wrangler d1 time-travel restore DB --bookmark x", "Time Travel"],
    ["npx wrangler d1 migrations apply DB --remote", "a migration"],
    ["npx wrangler r2 object put x", "a bucket command"],
    ["npx wrangler deploy", "a fresh deploy"],
  ])
    fails(withChange("rollback.yml", "      - run: npm ci\n", `      - run: npm ci\n      - run: ${line}\n`), `a rollback runs ${what}`)
  // Checked against every state production may hold, unfinished release attempts included (P6-ROLLBACK-1).
  fails(
    withChange("rollback.yml", '          node scripts/rollback-state.mjs "$target"', "          echo skipped"),
    "must pass scripts/rollback-state.mjs",
  )
  fails(withChange("rollback.yml", "      actions: read\n", ""), "must read the release runs")
})

test("a release records the commit it attempts before it touches production (P6-ROLLBACK-1)", () => {
  fails(
    withChange(
      "release.yml",
      "          name: release-attempt-${{ inputs.release }}-${{ github.run_attempt }}",
      "          name: release-attempt-${{ inputs.release }}",
    ),
    "record its attempt",
  )
  // The run named for its release, so a published tag stands for a record that has expired (a52).
  fails(withChange("release.yml", "run-name: release ${{ inputs.release }}\n", ""), "named for its release")
  fails(
    withChange(
      "release.yml",
      "      - name: Time Travel bookmark before the migrations\n",
      "      - name: Time Travel bookmark before the migrations\n        if: false\n",
    ),
    "record its attempt",
  )
})

test("CI runs once per commit", () => {
  fails(withChange("ci.yml", "  push:\n    branches: [main]\n", "  push:\n"), "once per commit")
})

test("staging deploys only the commit CI passed on main, with staging's secrets alone, checked before and after", () => {
  fails(withChange("staging.yml", "    branches: [main]\n", "    branches: [main, dev]\n"), "only after CI completes on main")
  fails(withChange("staging.yml", "on:\n  workflow_run:", "on:\n  push:\n  workflow_run:"), "only after CI completes on main")
  fails(withChange("staging.yml", " && github.event.workflow_run.event == 'push'", ""), "only when CI passed on a push")
  fails(withChange("staging.yml", "      CLOUDFLARE_ENV: staging\n", ""), "must set CLOUDFLARE_ENV to staging")
  fails(
    withChange("staging.yml", "          ref: ${{ github.event.workflow_run.head_sha }}\n", "          ref: main\n"),
    "check out the commit CI passed",
  )
  fails(withChange("staging.yml", "node scripts/staging-check.mjs --deploy", "true"), "check the staging config")
  fails(withChange("staging.yml", "node scripts/edge-check.mjs", "echo"), "then run the edge checks")
  // Its receipt comes last, from the edge check's own report, under this commit's name (P6-STAGING-1).
  fails(
    withChange("staging.yml", "name: staging-receipt-${{ github.event.workflow_run.head_sha }}", "name: staging-receipt"),
    "upload its receipt",
  )
  fails(withChange("staging.yml", "          retention-days: 90\n", "          retention-days: 400\n"), "upload its receipt")
  // A production credential, or an environment, never comes into staging; staging's never into production.
  fails(
    withChange("staging.yml", "secrets.STAGING_CLOUDFLARE_API_TOKEN", "secrets.CLOUDFLARE_API_TOKEN"),
    "outside the production environment",
  )
  fails(
    withChange("staging.yml", "    runs-on: ubuntu-latest\n    env:", "    runs-on: ubuntu-latest\n    environment: production\n    env:"),
    "uses the production environment",
  )
  // Staging's secrets are staging.yml's alone: CI, which runs every pull request, never reads one.
  fails(
    withChange(
      "ci.yml",
      "      - run: npm test\n",
      "      - run: npm test\n        env:\n          T: ${{ secrets.STAGING_CLOUDFLARE_API_TOKEN }}\n",
    ),
    "reads STAGING_CLOUDFLARE_API_TOKEN outside the production environment",
  )
  fails(
    withChange("release.yml", "secrets.CLOUDFLARE_ACCOUNT_ID", "secrets.STAGING_CLOUDFLARE_ACCOUNT_ID"),
    "staging secrets in a production workflow",
  )
  fails(
    withChange("staging.yml", 'npx wrangler deploy --tag "staging-', 'npx wrangler deploy --env production --tag "staging-'),
    "changes production",
  )
})

test("every build that is checked or deployed is searched for curated records first (Phase 7 task 6)", () => {
  // CI builds and checks, staging and the release check before they migrate or deploy.
  fails(withChange("ci.yml", "      - run: node scripts/bundle-check.mjs\n", ""), "ci.yml must build, then run scripts/bundle-check.mjs")
  fails(
    withChange("staging.yml", "      - run: node scripts/bundle-check.mjs\n", ""),
    "staging.yml must build, then run scripts/bundle-check.mjs",
  )
  fails(
    withChange("release.yml", "      - run: node scripts/bundle-check.mjs\n", ""),
    "release.yml must build, then run scripts/bundle-check.mjs",
  )
  // Searched after the migrations: too late, they already ran.
  const source = real["release.yml"]
  const check = "      - run: node scripts/bundle-check.mjs\n"
  const deploy = "      - name: Deploy, the version tagged with the release and its commit\n"
  assert.ok(source.includes(check) && source.includes(deploy))
  fails({ ...real, "release.yml": source.replace(check, "").replace(deploy, check + deploy) }, "before the migrations")
})

// Each deploy's checks wait for the version that deploy tagged and hold the Worker's answers to it (a61): a check
// answered by the previous version would describe a commit other than the one its receipt or release names.
test("the edge checks expect the very tag the deploy gave its version", () => {
  const staging = 'node scripts/edge-check.mjs "$STAGING_PUBLIC_ORIGIN" --expect-tag "staging-${SHA:0:12}"'
  fails(withChange("staging.yml", staging, 'node scripts/edge-check.mjs "$STAGING_PUBLIC_ORIGIN"'), "expect the version it deployed")
  fails(withChange("staging.yml", staging, staging.replace("${SHA:0:12}", "${SHA:0:8}")), "expect the version it deployed")
  const release = 'node scripts/edge-check.mjs "$PUBLIC_ORIGIN" --expect-tag "$RELEASE"'
  fails(withChange("release.yml", release, 'node scripts/edge-check.mjs "$PUBLIC_ORIGIN"'), "expect the version it deployed")
  fails(withChange("release.yml", release, release.replace('"$RELEASE"', '"latest"')), "expect the version it deployed")
})

// Each edge check gets what its checks need from the repository's secrets and variables (staging harness): staging the
// synthetic owners, its named place and the purge exercise, and its receipt from the tested script; the release the
// owners and the workers.dev address that must be refused. Unset, each stays incomplete.
test("the edge checks are given their synthetic owners, place, purge exercise and workers.dev address", () => {
  for (const [line, why] of [
    ["          EDGE_IDENTITIES: ${{ secrets.STAGING_EDGE_IDENTITIES }}\n", "EDGE_IDENTITIES"],
    ["          EDGE_PLACE: ${{ vars.STAGING_EDGE_PLACE }}\n", "EDGE_PLACE"],
    ["          EDGE_PURGE: ${{ secrets.STAGING_EDGE_PURGE }}\n", "EDGE_PURGE"],
    ["          EDGE_PROBE: ${{ secrets.STAGING_EDGE_PROBE }}\n", "EDGE_PROBE"],
  ])
    fails(withChange("staging.yml", line, ""), `staging.yml's edge checks must be given ${why}`)
  fails(withChange("staging.yml", 'node scripts/staging-receipt.mjs "$RUNNER_TEMP/edge.json"', "echo {}"), "upload its receipt")
  fails(
    withChange("release.yml", "          EDGE_IDENTITIES: ${{ secrets.EDGE_IDENTITIES }}\n", ""),
    "release.yml's production checks must be given EDGE_IDENTITIES",
  )
  fails(withChange("release.yml", ' --workers-dev "$WORKERS_DEV_URL"', ""), "release.yml's production checks must be given --workers-dev")
  // Production's purge_freshness comes from the content-free probe, with its own token (L-PURGE).
  fails(
    withChange("release.yml", "          EDGE_PROBE: ${{ secrets.EDGE_PROBE }}\n", ""),
    "release.yml's production checks must be given EDGE_PROBE",
  )
})

test("a failed command inside a pipe fails its step, so no migration runs without the bookmark (P6-BOOKMARK-1)", () => {
  // GitHub runs an unspecified shell as `bash -e {0}`, without pipefail (workflow syntax, jobs.<id>.steps[*].shell).
  fails(withChange("ci.yml", "      - run: npm test\n", "      - run: npm test | tee test.log\n"), "a pipe that hides a failure")
  // The release's own bookmark step, run as GitHub runs it, with a Wrangler that fails and a tee that succeeds.
  const step = parse(real["release.yml"]).jobs.release.steps.find((s) => /time-travel/.test(s.run ?? ""))
  const dir = mkdtempSync(join(tmpdir(), "bookmark-"))
  writeFileSync(join(dir, "npx"), "#!/bin/sh\necho 'no bookmark' >&2\nexit 1\n", { mode: 0o755 })
  const res = spawnSync("bash", ["-e", "-c", step.run], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, RUNNER_TEMP: dir } })
  assert.notEqual(res.status, 0, "the step passed although Wrangler failed")
})

// A release that fails or is cancelled says what it left in production, from its steps' outcomes: a failed final
// check is not proof that nothing was deployed (L-RELEASE-FAIL).
test("a failed release says what it left in production", () => {
  const source = real["release.yml"]
  const step = source.indexOf("      # A release that fails or is cancelled says")
  assert.ok(step > 0)
  fails({ ...real, "release.yml": source.slice(0, step) }, "must end by saying what a failed release left in production")
  fails(withChange("release.yml", "        if: failure() || cancelled()\n", "        if: failure()\n"), "must end by saying")
  for (const id of ["migrate", "deploy", "checks", "publish"])
    fails(withChange("release.yml", `\${{ steps.${id}.outcome }}`, "success"), "must end by saying")
  fails(withChange("release.yml", "        id: deploy\n", "        id: deployed\n"), "must end by saying")
  // The step itself, run as GitHub runs it after the checks failed: the summary says the release is live, unverified.
  const last = parse(real["release.yml"]).jobs.release.steps.at(-1)
  const dir = mkdtempSync(join(tmpdir(), "outcome-"))
  const summary = join(dir, "summary.md")
  writeFileSync(summary, "")
  const env = { RELEASE: "release-2026-11-02", MIGRATED: "success", DEPLOYED: "success", CHECKED: "failure", PUBLISHED: "skipped" }
  const res = spawnSync("bash", ["-e", "-c", last.run], { env: { ...process.env, ...env, GITHUB_STEP_SUMMARY: summary } })
  assert.equal(res.status, 0, String(res.stderr))
  assert.match(readFileSync(summary, "utf8"), /release-2026-11-02 is live in production and not verified/)
  assert.deepEqual(Object.keys(last.env).sort(), ["CHECKED", "DEPLOYED", "MIGRATED", "PUBLISHED"])
})
