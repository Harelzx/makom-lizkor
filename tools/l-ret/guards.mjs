// These evidence tools are deliberately bound to the authorized synthetic staging deployment.
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"

export const STAGING_ORIGIN = "https://makom-lizkor-staging.makom-staging.workers.dev"
export const STAGING_ACCOUNT = "8f355daed33cf31c238047e6b455ec9a"
export const STAGING_DATABASE = "6cebc14f-18b1-41fd-9d21-fd885e71ce25"

export function stagingOrigin(base) {
  const u = new URL(base)
  if (u.origin !== STAGING_ORIGIN || u.username || u.password || u.pathname !== "/" || u.search || u.hash)
    throw new Error("This tool accepts only the authorized staging origin")
  return u.origin
}

export function stagingAccount(reply) {
  if (!reply?.success || !Array.isArray(reply.result) || reply.result.filter((a) => a.id === STAGING_ACCOUNT).length !== 1)
    throw new Error("The authorized staging account is not available")
  return STAGING_ACCOUNT
}

export function stagingDatabase(reply) {
  if (!reply?.success || !Array.isArray(reply.result)) throw new Error("Staging database lookup failed")
  const matches = reply.result?.filter((d) => d.name === "makom-staging" && d.uuid === STAGING_DATABASE)
  if (matches?.length !== 1) throw new Error("The authorized staging database was not found exactly once")
  return matches[0]
}

export function stagingRequester(base, machine, tag, request = fetch) {
  const origin = stagingOrigin(base)
  if (!machine?.["CF-Access-Client-Id"] || !machine?.["CF-Access-Client-Secret"] || !/^staging-[a-f0-9]{12}$/.test(tag ?? ""))
    throw new Error("A complete staging Access pair and staging version tag are required")
  return async (path, init = {}) => {
    const url = new URL(path, origin)
    if (url.origin !== origin) throw new Error("A staging request cannot leave its authorized origin")
    const res = await request(url, { ...init, redirect: "manual", headers: { ...machine, ...(init.headers ?? {}) } })
    if (res.headers.get("X-Worker-Version") !== tag) throw new Error("The staging version does not match the expected deployment")
    const text = await res.text()
    let body = null
    try {
      body = JSON.parse(text)
    } catch {
      /* Non-JSON refusal responses remain status-only. */
    }
    return { status: res.status, body }
  }
}

export function assertTables(payload, manifest) {
  assert.deepEqual(Object.keys(payload.tables).sort(), Object.keys(manifest.tables).sort(), "Export table names differ")
  for (const [name, table] of Object.entries(manifest.tables)) {
    assert.ok(Array.isArray(payload.tables[name]), `Export rows are not an array for ${name}`)
    assert.equal(payload.tables[name]?.length, table.rows, `Export row count differs for ${name}`)
  }
}

export function assertDrill(run, left, exportId, notifications) {
  assert.equal(run?.ok, 1, "The restore drill did not succeed")
  assert.equal(run.export_id, exportId, "The drill used a different export")
  assert.ok(Object.keys(left).length > 0, "No drill cleanup counts were checked")
  for (const [table, count] of Object.entries(left)) assert.equal(count, 0, `The drill left data in ${table}`)
  assert.equal(notifications.length, 0, "The drill or export audit reported a failure")
}

export function assertCohort(item, restored, marked, at) {
  assert.ok(Number.isFinite(at.getTime()), "Invalid restore time")
  if (["returned", "rejected"].includes(item.role)) assert.ok(Number.isFinite(Date.parse(item.deadline)), "Missing cohort deadline")
  const expired = ["returned", "rejected"].includes(item.role) && Date.parse(item.deadline) <= at.getTime()
  const expected = expired ? "erased" : item.role
  assert.equal(restored?.status, expected, `Unexpected restored state for ${item.role}`)
  if (expired) assert.equal(restored.erased_reason, `${item.role}_expired`, "Unexpected expiry reason")
  if (expired || item.role === "withdrawn") assert.equal(marked, 0, "Removed cohort text returned")
  else assert.ok(marked > 0, `The ${item.role} cohort text is missing`)
}

// Register immediately, so setup/build/migration failures also remove their temporary directories.
export function temporaryDirectories(root = process.env.TMPDIR ?? "/tmp") {
  const dirs = []
  return {
    create(prefix) {
      const dir = mkdtempSync(join(root, prefix))
      dirs.push(dir)
      return dir
    },
    cleanup() {
      const errors = []
      for (const dir of dirs.reverse()) {
        try {
          rmSync(dir, { recursive: true, force: true })
        } catch (error) {
          errors.push(error)
        }
      }
      if (errors.length) throw new AggregateError(errors, "Temporary directory cleanup failed")
    },
  }
}
