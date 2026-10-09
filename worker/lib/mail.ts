import { ulid } from "./ids"
import { MAIL_BINDING, validMailFrom } from "./mail-binding"

export type Mail = { to: string; subject: string; text: string }
// Not bound until the production domain is chosen; use the generated platform binding type, not a custom transport.
type MailEnv = Env & { MAIL?: SendEmail; MAIL_FROM?: string }
/** Whether a public contact form may offer real sending. Synthetic staging and local previews never send contact mail. */
export const contactMailReady = (env: MailEnv) =>
  env.ENVIRONMENT === "production" &&
  validMailFrom(env.MAIL_FROM) &&
  typeof env.MAIL?.send === "function" &&
  !!env.PUBLIC_ORIGIN?.startsWith("https://") &&
  !!env.TRACKING_SECRET &&
  !!env.TURNSTILE_SECRET &&
  !!env.TURNSTILE_HOSTNAMES?.trim()
/** Sends one mail; false when it couldn't be sent now. A mail never decides whether a submission or a decision stands. */
export type SendMail = (env: MailEnv, mail: Mail) => Promise<boolean>

/** Development: the mail is written to dev_outbox, where the tests and a developer read it. Nothing leaves the machine. */
const devOutbox: SendMail = async (env, m) => {
  await env.DB.prepare("INSERT INTO dev_outbox (id, at, to_address, subject, body) VALUES (?, ?, ?, ?, ?)")
    .bind(`m_${ulid()}`, new Date().toISOString(), m.to, m.subject, m.text)
    .run()
  return true
}

/**
 * Production uses Cloudflare Email Service's structured builder; its sender domain must be onboarded and verified.
 * A message id means accepted by the provider, not proof of arrival. Provider refusals remain retryable by callers;
 * never log their errors, which may contain recipients, message text or tracking links.
 */
const productionMail: SendMail = async (env, m) => {
  const binding = env[MAIL_BINDING]
  if (!validMailFrom(env.MAIL_FROM) || !binding || typeof binding.send !== "function") return false
  try {
    const result = await binding.send({ from: env.MAIL_FROM, to: m.to, subject: m.subject, text: m.text })
    return typeof result?.messageId === "string" && result.messageId.trim().length > 0
  } catch {
    return false
  }
}

// Synthetic staging must never email real people merely because it gained a binding or copied a sender setting.
export const sendMail: SendMail = (env, m) => {
  if (env.ENVIRONMENT === "development") return devOutbox(env, m)
  if (env.ENVIRONMENT === "production") return productionMail(env, m)
  return Promise.resolve(false)
}
