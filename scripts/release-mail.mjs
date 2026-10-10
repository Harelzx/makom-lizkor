// The mail half of the release check, apart so it can be tested on configurations that are wrong in each way.
import { validMailFrom } from "../worker/lib/mail-binding.ts"
import { gmailSenderReady, GMAIL_SECRETS } from "../worker/lib/gmail.ts"

/**
 * What stops a public build from offering an email: the production configuration (wrangler.jsonc's top level, not a
 * named environment) must configure the selected transport. Declaring secrets is not proof they are uploaded or that
 * mail arrives; runtime readiness and the real commissioning check still apply, as does MAILBOX.verified.
 * `raw` is the parsed config (comments already gone), as wrangler reads it.
 */
export function mailBlockers(raw, { binding, sends }) {
  const blockers = []
  const provider = raw.vars?.MAIL_PROVIDER ?? "cloudflare"
  if (!sends) blockers.push("The production mail adapter (worker/lib/mail.ts) doesn't send yet: PRODUCTION_MAIL_SENDS is false")
  if (provider === "gmail") {
    if (raw.vars?.GMAIL_OAUTH_STATUS !== "production")
      blockers.push("Gmail OAuth must leave Testing before commissioning: a Testing refresh grant expires after seven days")
    if (!gmailSenderReady(raw.vars ?? {})) blockers.push("Gmail MAIL_FROM must match the explicitly authorized GMAIL_ACCOUNT on gmail.com")
    for (const secret of GMAIL_SECRETS) {
      if (!(raw.secrets?.required ?? []).includes(secret)) blockers.push(`Gmail requires a declared production secret ${secret}`)
      if (Object.hasOwn(raw.vars ?? {}, secret)) blockers.push(`${secret} must be a secret, never a production var`)
    }
    return blockers
  }
  if (provider !== "cloudflare") return [...blockers, "MAIL_PROVIDER is unknown: no production mail transport selected"]
  const bound = (raw.send_email ?? []).some((b) => b && b.name === binding)
  if (!bound)
    blockers.push(
      `No send_email binding named ${binding} in wrangler.jsonc's production (top-level) config: verification and tracking mails wouldn't be sent, though the form offers an email`,
    )
  if (!validMailFrom(raw.vars?.MAIL_FROM))
    blockers.push("MAIL_FROM must name the production sender on a domain verified for Cloudflare Email Service")
  return blockers
}
