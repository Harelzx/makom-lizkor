import type { ErrorRates } from "./ops-summary"
import type { SendMail } from "./mail"
import { tellModerators } from "../db/retention"

/** An independent 1/32 sample, including successes and failures equally. This is an estimate, not billing data. */
export const METRIC_SAMPLE_EVERY = 32
export const sampleRequest = () => (crypto.getRandomValues(new Uint8Array(1))[0] & 31) === 0
const hourOf = (now: Date) => new Date(Math.floor(now.getTime() / 3600_000) * 3600_000).toISOString()

export async function recordRequest(env: Env, status: number, milliseconds: number, now = new Date()) {
  if (!Number.isInteger(status) || status < 100 || status > 599) return
  const ms = Math.min(300_000, Math.max(0, Math.round(milliseconds)))
  await env.DB.prepare(
    `INSERT INTO request_metrics (hour, code, samples, total_ms, slow) VALUES (?1, ?2, 1, ?3, ?4)
     ON CONFLICT (hour, code) DO UPDATE SET samples = samples + 1, total_ms = total_ms + excluded.total_ms, slow = slow + excluded.slow`,
  )
    .bind(hourOf(now), `http_${status}`, ms, Number(ms >= 2000))
    .run()
}

/**
 * Every server error and every failed scheduled part, counted whole (never sampled) under its own code: a rare 500 on a
 * submission would slip past a 1-in-32 sample, and the sampled alert below needs about a thousand requests an hour
 * before it can fire. A code only (http_500, job_export), so nothing of a request or a person is ever stored.
 */
export async function recordFailure(env: Env, what: string, now = new Date()) {
  if (!/^(http_5\d\d|job_[a-z][a-z0-9_]{0,40}|client_error)$/.test(what)) return
  await env.DB.prepare(
    `INSERT INTO request_metrics (hour, code, samples, total_ms, slow) VALUES (?1, ?2, 1, 0, 0)
     ON CONFLICT (hour, code) DO UPDATE SET samples = samples + 1`,
  )
    .bind(hourOf(now), `err_${what}`)
    .run()
}

export const requestErrorRates: ErrorRates = async (env) => {
  const since = hourOf(new Date(Date.now() - 24 * 3600_000))
  const rows = (
    await env.DB.prepare("SELECT code, SUM(samples) AS n FROM request_metrics WHERE hour > ? AND code GLOB 'http_*' GROUP BY code")
      .bind(since)
      .all<{ code: string; n: number }>()
  ).results
  if (!rows.length) return null
  return {
    windowHours: 24,
    requests: rows.reduce((sum, row) => sum + row.n, 0),
    byCode: Object.fromEntries(rows.filter((r) => /^http_[45]\d\d$/.test(r.code)).map((r) => [r.code, r.n])),
    sampleEvery: METRIC_SAMPLE_EVERY,
  }
}

/** Keep only two days of anonymous counters and the submission ceiling's codes. None is exported or restored. */
export async function pruneCounters(env: Env, now: Date) {
  const before = new Date(now.getTime() - 48 * 3600_000)
  await env.DB.batch([
    env.DB.prepare("DELETE FROM request_metrics WHERE hour < ?").bind(hourOf(before)),
    env.DB.prepare("DELETE FROM mail_budget WHERE day < ?").bind(before.toISOString().slice(0, 10)),
    env.DB.prepare("DELETE FROM submission_senders WHERE at < ?").bind(before.toISOString()),
  ])
}

