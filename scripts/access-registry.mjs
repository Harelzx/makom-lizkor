// The access registry (docs/access-registry.json): every person who may use the database, and each way in. The
// database is run as an individual's, so it holds the operator and at most two more; anyone who can read the Worker's
// secrets can open every export through the drill's key, so a Cloudflare account member is one of the three too.
// `registryProblems` is the structure, which CI checks on every change; `registryBlockers` adds what only go-live can
// give (real names), and release:check runs both.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { MAX_MODERATORS } from "./release-moderators.mjs"

export const PERMISSIONS = {
  cloudflare_account: "a member of the Cloudflare account (reads Worker secrets, so can open exports with the drill key)",
  access_identity: "signs in to the moderators' page through Access",
  mailbox: "reads the project mailbox",
  release_approver: "approves a release",
  backup_private_key: "holds the private key that opens exports",
}
// Who must hold these: the operator answers for the database, its backups and its releases.
const OWNER_HOLDS = ["cloudflare_account", "release_approver", "backup_private_key"]

export function registryProblems(reg) {
  const problems = []
  const people = Array.isArray(reg?.people) ? reg.people : []
  const ids = people.map((p) => p?.id)
  if (!people.length) return ["the registry names no one"]
  if (new Set(ids).size !== ids.length) problems.push("a person is listed twice")
  if (people.length > MAX_MODERATORS) problems.push(`${people.length} people: the database may have the operator and at most two more`)
  if (people[0]?.id !== "owner") problems.push("the first person must be the operator, with id 'owner'")
  const perms = reg?.permissions ?? {}
  for (const key of Object.keys(perms)) if (!(key in PERMISSIONS)) problems.push(`unknown permission '${key}'`)
  for (const key of Object.keys(PERMISSIONS)) {
    const holders = perms[key]
    if (!Array.isArray(holders) || !holders.length) problems.push(`no one holds '${key}'`)
    else for (const h of holders) if (!ids.includes(h)) problems.push(`'${key}' is held by '${h}', who isn't in the registry`)
  }
  for (const key of OWNER_HOLDS)
    if (Array.isArray(perms[key]) && !perms[key].includes("owner")) problems.push(`the operator must hold '${key}'`)
  for (const id of ids)
    if (!Object.values(perms).some((h) => Array.isArray(h) && h.includes(id))) problems.push(`'${id}' holds nothing: remove them`)
  return problems
}

/** At release: the structure, real names, and no more moderators' addresses than people who sign in through Access. */
export function registryBlockers(reg, moderators) {
  const blockers = registryProblems(reg).map((p) => `access registry: ${p}`)
  for (const p of reg?.people ?? [])
    if (!p?.name || /^\[.*\]$/.test(p.name.trim())) blockers.push(`access registry: '${p?.id}' has no real name yet`)
  const signIns = (reg?.permissions?.access_identity ?? []).length
  if (moderators.length > signIns)
    blockers.push(`MODERATORS has ${moderators.length} addresses, but only ${signIns} people in the access registry sign in through Access`)
  return blockers
}

export const readRegistry = () => JSON.parse(readFileSync(new URL("../docs/access-registry.json", import.meta.url), "utf8"))

// node scripts/access-registry.mjs: the CI check.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = registryProblems(readRegistry())
  if (problems.length) {
    console.error("Access registry:\n" + problems.map((p) => `  - ${p}`).join("\n"))
    process.exit(1)
  }
  console.log("Access registry: well formed.")
}
