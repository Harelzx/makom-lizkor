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

export const requestErrorRates: ErrorRates = async (env) => {
  const since = hourOf(new Date(Date.now() - 24 * 3600_000))
  const rows = (
    await env.DB.prepare("SELECT code, SUM(samples) AS n FROM request_metrics WHERE hour > ? GROUP BY code")
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

/** Keep only two days of anonymous counters. Neither table is exported or restored. */
export async function pruneCounters(env: Env, now: Date) {
  const before = new Date(now.getTime() - 48 * 3600_000)
  await env.DB.batch([
    env.DB.prepare("DELETE FROM request_metrics WHERE hour < ?").bind(hourOf(before)),
    env.DB.prepare("DELETE FROM mail_budget WHERE day < ?").bind(before.toISOString().slice(0, 10)),
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
      "SELECT SUM(samples) AS n, SUM(CASE WHEN code GLOB 'http_5??' THEN samples ELSE 0 END) AS errors, SUM(slow) AS slow FROM request_metrics WHERE hour >= ?",
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
