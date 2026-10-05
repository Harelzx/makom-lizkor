// Shared with scripts/release-check.mjs, which runs in Node: no imports here.

/** The send_email binding the production mail adapter sends through. */
export const MAIL_BINDING = "MAIL"

/**
 * Whether the production adapter in mail.ts actually sends through MAIL_BINDING. It doesn't yet (Email Service needs
 * the site's domain on Cloudflare DNS, a launch item), so the release check refuses a public build until it does.
 */
export const PRODUCTION_MAIL_SENDS = false
