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
for (const promise of config.PENDING_PROMISES) blockers.push(`promised but not built: ${promise}`)
if (!config.MAILBOX.verified)
  blockers.push(
    "MAILBOX.verified is false: the 12-month per-message policy isn't configured and its trash tail measured on the real mailbox",
  )

// The browser check: a public build needs the site's own Turnstile sitekey, not Cloudflare's test key from .env.
const sitekey = process.env.VITE_TURNSTILE_SITEKEY ?? ""
if (!sitekey || /^[123]x0+/.test(sitekey))
  blockers.push(
    "VITE_TURNSTILE_SITEKEY is unset or Cloudflare's test key: a public build needs the site's own (the secret goes to the Worker)",
  )

// Mail: the form offers an email and the notice promises a verification mail, so a public build needs mail that is
// actually sent (Cloudflare Email Service bound to the Worker), not the development outbox. The config is parsed as
// wrangler reads it, so a commented-out binding or one in a staging environment doesn't count.
const { experimental_readRawConfig } = await import("wrangler")
const { MAIL_BINDING, PRODUCTION_MAIL_SENDS } = await import("../worker/lib/mail-binding.ts")
const { mailBlockers } = await import("./release-mail.mjs")
const { fileURLToPath } = await import("node:url")
const raw = experimental_readRawConfig({ config: fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)) }).rawConfig
blockers.push(...mailBlockers(raw, { binding: MAIL_BINDING, sends: PRODUCTION_MAIL_SENDS }))
const { originBlockers } = await import("./release-origin.mjs")
blockers.push(...originBlockers(raw))
const { moderatorBlockers } = await import("./release-moderators.mjs")
blockers.push(...moderatorBlockers(raw))
const { readRegistry, registryBlockers } = await import("./access-registry.mjs")
blockers.push(
  ...registryBlockers(
    readRegistry(),
    (raw.vars?.MODERATORS ?? "")
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean),
  ),
)
const { backupBlockers } = await import("./release-backup.mjs")
blockers.push(...backupBlockers(raw))
const { platformBlockers } = await import("./release-platform.mjs")
blockers.push(...platformBlockers(raw))

if (blockers.length) {
  console.error("Not ready to publish the notices:\n" + blockers.map((b) => `  - ${b}`).join("\n"))
  process.exit(1)
}
console.log("Release check passed: every notice value is set and verified.")
