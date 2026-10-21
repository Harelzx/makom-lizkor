// Releases main to production in one command, from the owner's machine:
//
//   npm run release                      the head of main, once its checks on GitHub have passed
//   npm run release -- --dry-run         everything up to the deploy, then stop (production untouched)
//   npm run release -- --accept-drift=vars.X,limits   a runtime configuration change this release means to make
//
// It waits for the commit's own CI run (the full suite, browsers included) and its staging deploy; builds that exact
// commit in a clean worktree with the real Turnstile sitekey; packages the build and compares its runtime configuration
// with the package production runs now, refusing any change not named in --accept-drift; runs the release blockers;
// reads Access and production's version before, deploys once, and checks the version, the migrations, Access and the
// live site after. A pending migration stops it: migrations are applied by hand, first, and expand-only.
// Evidence goes to ../agent-evidence/release-<sha7>-<date>/; secrets and raw logs stay in ../.production-private/.
// Rollback: scripts/release/rollback.mjs.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import {
  appendFileSync,
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { resolve } from "node:path"
import { snapshot, unchanged } from "./access.mjs"
import { checkLive } from "./live.mjs"
import {
  gh,
  heavy,
  liveTag,
  pendingMigrations,
  privateDir,
  readJson,
  run,
  serving,
  settings,
  sleep,
  step,
  workspace,
  wrangler,
  writeJson,
} from "./lib.mjs"

const argv = process.argv.slice(2)
const dryRun = argv.includes("--dry-run")
const acceptDrift = (argv.find((a) => a.startsWith("--accept-drift="))?.split("=")[1] ?? "").split(",").filter(Boolean)
const asked = argv.find((a) => /^[0-9a-f]{40}$/.test(a))

const ws = workspace()
settings(ws)
const secretsFile = resolve(privateDir(ws), "production-secrets.json")
assert.equal(statSync(secretsFile).mode & 0o777, 0o600, "the secrets file must be private (600)")

step("what to release")
const main = gh("git/ref/heads/main").object.sha
const SHA = asked ?? main
assert.equal(SHA, main, "only the head of main is released")
const short = SHA.slice(0, 12)
const tag = `release-${short}`
const priorTag = await liveTag()
// A dry run goes on even then: the whole path up to the deploy, as a check of the script and of production's state.
if (priorTag === tag && !dryRun) {
  console.log(`${tag} is already live`)
  process.exit(0)
}
const evidence = resolve(
  ws,
  "agent-evidence",
  `release-${SHA.slice(0, 7)}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}${dryRun ? "-dry-run" : ""}`,
)
// A dry run's folder is its own, and starts empty each time; a real release's is never reused once it has deployed.
if (dryRun) rmSync(evidence, { recursive: true, force: true })
assert(!existsSync(resolve(evidence, "production-deploy-result.json")), `${evidence} already has a deploy`)
mkdirSync(evidence, { recursive: true })
const log = resolve(evidence, "release.log")
const print = console.log
console.log = (...a) => {
  print(...a)
  appendFileSync(log, a.join(" ") + "\n")
}
console.log(JSON.stringify({ sha: SHA, tag, live: priorTag, dry_run: dryRun, accept_drift: acceptDrift }))

step("checks on GitHub for this commit")
const runs = await gates(SHA)
console.log(JSON.stringify(runs))

step("worktree at the commit")
const tree = resolve(ws, `release-${SHA.slice(0, 7)}`)
if (!existsSync(tree)) run("git", ["worktree", "add", "--detach", tree, SHA], { stdio: ["ignore", "pipe", "inherit"] })
assert.equal(run("git", ["rev-parse", "HEAD"], { cwd: tree }).trim(), SHA)
assert.equal(run("git", ["status", "--porcelain"], { cwd: tree }).trim(), "", "the release worktree is not clean")

