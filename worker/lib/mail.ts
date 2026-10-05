import { ulid } from "./ids"

export type Mail = { to: string; subject: string; text: string }
/** Sends one mail; false when it couldn't be sent now. A mail never decides whether a submission or a decision stands. */
export type SendMail = (env: Env, mail: Mail) => Promise<boolean>

/** Development: the mail is written to dev_outbox, where the tests and a developer read it. Nothing leaves the machine. */
const devOutbox: SendMail = async (env, m) => {
  await env.DB.prepare("INSERT INTO dev_outbox (id, at, to_address, subject, body) VALUES (?, ?, ?, ?, ?)")
    .bind(`m_${ulid()}`, new Date().toISOString(), m.to, m.subject, m.text)
    .run()
  return true
}

/**
 * Elsewhere, mail goes through Cloudflare Email Service, which needs the site's own domain on Cloudflare DNS (a launch
 * item, checked in staging). Until that binding exists, nothing is sent; the tracking link works without any mail.
 */
const notYet: SendMail = async () => false

export const sendMail: SendMail = (env, m) => (env.ENVIRONMENT === "development" ? devOutbox(env, m) : notYet(env, m))
