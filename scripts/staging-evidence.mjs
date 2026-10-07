// Whether staging passed on the commit a release names (spec 14.2; adviser a51, P6-STAGING-1). The evidence is the
// receipt staging.yml uploads as its deploy job's last step (so it exists only if every step before it passed),
// named for the commit it deployed: release.yml fetches it and its run through the GitHub API, and this decides.
// A run's own head_sha is never read: for a workflow_run trigger GitHub sets it to the default branch's last commit
// (events that trigger workflows, workflow_run), not the commit the run checked out and deployed.
//   node scripts/staging-evidence.mjs run-id <sha> <artifacts.json>
//   node scripts/staging-evidence.mjs check <sha> <artifacts.json> <run.json> <receipt.json>
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

const STAGING = ".github/workflows/staging.yml"
/**
 * Every check the edge check makes against a deployment, each of which must have passed (scripts/edge-check.mjs). The
 * receipt carries each one's own result, so a release never rests on an overall word alone.
 */
export const REQUIRED_CHECKS = [
  "responses",
  "headers",
  "private_no_store",
  "private_isolation",
  "place_page",
  "no_shared_hit",
  "purge_freshness",
  "workers_dev_closed",
  "deployed_version",
]

/** The run that uploaded this commit's newest unexpired receipt; there is none, the release has no staging evidence. */
export function receiptRun(artifacts, sha) {
  const found = (artifacts?.artifacts ?? [])
    .filter((a) => a.name === `staging-receipt-${sha}` && !a.expired)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]
  if (!found) throw new Error(`no staging receipt for ${sha}`)
  return found.workflow_run.id
}

export function stagingEvidenceProblems({ sha, artifacts, run, receipt }) {
  const problems = []
  const id = receiptRun(artifacts, sha)
  if (run.id !== id) problems.push(`the run read is ${run.id}, not the receipt's ${id}`)
  if (run.path !== STAGING) problems.push("the receipt's run is not staging.yml's")
  if (run.status !== "completed" || run.conclusion !== "success")
    problems.push(`the staging run is ${run.status}/${run.conclusion}, not completed/success`)
  if (receipt.sha !== sha) problems.push(`the receipt names ${receipt.sha}, not ${sha}`)
  if (receipt.run_id !== id) problems.push(`the receipt was written by run ${receipt.run_id}, not run ${id}`)
  if (receipt.edge !== "pass") problems.push(`staging's edge check was ${receipt.edge}, not passed`)
  // Its checks were held to the version this commit's deploy tagged (edge-check --expect-tag), not some other one.
  const tag = `staging-${sha.slice(0, 12)}`
  if (receipt.expect_tag !== tag) problems.push(`the receipt's checks weren't held to ${tag} (${receipt.expect_tag})`)
  for (const c of REQUIRED_CHECKS)
    if (receipt.checks?.[c] !== "pass") problems.push(`staging's ${c} was ${receipt.checks?.[c] ?? "missing"}, not passed`)
  return problems
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, sha, ...files] = process.argv.slice(2)
  const json = (f) => JSON.parse(readFileSync(f, "utf8"))
  try {
    if (command === "run-id" && files.length === 1) console.log(receiptRun(json(files[0]), sha))
    else if (command === "check" && files.length === 3) {
      const problems = stagingEvidenceProblems({ sha, artifacts: json(files[0]), run: json(files[1]), receipt: json(files[2]) })
      if (problems.length) throw new Error(problems.join("; "))
      console.log(`Staging passed on ${sha}.`)
    } else {
      console.error(
        "usage: node scripts/staging-evidence.mjs run-id <sha> <artifacts.json> | check <sha> <artifacts.json> <run.json> <receipt.json>",
      )
      process.exit(2)
    }
  } catch (e) {
    console.error(`Staging evidence refused: ${e.message}`)
    process.exit(1)
  }
}
