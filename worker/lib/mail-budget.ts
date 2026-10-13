/** One account-wide atomic claim per provider attempt, across locations; edge rate limits are not billing quotas. */
export async function claimMailBudget(env: Env, kind: "public" | "ops", now = new Date()): Promise<boolean> {
  const limit = Number(kind === "ops" ? env.MAIL_OPS_DAILY_LIMIT || 20 : env.MAIL_DAILY_LIMIT || 230)
  // Conservative ceiling: public + reserved ops <= 250/calendar day, <= 500 across any adjacent UTC days.
  if (!Number.isInteger(limit) || limit < 1 || limit > (kind === "ops" ? 20 : 230)) return false
  const row = await env.DB.prepare(
    `INSERT INTO mail_budget (day, kind, attempts) VALUES (?1, ?2, 1)
     ON CONFLICT (day, kind) DO UPDATE SET attempts = attempts + 1 WHERE attempts < ?3
     RETURNING attempts`,
  )
    .bind(now.toISOString().slice(0, 10), kind, limit)
    .first()
  return !!row
}