step("install and build with the real Turnstile sitekey")
await heavy(tree, ["npm", "ci", "--no-audit", "--no-fund"])
const sitekey = readJson(resolve(privateDir(ws), "cloudflare/turnstile.json")).sitekey
await heavy(tree, ["npm", "run", "build"], { env: { ...process.env, VITE_TURNSTILE_SITEKEY: sitekey } })
run(process.execPath, ["scripts/bundle-check.mjs"], { cwd: tree, stdio: ["ignore", "inherit", "inherit"] })

step("package, and its runtime configuration against production's")
const pkg = resolve(evidence, `package-${short}`)
assert(!existsSync(pkg), `${pkg} already exists`)
cpSync(resolve(tree, "dist/client"), resolve(pkg, "client"), { recursive: true })
cpSync(resolve(tree, "dist/makom_lizkor"), resolve(pkg, "worker"), { recursive: true })
for (const name of ["worker/.dev.vars", "worker/.vite"]) rmSync(resolve(pkg, name), { recursive: true, force: true })
const configPath = resolve(pkg, "worker/wrangler.json")
const config = readJson(configPath)
for (const [key, expected] of Object.entries({
  configPath: resolve(tree, "wrangler.jsonc"),
  userConfigPath: resolve(tree, "wrangler.jsonc"),
  topLevelName: "makom-lizkor",
  definedEnvironments: ["development", "staging"],
})) {
  assert.deepEqual(config[key], expected, `unexpected build metadata: ${key}`)
  delete config[key]
}
for (const binding of config.d1_databases) {
  assert.equal(resolve(tree, "dist/makom_lizkor", binding.migrations_dir), resolve(tree, "migrations"))
  binding.migrations_dir = resolve(tree, "migrations")
}
const priorPackage = findPackage(priorTag.slice("release-".length))
const prior = readJson(resolve(priorPackage, "worker/wrangler.json"))
for (const binding of prior.d1_databases) binding.migrations_dir = resolve(tree, "migrations")
const drift = differences(canonical(config), canonical(prior))
console.log(JSON.stringify({ prior_package: priorPackage, drift }))
const unasked = drift.filter((k) => !acceptDrift.includes(k))
assert.deepEqual(
  unasked,
  [],
  `runtime configuration differs from production's in ${unasked.join(", ")}; name each with --accept-drift if meant`,
)
writeJson(configPath, config)
const secrets = readJson(secretsFile)
const files = {}
for (const p of walk(pkg)) {
  const data = readFileSync(p)
  for (const value of Object.values(secrets)) assert(!data.includes(String(value)), `secret in package: ${p}`)
  assert(!p.includes("/photos/") && !p.includes("curated-launch"), `curated source in package: ${p}`)
  // The Worker's CSP-report classifier names the old hosts on purpose; the client must not ask them for anything.
  if (p.startsWith(resolve(pkg, "client")))
    assert(!data.includes("openfreemap") && !data.includes("amazonaws"), `outside tile host in ${p}`)
  files[p.slice(pkg.length + 1)] = createHash("sha256").update(data).digest("hex")
}
assert(
  readdirSync(resolve(pkg, "client/assets")).some(
    (f) => f.endsWith(".js") && readFileSync(resolve(pkg, "client/assets", f), "utf8").includes(sitekey),
  ),
  "the real Turnstile sitekey is not in the build",
)
const terrain = (dir) => readdirSync(resolve(dir, "client/assets")).filter((f) => f.startsWith("terrain-1.")).length
assert.equal(terrain(pkg), terrain(priorPackage), "the terrain files differ from production's")
writeJson(resolve(evidence, "package.json"), {
  at: new Date().toISOString(),
  source_sha: SHA,
  directory: pkg,
  prior_package: priorPackage,
  drift,
  files,
})

step("release blockers on the packaged configuration")
await blockers(tree, config, secrets)

step("before: Access, the serving version, migrations")
writeJson(resolve(evidence, "access-before.json"), await snapshot(ws, tree, config))
const before = serving(tree, ws, configPath)
assert.equal(before.versions.length, 1, "production is split across versions")
assert.equal(before.versions[0].percentage, 100)
writeJson(resolve(evidence, "deployment-before.json"), { at: new Date().toISOString(), tag: priorTag, ...before })
for (const db of ["DB", "DRILL_DB"])
  assert.deepEqual(pendingMigrations(tree, ws, configPath, db), [], `${db}: a migration is pending; apply it first`)
