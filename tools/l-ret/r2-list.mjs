// Read-only: the staging exports bucket's listing (eu jurisdiction): every object's key, size and the provider's upload
// time, for before/after comparisons of the prune. Nothing secret printed.
//   node tools/l-ret/r2-list.mjs [prefix]
import { stagingAccount } from "./guards.mjs"
import { execFileSync } from "node:child_process"
const prefix = process.argv[2] ?? ""
const tok = execFileSync("security", ["find-generic-password", "-s", "makom-staging-cloudflare", "-w"], { encoding: "utf8" }).trim()
const H = { Authorization: `Bearer ${tok}`, "cf-r2-jurisdiction": "eu" }
const acct = stagingAccount(await (await fetch("https://api.cloudflare.com/client/v4/accounts", { headers: H })).json())
let cursor = ""
const rows = []
do {
  const page = await (
    await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${acct}/r2/buckets/makom-staging-exports/objects?prefix=${encodeURIComponent(prefix)}&per_page=1000${cursor ? `&cursor=${cursor}` : ""}`,
      { headers: H },
    )
  ).json()
  if (!page.success) throw new Error(JSON.stringify(page.errors))
  rows.push(...page.result)
  cursor = page.result_info?.is_truncated ? page.result_info.cursor : ""
} while (cursor)
console.log(`listed at ${new Date().toISOString()}: ${rows.length} object(s)`)
for (const o of rows) console.log(`${o.key}\t${o.size}\t${o.last_modified}`)