/** Existing moderator alert channel; no visitor data or private URLs, bounded to one successful round per day. */
export async function alertOperations(env: Env, sendMail: SendMail, now: Date) {
  const latest = await env.DB.prepare("SELECT sent_at FROM job_alerts WHERE job = 'operations'").first<string>("sent_at")
  if (latest && latest > new Date(now.getTime() - 24 * 3600_000).toISOString()) return
  const [mail, metrics, budget] = await env.DB.batch([
    env.DB.prepare(
      "SELECT COUNT(*) AS n FROM contacts WHERE verify_mail_state IN ('uncertain', 'stopped') AND email_verified_at IS NULL AND email IS NOT NULL",
    ),
    env.DB.prepare(
      "SELECT SUM(samples) AS n, SUM(CASE WHEN code GLOB 'http_5??' THEN samples ELSE 0 END) AS errors, SUM(slow) AS slow FROM request_metrics WHERE hour >= ? AND code GLOB 'http_*'",
    ).bind(hourOf(new Date(now.getTime() - 3600_000))),
    env.DB.prepare("SELECT SUM(attempts) AS n FROM mail_budget WHERE day = ? AND kind = 'public'").bind(now.toISOString().slice(0, 10)),
  ])
  const blocked = Number((mail.results[0] as { n: number } | undefined)?.n ?? 0)
  const measured = metrics.results[0] as { n: number | null; errors: number | null; slow: number | null }
  const attempted = Number((budget.results[0] as { n: number } | undefined)?.n ?? 0)
  const limit = Number(env.MAIL_DAILY_LIMIT || 230)
  const bad = (measured.n ?? 0) >= 32 && ((measured.errors ?? 0) / measured.n! >= 0.05 || (measured.slow ?? 0) / measured.n! >= 0.25)
  if (!blocked && !bad && attempted < limit * 0.8) return
  await tellModerators(
    env.DB,
    env,
    sendMail,
    "operations",
    "מקום לזכור - נדרשת בדיקת תפעול",
    `מסירות אימות שמצריכות בדיקה: ${blocked}.\nניסיונות דואר היום: ${attempted} מתוך ${limit}.\nדגימת בקשות בשעה האחרונה: ${measured.n ?? 0}; שגיאות שרת: ${measured.errors ?? 0}; תגובות מעל שתי שניות: ${measured.slow ?? 0}.\nהדגימה היא אחת מכל ${METRIC_SAMPLE_EVERY} בקשות בממוצע ואינה מדידת חיוב. אין לבצע שליחה חוזרת למסירה לא ודאית בלי לבדוק.`,
    now,
  )
}

const FAILURE_ALERT_HOURS = 6

/**
 * Tells the moderators of server errors and failed scheduled parts as soon as a pass sees one (every 15 minutes), then
 * at most every six hours while they go on: each mail covers the six hours before it, so a problem that persists keeps
 * being told and one that stopped is told once more at most. Codes and counts only. If a mail can't go,
 * tellModerators records nothing and the next pass tries again.
 */
export async function alertFailures(env: Env, sendMail: SendMail, now: Date) {
  const latest = await env.DB.prepare("SELECT sent_at FROM job_alerts WHERE job = 'failures'").first<string>("sent_at")
  if (latest && latest > new Date(now.getTime() - FAILURE_ALERT_HOURS * 3600_000).toISOString()) return
  const { results } = await env.DB.prepare(
    "SELECT code, SUM(samples) AS n FROM request_metrics WHERE hour >= ? AND code GLOB 'err_*' GROUP BY code ORDER BY code",
  )
    .bind(hourOf(new Date(now.getTime() - FAILURE_ALERT_HOURS * 3600_000)))
    .all<{ code: string; n: number }>()
  // A server error or a failed job is ours at once; an error in a visitors' browser counts from three, since one alone
  // may be an old browser or an extension the filter didn't catch.
  const client = results.find((r) => r.code === "err_client_error")?.n ?? 0
  if (!results.some((r) => r.code !== "err_client_error") && client < 3) return
  const lines = results.map(({ code, n }) => {
    const what = code.slice(4)
    if (what === "client_error") return `שגיאות בדפדפן של מבקרים: ${n}`
    return what.startsWith("http_") ? `שגיאות שרת (${what.slice(5)}): ${n}` : `עבודה מתוזמנת שנכשלה, ${what.slice(4)}: ${n}`
  })
  await tellModerators(
    env.DB,
    env,
    sendMail,
    "failures",
    "מקום לזכור - תקלות בשרת",
    `בשש השעות האחרונות:\n${lines.join("\n")}\n\nכל שגיאה נספרת, בלי דגימה. הפרטים (המסלול וסוג השגיאה, בלי תוכן) ביומני ה־Worker: לוח הבקרה של Cloudflare, Workers & Pages, makom-lizkor, Logs.`,
    now,
  )
}
