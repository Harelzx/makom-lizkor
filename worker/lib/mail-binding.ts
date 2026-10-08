// Shared with scripts/release-check.mjs, which runs in Node: no imports here.

/** The send_email binding the production mail adapter sends through. */
export const MAIL_BINDING = "MAIL"

/**
 * The production adapter implements the provider call. This is not evidence of a configured domain or deliverability:
 * release checks still require the binding and sender, and launch needs a real delivery check after domain setup.
 */
export const PRODUCTION_MAIL_SENDS = true

/** A single sender address, without a display name, placeholder domain or header control characters. */
export function validMailFrom(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 254 || /[\s<>(),;:"\\]/.test(value)) return false
  const parts = value.split("@")
  if (parts.length !== 2) return false
  const [local, domain] = parts
  if (!local || local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false
  const labels = domain.split(".")
  if (labels.length < 2 || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return false
  return !/(^|\.)(example\.(com|net|org)|invalid|test|localhost)$/i.test(domain)
}
