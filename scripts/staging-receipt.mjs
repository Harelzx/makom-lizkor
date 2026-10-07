// The receipt staging.yml uploads for a commit's deploy (scripts/staging-evidence.mjs reads it for a release), built
// from the edge check's own report: the commit, the tag its deploy gave the version, the run, the overall word, the
// tag the checks were held to (edge-check --expect-tag) and each check's own result. Ids and statuses only.
//   node scripts/staging-receipt.mjs <edge.json>   (SHA and GITHUB_RUN_ID from the environment)
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

export function receiptFor(report, env) {
  if (report.mode !== "deployment") throw new Error("the edge report isn't a deployment's")
  if (!report.expect_tag) throw new Error("the edge check ran without --expect-tag: its answers weren't held to a version")
  return {
    sha: env.SHA,
    tag: `staging-${env.SHA.slice(0, 12)}`,
    run_id: Number(env.GITHUB_RUN_ID),
    edge: report.outcome,
    expect_tag: report.expect_tag,
    checks: Object.fromEntries(report.results.map((r) => [r.check, r.status])),
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(receiptFor(JSON.parse(readFileSync(process.argv[2], "utf8")), process.env)))
