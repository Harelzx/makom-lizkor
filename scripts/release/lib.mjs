// Shared pieces of the production release (scripts/release/release.mjs) and its rollback: where things live, how to
// run a command and read GitHub, and the private files that never enter the repository.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

export const REPO_SLUG = "Harelzx/makom-lizkor"
export const ORIGIN = "https://makomlizkor.org"
export const OLD_ORIGIN = "https://makom-lizkor.makom-staging.workers.dev"

/** The folder that holds the repository (web/), the release worktrees, agent-evidence/ and .production-private/. */
export function workspace() {
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim()
  return dirname(dirname(common))
}
export const privateDir = (ws) => resolve(ws, ".production-private")

/** The release's private settings: the Cloudflare account, kept out of the public repository. */
export function settings(ws) {
  const file = resolve(privateDir(ws), "release.json")
  assert(existsSync(file), `missing ${file}: {"account_id": "..."}`)
  const s = JSON.parse(readFileSync(file, "utf8"))
  assert(/^[0-9a-f]{32}$/.test(s.account_id ?? ""), "release.json: account_id")
  return s
}

export const readJson = (p) => JSON.parse(readFileSync(p, "utf8"))
export const writeJson = (p, value) => writeFileSync(p, JSON.stringify(value, null, 2) + "\n")

export function gh(path) {
  return JSON.parse(execFileSync("gh", ["api", `repos/${REPO_SLUG}/${path}`], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }))
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** A step's heading, with the time, in the release log. */
export const step = (text) => console.log(`\n== ${new Date().toISOString().slice(11, 19)} ${text}`)

/**
 * A command through the heavy lock (scripts/heavy). It answers 75 while another session holds the lock or the machine
 * stays overloaded; that is a wait, not a failure, so it is tried again for up to `patienceMin` minutes.
 */
export async function heavy(repo, args, { cwd = repo, env = process.env, patienceMin = 60 } = {}) {
  const until = Date.now() + patienceMin * 60_000
  for (;;) {
    const r = spawnSync(resolve(repo, "scripts/heavy"), args, { cwd, env, stdio: "inherit" })
    if (r.status === 0) return
    if (r.status !== 75 || Date.now() > until) throw new Error(`${args.join(" ")} exited ${r.status}`)
    console.log("heavy lock busy or the machine is loaded; trying again in a minute")
    await sleep(60_000)
  }
}

export function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, ...options })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}\n${r.stderr ?? ""}`)
  return r.stdout
}

/** wrangler from the release worktree, against production (never a named environment), in the private account. */
export function wrangler(repo, ws, args) {
  const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: settings(ws).account_id }
  delete env.CLOUDFLARE_ENV
  return spawnSync(process.execPath, [resolve(repo, "node_modules/wrangler/bin/wrangler.js"), ...args], {
    cwd: repo,
    env,
    encoding: "utf8",
    timeout: 240_000,
    maxBuffer: 16 * 1024 * 1024,
  })
}

/** Which version serves production, from `wrangler deployments status --json`: exactly one, at 100%. */
export function serving(repo, ws, config) {
  const r = wrangler(repo, ws, ["deployments", "status", "--json", "--config", config])
  assert.equal(r.status, 0, `deployments status: ${r.stderr}`)
  const json = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")))
  const versions = (json.versions ?? json.deployments?.[0]?.versions ?? []).map((v) => ({
    id: v.version_id ?? v.id,
    percentage: v.percentage,
  }))
  assert(versions.length, "could not read the deployment")
  return { versions, raw: json }
}

/** The version tag production answers with right now (X-Worker-Version), e.g. release-60a872939f5f. */
export async function liveTag() {
  const r = await fetch(`${ORIGIN}/api/v1/version`, { signal: AbortSignal.timeout(20_000), cache: "no-store" })
  await r.body?.cancel()
  const tag = r.headers.get("x-worker-version")
  assert(/^release-[0-9a-f]{12}$/.test(tag ?? ""), `production answered with no release tag: ${tag}`)
  return tag
}

/** Migrations wrangler says are not applied to a production database; none is the only answer a release accepts. */
export function pendingMigrations(repo, ws, config, db) {
  const r = wrangler(repo, ws, ["d1", "migrations", "list", db, "--remote", "--config", config])
  const text = (r.stdout ?? "") + (r.stderr ?? "")
  assert.equal(r.status, 0, `migrations list ${db}: ${text}`)
  const pending = [...new Set(text.match(/\b\d{4}_[a-z0-9_]+\.sql\b/g) ?? [])].sort()
  if (!pending.length) assert(/No migrations to apply/i.test(text), `could not read the migrations list for ${db}`)
  return pending
}
