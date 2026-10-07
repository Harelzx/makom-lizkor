// Read-only: the scheduled (cron) invocations of staging's Worker since a moment, from Cloudflare's GraphQL analytics
// (workersInvocationsScheduled): when, status, CPU. Nothing secret printed.
//   node tools/l-ret/cron-runs.mjs <since ISO>
import { execFileSync } from "node:child_process"
const since = process.argv[2]
const tok = execFileSync("security", ["find-generic-password", "-s", "makom-staging-cloudflare", "-w"], { encoding: "utf8" }).trim()
const cf = (p, init = {}) =>
  fetch(`https://api.cloudflare.com/client/v4${p}`, {
    ...init,
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
  }).then((r) => r.json())
const acct = (await cf("/accounts")).result[0].id
const q = `query($a:String!,$f:Time!,$t:Time!){viewer{accounts(filter:{accountTag:$a}){workersInvocationsScheduled(limit:100,filter:{scriptName:"makom-lizkor-staging",datetime_geq:$f,datetime_lt:$t},orderBy:[datetime_ASC]){datetime cron status cpuTimeUs}}}}`
const r = await cf("/graphql", {
  method: "POST",
  body: JSON.stringify({ query: q, variables: { a: acct, f: since, t: new Date().toISOString() } }),
})
if (r.errors?.length) throw new Error(r.errors.map((e) => e.message).join("; "))
for (const x of r.data.viewer.accounts[0].workersInvocationsScheduled)
  console.log(`${x.datetime}  ${x.cron}  ${x.status}  ${(x.cpuTimeUs / 1000).toFixed(1)} ms CPU`)
