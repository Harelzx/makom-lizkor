// The mail half of the release check, apart so it can be tested on configurations that are wrong in each way.

/**
 * What stops a public build from offering an email: the production configuration (wrangler.jsonc's top level, not a
 * named environment) must bind send_email under the name the production adapter uses, and that adapter must send.
 * `raw` is the parsed config (comments already gone), as wrangler reads it.
 */
export function mailBlockers(raw, { binding, sends }) {
  const blockers = []
  const bound = (raw.send_email ?? []).some((b) => b && b.name === binding)
  if (!bound)
    blockers.push(
      `No send_email binding named ${binding} in wrangler.jsonc's production (top-level) config: verification and tracking mails wouldn't be sent, though the form offers an email`,
    )
  if (!sends) blockers.push("The production mail adapter (worker/lib/mail.ts) doesn't send yet: PRODUCTION_MAIL_SENDS is false")
  return blockers
}