console.log(JSON.stringify({ serving: before.versions[0].id, tag: priorTag, migrations_pending: 0 }))

if (dryRun) {
  step("dry run: stopping before the deploy; production is unchanged")
  process.exit(0)
}

step("deploy (one attempt)")
const marker = resolve(privateDir(ws), `release-deploy-${short}-attempt.json`)
closeSync(openSync(marker, "wx", 0o600))
writeJson(marker, { at: new Date().toISOString(), sha: SHA, runs, phase: "started" })
const message = `Release ${short}: ${subject(tree)}`.slice(0, 100)
const deployed = wrangler(tree, ws, [
  "deploy",
  "--config",
  configPath,
  "--secrets-file",
  secretsFile,
  "--tag",
  tag,
  "--message",
  message,
  "--strict",
])
const raw = (deployed.stdout ?? "") + "\n" + (deployed.stderr ?? "")
writeFileSync(resolve(privateDir(ws), `release-deploy-${short}.log`), raw, { mode: 0o600 })
let safe = raw
for (const value of Object.values(secrets)) safe = safe.split(String(value)).join("[REDACTED]")
writeFileSync(resolve(evidence, "production-deploy.log"), safe)
const version = safe.match(/Current Version ID:\s*([0-9a-f-]{36})/)?.[1] ?? null
writeJson(resolve(evidence, "production-deploy-result.json"), {
  at: new Date().toISOString(),
  sha: SHA,
  tag,
  message,
  exit_code: deployed.status,
  version,
})
assert.equal(deployed.status, 0, "the deploy failed; see production-deploy.log")

step("after: the serving version, migrations, Access")
await sleep(20_000)
const after = serving(tree, ws, configPath)
assert.deepEqual(after.versions, [{ id: version, percentage: 100 }], "production does not serve the version just deployed")
writeJson(resolve(evidence, "deployment-after.json"), { at: new Date().toISOString(), tag, ...after })
for (const db of ["DB", "DRILL_DB"])
  assert.deepEqual(pendingMigrations(tree, ws, configPath, db), [], `${db}: a migration is pending after the deploy`)
const accessAfter = await snapshot(ws, tree, config)
writeJson(resolve(evidence, "access-after.json"), accessAfter)
unchanged(readJson(resolve(evidence, "access-before.json")), accessAfter)

step("live checks")
let live
for (let attempt = 1; ; attempt++)
  try {
    live = await checkLive(tree, pkg, tag, SHA)
    break
  } catch (error) {
    // The edge may still answer from the previous version for a few seconds; anything else is a failure.
    if (attempt === 3 || !/live version is not this release/.test(String(error))) throw error
    await sleep(20_000)
  }
writeJson(resolve(evidence, "live-checks.json"), live)
console.log(
  JSON.stringify({ tag, live: true, places: live.places, checks: live.checks, previous: priorTag, rollback: before.versions[0].id }),
)
step(`done: ${tag} is live`)

/** The commit's CI run on main (the full suite: browsers, WebKit and coverage, not skipped) and its staging deploy. */
async function gates(sha) {
  const wait = async (workflow, query) => {
    const until = Date.now() + 90 * 60_000
    for (;;) {
      const found = gh(`actions/workflows/${workflow}/runs?head_sha=${sha}${query}&per_page=5`).workflow_runs[0]
      if (found?.status === "completed") return found
      assert(Date.now() < until, `${workflow} did not finish for ${sha}`)
      console.log(`${workflow}: ${found ? found.status : "not started"}; waiting`)
      await sleep(30_000)
    }
  }
  const jobs = (id) => Object.fromEntries(gh(`actions/runs/${id}/jobs?per_page=100`).jobs.map((j) => [j.name, j.conclusion]))
  const ci = await wait("ci.yml", "&event=push&branch=main")
  assert.equal(ci.conclusion, "success", `ci ${ci.id}: ${ci.conclusion}`)
  const ciJobs = jobs(ci.id)
  for (const name of ["ready", "webkit", "regression / browser (1)", "regression / browser (2)", "regression / coverage"])
    assert.equal(ciJobs[name], "success", `ci ${ci.id}: ${name} ${ciJobs[name]}`)
  const staging = await wait("staging.yml", "")
  assert.equal(staging.conclusion, "success", `staging ${staging.id}: ${staging.conclusion}`)
  assert.equal(jobs(staging.id).deploy, "success", `staging ${staging.id}: deploy not run`)
  return { ci: ci.id, staging: staging.id }
}

