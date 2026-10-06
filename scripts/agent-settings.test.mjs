// node --test scripts/agent-settings.test.mjs
// The deny rules in .claude/settings.json (spec 12.2, adviser a49): a guardrail in the agents' harness, not isolation.
// Each command form this project uses to release, roll back, read production's logs or sign in must match a rule, and
// the everyday ones must not. Matching follows Claude Code's documented rules (code.claude.com/docs/en/permissions,
// read 2026-10-06): each subcommand of a compound line on its own, past leading variable assignments, `*` for any
// text, and a trailing " *" also matching the bare command. Nothing here runs the commands.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const settings = JSON.parse(readFileSync(new URL("../.claude/settings.json", import.meta.url), "utf8"))
const deny = settings.permissions.deny.map((r) => r.match(/^Bash\((.*)\)$/)[1])

const ruleRegex = (pattern) => {
  const trailing = pattern.endsWith(" *")
  const body = (trailing ? pattern.slice(0, -2) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*")
  return new RegExp(`^${body}${trailing ? "( .*)?" : ""}$`, "s")
}
const subcommands = (line) =>
  line
    .split(/&&|\|\||;|\||\n/)
    .map((c) => c.trim().replace(/^(\w+=\S*\s+)+/, ""))
    .filter(Boolean)
const denied = (line) => subcommands(line).some((c) => deny.some((p) => ruleRegex(p).test(c)))

test("the settings stay valid, and the hooks every session relies on are all still there", () => {
  for (const event of ["PreToolUse", "SessionStart", "UserPromptSubmit", "PostToolUse"])
    assert.match(JSON.stringify(settings.hooks[event]), /scripts\/parallel\/hook\.mjs/, event)
  assert.deepEqual(Object.keys(settings).sort(), ["hooks", "permissions"])
  assert.deepEqual(Object.keys(settings.permissions), ["deny"])
})

test("every way this project releases, rolls back, reads production's logs or signs in is denied", () => {
  for (const line of [
    "npx wrangler deploy",
    'npx wrangler deploy --tag "$RELEASE" --message "release $RELEASE $SHA"',
    "wrangler deploy",
    "cd web && CLOUDFLARE_API_TOKEN=x npx wrangler deploy",
    "npx wrangler versions deploy --version-tag release-2026-11-02 --yes",
    "npx wrangler rollback 095f00a7-23a7-43b7-a227-e4c97cab5f22",
    "npx wrangler tail",
    "wrangler tail makom-lizkor --format json",
    "npx wrangler login",
    "gh workflow run release.yml -f release=release-2026-11-02",
    "gh workflow run release -f release=release-2026-11-02",
    "gh workflow run --ref main rollback.yml -f to_release=release-2026-11-02",
    "gh api -X POST repos/o/r/actions/workflows/release.yml/dispatches -f ref=main",
    "gh api repos/o/r/actions/workflows/rollback.yml/dispatches",
    "gh release edit release-2026-11-02 --draft=false",
    "git tag release-2026-11-02 4971b21",
    "git tag -a release-2026-11-02 -m x",
    "git push origin release-2026-11-02",
    "git push --tags",
  ])
    assert.ok(denied(line), line)
})

test("everyday commands stay allowed", () => {
  for (const line of [
    "npx wrangler types",
    "npm run cf-typegen",
    "npx wrangler d1 migrations apply makom-dev --local --persist-to .wrangler/e2e-state-dev",
    "npx wrangler deployments status",
    "npx wrangler versions list",
    "gh run list --workflow ci.yml",
    "gh workflow list",
    "gh release create release-2026-11-02 --draft --target 4971b21 manifest.json",
    "git tag",
    "git push origin claude/system-architecture-design-9a660f",
    "scripts/heavy npm test",
    "npm run build",
  ])
    assert.ok(!denied(line), line)
})
