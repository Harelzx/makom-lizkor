/**
 * Of the public budget, what mail a visitor's action sends (verification, tracking, the contact form) may not take:
 * kept for what the site sends on its own, above all the moderators' alerts about removal requests, so a flood of
 * proposals can't hold those back until the next day.
 */
export const VISITOR_RESERVE = 30

/** One account-wide atomic claim per provider attempt, across locations; edge rate limits are not billing quotas. */
export async function claimMailBudget(env: Env, kind: "public" | "ops" | "visitor", now = new Date()): Promise<boolean> {
  const limit = Number(kind === "ops" ? env.MAIL_OPS_DAILY_LIMIT || 20 : env.MAIL_DAILY_LIMIT || 230)
  // Conservative ceiling: public + reserved ops <= 250/calendar day, <= 500 across any adjacent UTC days.
  if (!Number.isInteger(limit) || limit < 1 || limit > (kind === "ops" ? 20 : 230)) return false
  const cap = kind === "visitor" ? limit - VISITOR_RESERVE : limit
  if (cap < 1) return false
  const row = await env.DB.prepare(
    `INSERT INTO mail_budget (day, kind, attempts) VALUES (?1, ?2, 1)
     ON CONFLICT (day, kind) DO UPDATE SET attempts = attempts + 1 WHERE attempts < ?3
     RETURNING attempts`,
  )
    .bind(now.toISOString().slice(0, 10), kind === "ops" ? "ops" : "public", cap)
    .first()
  return !!row
}
