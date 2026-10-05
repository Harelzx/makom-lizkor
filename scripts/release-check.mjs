// The gate before the notices go public: every identity, contact, provider and retention value in src/config.ts must
// be real and checked. Placeholders are fine while developing; publishing them would put a false or empty promise in a
// privacy notice. Run by `npm run release:check`, and by the production deploy before anything ships.
import * as config from "../src/config.ts"

const blockers = []
const placeholder = (v) => v === null || (typeof v === "string" && (/^\[.*\]$/.test(v.trim()) || v.includes("example.org")))

for (const [group, values] of Object.entries({ OPERATOR: config.OPERATOR, MAILBOX: config.MAILBOX, HOSTING: config.HOSTING }))
  for (const [key, value] of Object.entries(values)) if (placeholder(value)) blockers.push(`${group}.${key} is still a placeholder`)

for (const [key, value] of Object.entries(config.RETENTION)) if (value === null) blockers.push(`RETENTION.${key} is not set`)
if (!config.RETENTION.verified)
  blockers.push("RETENTION.verified is false: the deletion and backup periods haven't been tested end to end (restore drills included)")
if (!config.MAILBOX.verified)
  blockers.push(
    "MAILBOX.verified is false: the mailbox's deletion after closure and its trash tail haven't been measured on the real tenant",
  )

if (blockers.length) {
  console.error("Not ready to publish the notices:\n" + blockers.map((b) => `  - ${b}`).join("\n"))
  process.exit(1)
}
console.log("Release check passed: every notice value is set and verified.")
