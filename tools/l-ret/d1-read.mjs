// Read-only SQL against the staging D1 (SELECT only), through the D1 REST API with the Keychain token; never prints it.
//   node tools/l-ret/d1-read.mjs "<SELECT …>"
import { execFileSync } from "node:child_process"
const sql = process.argv[2]
if (!/^\s*select\b/i.test(sql ?? "") || /;\s*\S/.test(sql)) throw new Error("one SELECT only")
const tok = execFileSync("security", ["find-generic-password", "-s", "makom-staging-cloudflare", "-w"], { encoding: "utf8" }).trim()
const H = { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }
const api = (p, init = {}) => fetch(`https://api.cloudflare.com/client/v4${p}`, { ...init, headers: H }).then((r) => r.json())
const acct = (await api("/accounts")).result[0].id
const dbs = (await api(`/accounts/${acct}/d1/database?name=makom-staging`)).result
const db = dbs.find((d) => d.name === "makom-staging") ?? dbs[0]
const r = await api(`/accounts/${acct}/d1/database/${db.uuid}/raw`, { method: "POST", body: JSON.stringify({ sql }) })
if (!r.success) throw new Error(JSON.stringify(r.errors))
const res = r.result[0].results
console.log(`db ${db.name}`)
console.log(res.columns.join("\t"))
for (const row of res.rows) console.log(row.join("\t"))
