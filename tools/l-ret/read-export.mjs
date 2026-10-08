// A2's readable baseline (a104/a106): the newest staging export (or a named one), fetched read-only through the R2
// API, its data checked against the manifest's sha256, opened with the owner's staging key from the Keychain, gunzipped,
// and each table's row count compared with the manifest's. Prints only counts: per table, how many rows carry a marker.
// Never a row's content, never a key.
//   node tools/l-ret/read-export.mjs <checkout> <marker> [export id]
import { stagingAccount, assertTables } from "./guards.mjs"
import { execFileSync } from "node:child_process"
import { gunzipSync } from "node:zlib"
import { pathToFileURL } from "node:url"

const [checkout, marker, wanted] = process.argv.slice(2)
if (!checkout || !marker) throw new Error("usage: node tools/l-ret/read-export.mjs <checkout> <marker> [export id]")
const { sha256, unseal } = await import(pathToFileURL(`${checkout}/worker/lib/sealed.ts`).href)
const tok = execFileSync("security", ["find-generic-password", "-s", "makom-staging-cloudflare", "-w"], { encoding: "utf8" }).trim()
const H = { Authorization: `Bearer ${tok}`, "cf-r2-jurisdiction": "eu" }
const acct = stagingAccount(await (await fetch("https://api.cloudflare.com/client/v4/accounts", { headers: H })).json())
const R2 = `https://api.cloudflare.com/client/v4/accounts/${acct}/r2/buckets/makom-staging-exports/objects`

const listing = await (await fetch(`${R2}?prefix=exports/&per_page=1000`, { headers: H })).json()
if (!listing.success) throw new Error(`listing refused: ${JSON.stringify(listing.errors)}`)
const ids = [...new Set(listing.result.map((o) => o.key.split("/")[1]))].sort()
console.log(`exports listed: ${ids.length}${ids.length ? ` (oldest ${ids[0]}, newest ${ids.at(-1)})` : ""}`)
const id = wanted ?? ids.at(-1)
if (!id) throw new Error("No export is available to verify")
const get = async (key) => {
  const r = await fetch(`${R2}/${encodeURIComponent(key)}`, { headers: H })
  if (!r.ok) throw new Error(`${key}: ${r.status}`)
  return new Uint8Array(await r.arrayBuffer())
}
const manifest = JSON.parse(new TextDecoder().decode(await get(`exports/${id}/manifest.json`)))
const data = await get(manifest.data.key)
if ((await sha256(data)) !== manifest.data.sha256) throw new Error("the data's sha256 differs from the manifest's")
const owner = JSON.parse(
  Buffer.from(
    execFileSync("security", ["find-generic-password", "-s", "makom-staging-export-owner", "-a", "staging", "-w"], {
      encoding: "utf8",
    }).trim(),
    "base64",
  ).toString("utf8"),
)
const plain = JSON.parse(gunzipSync(await unseal(data, manifest.data, owner)).toString("utf8"))
console.log(
  `export ${id}: created ${manifest.created_at}, retention run ${manifest.retention_run}, schema ${manifest.schema}; opened with the owner's key; recipients ${manifest.data.recipients.map((r) => r.kid).join(", ")}`,
)
let mismatch = 0
for (const [t, rows] of Object.entries(plain.tables)) {
  const want = manifest.tables[t]?.rows
  if (want !== rows.length) mismatch++
  const marked = rows.filter((r) => JSON.stringify(r).includes(marker)).length
  console.log(`  ${t}: ${rows.length} rows (manifest ${want})${marked ? `, ${marked} with the marker` : ""}`)
}
console.log(`photo copies listed: ${manifest.files.length}; table counts ${mismatch ? `DIFFER in ${mismatch}` : "match the manifest"}`)

assertTables(plain, manifest)
