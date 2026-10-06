// node --test scripts/ci-policy.test.mjs
import assert from "node:assert/strict"
import { test } from "node:test"
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
  fails(
    withChange("release.yml", "--workflow staging.yml --commit", "--workflow staging.yml --any"),
    "doesn't check staging on that commit",
  )
  fails(withChange("release.yml", '"$SHA" $from --hash', "HEAD $from --hash"), "the manifest's hash for that commit")
  fails(withChange("release.yml", 'git merge-base --is-ancestor "$sha" origin/main', "true"), "the commit being on main")
  fails(withChange("release.yml", '--tag "$RELEASE" --message "release $RELEASE $SHA"', ""), "must run, in order")
})

test("the release runs 14.2's steps in their order", () => {
  const source = real["release.yml"]
  const check = "      - name: Release check\n        run: npm run release:check\n"
  const migrate =
    "      - name: Migrations (expand only; scripts/rollback-check.mjs refuses a rollback across anything else)\n        run: npx wrangler d1 migrations apply DB --remote\n"
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
  fails(
    withChange("rollback.yml", "          node scripts/rollback-check.mjs", "          echo skipped"),
    "must pass scripts/rollback-check.mjs",
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
  fails(withChange("staging.yml", "run: node scripts/edge-check.mjs", "run: echo"), "then run the edge checks")
  // A production credential, or an environment, never comes into staging; staging's never into production.
  fails(
    withChange("staging.yml", "secrets.STAGING_CLOUDFLARE_API_TOKEN", "secrets.CLOUDFLARE_API_TOKEN"),
    "outside the production environment",
  )
  fails(
    withChange("staging.yml", "    runs-on: ubuntu-latest\n    env:", "    runs-on: ubuntu-latest\n    environment: production\n    env:"),
    "uses the production environment",
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
