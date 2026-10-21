// Puts production back on the version it served before the last release, then checks that it answers as that release.
//
//   npm run release:rollback                 the last release with a deploy in ../agent-evidence
//   npm run release:rollback -- <evidence>   a given release's evidence folder
//
// Code only: a rollback never undoes a migration (they are expand-only, so the older code still runs on the newer
// database) or Access. Not yet exercised on production: until it is, read what it prints before trusting it.
import assert from "node:assert/strict"
import { existsSync, readdirSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { liveTag, readJson, sleep, step, workspace, wrangler, writeJson } from "./lib.mjs"

const ws = workspace()
const base = resolve(ws, "agent-evidence")
const evidence =
  process.argv[2] ??
  readdirSync(base)
    .map((d) => resolve(base, d))
    .filter((d) => existsSync(resolve(d, "production-deploy-result.json")) && existsSync(resolve(d, "deployment-before.json")))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
assert(evidence, "no release with a deploy found in agent-evidence")
const deployed = readJson(resolve(evidence, "production-deploy-result.json"))
const before = readJson(resolve(evidence, "deployment-before.json"))
const target = before.versions?.[0]?.id
assert(target && before.tag, "the release's before snapshot names no version")

step(`rollback: ${deployed.tag} back to ${before.tag} (${target})`)
assert.equal(await liveTag(), deployed.tag, "production is not on that release's version; nothing is rolled back")
// The release worktree is gone or reused; wrangler from this checkout is enough for a rollback.
const repo = resolve(ws, "web")
const config = resolve(evidence, readJson(resolve(evidence, "package.json")).directory, "worker/wrangler.json")
const r = wrangler(repo, ws, ["rollback", target, "--config", config, "--message", `Rollback of ${deployed.tag} to ${before.tag}`, "--yes"])
console.log((r.stdout ?? "") + (r.stderr ?? ""))
assert.equal(r.status, 0, "the rollback failed")

step("check")
for (let i = 0; i < 6 && (await liveTag()) !== before.tag; i++) await sleep(10_000)
assert.equal(await liveTag(), before.tag, "production does not answer as the earlier release")
writeJson(resolve(evidence, "rollback-result.json"), { at: new Date().toISOString(), from: deployed.tag, to: before.tag, version: target })
step(`done: production is back on ${before.tag}`)
