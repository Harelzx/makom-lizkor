import { ulid } from "./ids"
import { MAIL_BINDING, validMailFrom } from "./mail-binding"
import { gmailReady, gmailAttempt, type GmailSettings, type MailOutcome } from "./gmail"
import { claimMailBudget } from "./mail-budget"
import { log } from "./log"

export type Mail = { to: string; subject: string; text: string; budget?: "ops" }
// Optional commissioning settings; a transport cannot become ready merely by choosing its name.
type MailEnv = Env & GmailSettings & { MAIL?: SendEmail; MAIL_PROVIDER?: string }
const cloudflareSelected = (env: MailEnv) => env.MAIL_PROVIDER === undefined || env.MAIL_PROVIDER === "cloudflare"
const transportReady = (env: MailEnv) =>
  env.MAIL_PROVIDER === "gmail"
    ? gmailReady(env)
    : cloudflareSelected(env) && validMailFrom(env.MAIL_FROM) && typeof env.MAIL?.send === "function"
/** Whether a public contact form may offer real sending. Synthetic staging and local previews never send contact mail. */
export const contactMailReady = (env: MailEnv) =>
  env.ENVIRONMENT === "production" &&
  transportReady(env) &&
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
 * Production chooses one configured provider. Cloudflare needs a verified domain; Gmail needs owner-authorized OAuth.
 * A message id means accepted by the provider, not proof of arrival. Provider refusals remain retryable by callers;
 * never log their errors, which may contain recipients, message text or tracking links.
 */
const productionMail: SendMail = async (env, m) => {
  if (env.MAIL_PROVIDER === "gmail") return (await gmailAttempt(env, m)) === "accepted"
  if (!cloudflareSelected(env)) return false
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
export async function attemptMail(env: MailEnv, m: Mail): Promise<MailOutcome> {
  if (env.ENVIRONMENT === "development") return (await devOutbox(env, m)) ? "accepted" : "retryable"
  if (env.ENVIRONMENT !== "production" || !transportReady(env)) return "stopped"
  try {
    if (!(await claimMailBudget(env, m.budget === "ops" ? "ops" : "public"))) return "deferred"
  } catch {
    // A missing/unavailable budget store cannot bypass the cap or turn provider failure into a thrown HTTP error.
    log("error", "mail_budget_unavailable", { failure: "deferred" })
    return "deferred"
  }
  const outcome = env.MAIL_PROVIDER === "gmail" ? await gmailAttempt(env, m) : (await productionMail(env, m)) ? "accepted" : "uncertain"
  // The alert channel is independent of Gmail. Only the fixed outcome code may leave this layer, never a provider
  // error, address, body or capability. Expected quota deferral above is not a runtime error.
  if (outcome !== "accepted") log("error", "mail_delivery_failed", { failure: outcome })
  return outcome
}
export const sendMail: SendMail = async (env, m) => (await attemptMail(env, m)) === "accepted"