/** The package production runs now, by the commit its tag names, among the evidence of earlier releases. */
function findPackage(priorShort) {
  const base = resolve(ws, "agent-evidence")
  const found = readdirSync(base)
    .filter((d) => resolve(base, d) !== evidence)
    .map((d) => resolve(base, d, `package-${priorShort}`))
    .filter((p) => existsSync(resolve(p, "worker/wrangler.json")))
  assert.equal(found.length, 1, `production's package (package-${priorShort}) not found once in agent-evidence`)
  return found[0]
}

function canonical(c) {
  const copy = JSON.parse(JSON.stringify(c))
  copy.ratelimits = [...(copy.ratelimits ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  return copy
}

/** The keys that differ: top-level ones by name, and each var as vars.NAME. */
function differences(a, b) {
  const out = []
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (key === "vars") {
      for (const name of new Set([...Object.keys(a.vars ?? {}), ...Object.keys(b.vars ?? {})]))
        if (JSON.stringify(a.vars?.[name]) !== JSON.stringify(b.vars?.[name])) out.push(`vars.${name}`)
    } else if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) out.push(key)
  }
  return out.sort()
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)]))
}

/** The repository's release blockers, from the commit being released, on the configuration that will be deployed. */
async function blockers(tree, config, secrets) {
  const load = (p) => import(resolve(tree, p))
  const { registryBlockers, readRegistry } = await load("scripts/access-registry.mjs")
  const { mailBlockers } = await load("scripts/release-mail.mjs")
  const { moderatorBlockers } = await load("scripts/release-moderators.mjs")
  const { retentionScaleBlockers } = await load("scripts/release-retention-scale.mjs")
  const { cacheBlockers } = await load("scripts/release-cache.mjs")
  const { backupBlockers } = await load("scripts/release-backup.mjs")
  const { MAIL_BINDING, PRODUCTION_MAIL_SENDS } = await load("worker/lib/mail-binding.ts")
  const groups = {
    mail: mailBlockers(config, { binding: MAIL_BINDING, sends: PRODUCTION_MAIL_SENDS }),
    moderators: moderatorBlockers(config),
    retention: retentionScaleBlockers(config),
    cache: cacheBlockers(config),
    backup: backupBlockers(config),
    registry: registryBlockers(readRegistry(), [config.vars.MODERATORS]),
  }
  for (const [group, problems] of Object.entries(groups)) assert.deepEqual(problems, [], group)
  assert.equal(config.limits.cpu_ms, 30000)
  assert.equal(config.vars.EDGE_CACHE, "off")
  assert.equal(config.vars.PUBLIC_ORIGIN, "https://makomlizkor.org")
  assert.deepEqual(config.routes, [{ pattern: "makomlizkor.org", custom_domain: true }])
  assert.equal(config.workers_dev, true)
  assert.deepEqual(Object.keys(secrets).sort(), [...config.secrets.required].sort(), "secret names differ from the config")
  console.log(JSON.stringify({ blockers: "none" }))
}

/** What the commit says it is: a merge's pull request title, or the commit's own subject. */
function subject(tree) {
  const [first, , title] = execFileSync("git", ["log", "-1", "--format=%s%n%n%b"], { cwd: tree, encoding: "utf8" }).split("\n")
  return /^Merge pull request #\d+/.test(first) && title ? title : first
}
