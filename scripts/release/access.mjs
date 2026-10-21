// Read-only views of production's Access before and after a release, compared whole: nothing here writes to Cloudflare.
// The API read uses the owner's read-only token from the Keychain ("makom-production-access-read": Access apps and
// policies, read); without it only the anonymous probe is compared. The token stays in memory.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { ORIGIN, settings } from "./lib.mjs"

const PUBLIC = ["/", "/favicon.svg", "/og.png", "/api/v1/version", "/place/nahal-oz-observers-memorial", "/licenses/fonts/"]
const PRIVATE = [
  "/admin/",
  "/api/admin/queue",
  "/api/admin/summary",
  "/api/admin/health",
  "/api/ops/summary",
  "/api/v1/health",
  "/__dev/login",
  "/preview-login",
  "/api/admin/commissioning/snapshot",
]

async function api(ws, app) {
  let token
  try {
    token = execFileSync("security", ["find-generic-password", "-s", "makom-production-access-read", "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return { available: false, reason: "no read token in the Keychain" }
  }
  const account = settings(ws).account_id
  const get = async (path) => {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    return { ...(await r.json()), status: r.status }
  }
  const [apps, one, policies] = await Promise.all([
    get("/access/apps?page=1&per_page=1000"),
    get(`/access/apps/${app}`),
    get(`/access/apps/${app}/policies`),
  ])
  const refused = [apps, one, policies].filter((r) => !r.success).flatMap((r) => (r.errors ?? []).map((e) => e.code))
  if (refused.length) return { available: false, reason: "Access read refused: " + JSON.stringify(refused) }
  return { available: true, apps, app: one, policies }
}

/** Every public path answers, every private one asks for a sign-in, as anyone sees it. */
async function probe() {
  const rows = []
  for (const path of [...PUBLIC, ...PRIVATE]) {
    const r = await fetch(ORIGIN + path, { redirect: "manual", signal: AbortSignal.timeout(20_000) })
    rows.push({ path, expected: PUBLIC.includes(path) ? "public" : "private", status: r.status })
    await r.body?.cancel()
  }
  for (const row of rows) {
    if (row.expected === "public") assert.equal(row.status, 200, `public path not open: ${row.path} ${row.status}`)
    else assert([302, 303, 401, 403].includes(row.status), `private path open: ${row.path} ${row.status}`)
  }
  return rows
}

/** A snapshot; with the API readable, it must also satisfy the release rules for this package's config. */
export async function snapshot(ws, repo, config) {
  const { WORKERS_ACCESS, workersAccessProblems } = await import(resolve(repo, "scripts/release-workers-access.mjs"))
  const taken = { observed_at: new Date().toISOString(), api: await api(ws, WORKERS_ACCESS.app), probe: await probe() }
  if (taken.api.available)
    assert.deepEqual(
      workersAccessProblems(config, { observed_at: taken.observed_at, ...taken.api }, { phase: "public" }),
      [],
      "Access differs from the release rules",
    )
  return taken
}

export function unchanged(before, after) {
  assert.deepEqual(after.probe, before.probe, "anonymous Access behaviour changed")
  assert.equal(after.api.available, before.api.available)
  if (before.api.available) {
    assert.deepEqual(after.api.app.result, before.api.app.result, "Access app changed")
    assert.deepEqual(after.api.policies.result, before.api.policies.result, "Access policies changed")
    assert.deepEqual(after.api.apps.result, before.api.apps.result, "Access apps changed")
  }
}
