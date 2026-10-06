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
  assert.deepEqual(Object.keys(real).sort(), ["ci.yml", "release.yml", "rollback.yml"])
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
