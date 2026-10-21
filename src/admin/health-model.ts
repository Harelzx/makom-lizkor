import type { SiteHealth } from "../../worker/lib/health-schema"
import type { OpsSummary } from "./api"

/**
 * The site-health screen's reading of the hourly counters: what went wrong and how often, in words a person who is not
 * a developer reads, and a report to copy for one who is. Pure, so it is tested without a page.
 */

/** The scheduled parts (worker/jobs.ts part()), named for what they do. */
const JOBS: Record<string, string> = {
  retention: "מחיקה אוטומטית של מידע שהגיע זמנו",
  verification_delivery: "שליחת מיילי אימות",
  operational_counters: "ניקוי המונים",
  operations_alert: "בדיקת תפעול יומית",
  retention_alert: "התראה על מחיקה שנתקעה",
  review_reminder: "תזכורת על הצעות ממתינות",
  resume_ops: "השלמת הסתרות ומחיקות שנקטעו",
  photo_sweep: "ניקוי תמונות",
  export: "גיבוי לילי",
  export_prune: "ניקוי גיבויים ישנים",
  drill: "תרגיל שחזור שבועי",
  deletion_check: "בדיקה שמה שנמחק לא חוזר מגיבוי",
  backstop: "בדיקה חוזרת של בקשות הסרה",
  alerts: "התראות על בקשות הסרה",
  failures_alert: "מייל התקלות",
  abuse_codes: "ניקוי קודי הגבלה",
}

/** What went wrong for a visitor (src/lib/error-report.ts reportIssue). */
const ISSUES: Record<string, string> = {
  crash: "האתר קרס אצל מבקר (מסך לבן)",
  map_missing: "המפה לא יכלה להיפתח אצל מבקר (הדפדפן לא תומך)",
  map_tiles: "חלקים מהמפה לא נטענו",
  map_style: "עיצוב המפה לא נטען",
  map_webgl: "המפה נעלמה באמצע (כרטיס המסך)",
  image: "תמונה לא נטענה",
  feed: "רשימת המקומות לא נטענה מהשרת",
  stale_bundle: "לשונית ישנה נטענה מחדש אחרי עדכון",
}

/** The kind of an error in a visitor's browser (src/lib/error-report.ts errorKind). */
const ERROR_KINDS: Record<string, string> = {
  network: "בעיית רשת",
  json: "תשובה לא צפויה מהשרת",
  chunk: "קובץ של האתר לא נטען",
  other: "אחר",
}

/** What each failure code means; a code from a later version reads as itself rather than being dropped. */
export function failureLabel(code: string): string {
  const what = code.replace(/^err_/, "")
  if (what === "client_error") return "שגיאה בדפדפן של מבקר"
  if (what.startsWith("client_error_")) return `שגיאה בדפדפן של מבקר: ${ERROR_KINDS[what.slice(13)] ?? what.slice(13)}`
  if (what.startsWith("client_")) return ISSUES[what.slice(7)] ?? what
  if (what.startsWith("http_")) return `שגיאה בשרת (${what.slice(5)})`
  if (what.startsWith("job_")) return `עבודה ברקע נכשלה: ${JOBS[what.slice(4)] ?? what.slice(4)}`
  return what
}

export type Level = "good" | "watch" | "bad" | "empty"
type Row = SiteHealth["hours"][number]

export interface Reading {
  hours: number
  /** Every counted failure in the window, by code, most first. */
  failures: { code: string; label: string; n: number }[]
  serverErrors: number
  jobFailures: number
  browserErrors: number
  /** The same errors by kind (network, json, chunk, other); reports from before kinds were sent count as other. */
  errorKinds: Record<string, number>
  /** What went wrong for visitors besides errors in our code, by kind (crash, map_tiles …). */
  issues: Record<string, number>
  /** Visits told (one a page, sent as it is left), and how many were rated good, ni or poor on each measure. */
  visits: number
  vitals: Record<"lcp" | "inp" | "cls", { good: number; ni: number; poor: number }>
  /** The sampled answers: how many were sampled, what that estimates, their mean time and how many took 2 s or more. */
  sampled: number
  estimated: number
  meanMs: number | null
  slow: number
  /** Sampled answers by status (http_200 …). */
  byStatus: { code: string; n: number }[]
  /** Per hour, oldest first, over the whole window: failures counted and answers sampled. */
  timeline: { hour: string; failures: number; sampled: number }[]
  level: Level
  /** Why the level is what it is, a sentence each, the worst first. */
  reasons: string[]
}

const sum = (rows: Row[], f: (r: Row) => number) => rows.reduce((a, r) => a + f(r), 0)

export function readHealth(health: SiteHealth, summary: OpsSummary | null, hours: number, now = new Date(health.generated_at)): Reading {
  const top = Math.floor(now.getTime() / 3600_000) * 3600_000
  const from = top - (hours - 1) * 3600_000
  const rows = health.hours.filter((r) => new Date(r.hour).getTime() >= from)
  const errs = rows.filter((r) => r.code.startsWith("err_"))
  const http = rows.filter((r) => r.code.startsWith("http_"))
  const byCode = new Map<string, number>()
  for (const r of errs) byCode.set(r.code, (byCode.get(r.code) ?? 0) + r.samples)
  const failures = [...byCode].map(([code, n]) => ({ code, label: failureLabel(code), n })).sort((a, b) => b.n - a.n)
  const serverErrors = sum(
    errs.filter((r) => r.code.startsWith("err_http_")),
    (r) => r.samples,
  )
  const jobFailures = sum(
    errs.filter((r) => r.code.startsWith("err_job_")),
    (r) => r.samples,
  )
  const browserErrors = sum(
    errs.filter((r) => r.code === "err_client_error" || r.code.startsWith("err_client_error_")),
    (r) => r.samples,
  )
  const issues: Record<string, number> = {}
  const errorKinds: Record<string, number> = {}
  for (const r of errs.filter((r) => r.code === "err_client_error" || r.code.startsWith("err_client_error_"))) {
    const kind = r.code.slice(17) || "other"
    errorKinds[kind] = (errorKinds[kind] ?? 0) + r.samples
  }
  for (const r of errs.filter((r) => r.code.startsWith("err_client_") && !r.code.startsWith("err_client_error")))
    issues[r.code.slice(11)] = (issues[r.code.slice(11)] ?? 0) + r.samples
  const ev = (code: string) =>
    sum(
      rows.filter((r) => r.code === `ev_${code}`),
      (r) => r.samples,
    )
  const visits = ev("visit")
  const vitals = Object.fromEntries(
    (["lcp", "inp", "cls"] as const).map((m) => [m, { good: ev(`${m}_good`), ni: ev(`${m}_ni`), poor: ev(`${m}_poor`) }]),
  ) as Reading["vitals"]
  const sampled = sum(http, (r) => r.samples)
  const slow = sum(http, (r) => r.slow)
  const statuses = new Map<string, number>()
  for (const r of http) statuses.set(r.code, (statuses.get(r.code) ?? 0) + r.samples)

  const timeline = Array.from({ length: hours }, (_, i) => {
    const hour = new Date(from + i * 3600_000).toISOString()
    const at = rows.filter((r) => new Date(r.hour).getTime() === from + i * 3600_000)
    return {
      hour,
      failures: sum(
        at.filter((r) => r.code.startsWith("err_")),
        (r) => r.samples,
      ),
      sampled: sum(
        at.filter((r) => r.code.startsWith("http_")),
        (r) => r.samples,
      ),
    }
  })

  const bad: string[] = []
  const watch: string[] = []
  if (jobFailures) {
    const which = failures.filter((f) => f.code.startsWith("err_job_")).map((f) => JOBS[f.code.slice(8)] ?? f.code.slice(8))
    bad.push(`עבודה ברקע נכשלה (${which.join(", ")}). היא לא תסתדר לבד: צריך בדיקה טכנית.`)
  }
  if (serverErrors >= 5) bad.push(`השרת נכשל ${times(serverErrors)}: מבקרים קיבלו שגיאה במקום תשובה.`)
  else if (serverErrors) watch.push(`השרת נכשל ${times(serverErrors)}. מעט, אבל כדאי לבדוק אם זה חוזר.`)
  const crashes = issues.crash ?? 0
  if (crashes >= 3) bad.push(`האתר קרס ${times(crashes)} אצל מבקרים: הם ראו מסך לבן.`)
  else if (crashes) watch.push(`האתר קרס ${times(crashes)} אצל מבקר: הוא ראה מסך לבן.`)
  const map = (issues.map_tiles ?? 0) + (issues.map_style ?? 0) + (issues.map_webgl ?? 0)
  if (map >= 5) watch.push(`${map} דיווחים על מפה שלא נטענה כמו שצריך.`)
  if ((issues.image ?? 0) >= 10) watch.push(`${issues.image} דיווחים על תמונות שלא נטענו.`)
  if ((issues.feed ?? 0) >= 3) watch.push(`${issues.feed} מבקרים לא קיבלו מהשרת את רשימת המקומות.`)
  const lcp = vitals.lcp.good + vitals.lcp.ni + vitals.lcp.poor
  if (lcp >= 20 && vitals.lcp.poor / lcp >= 0.25)
    watch.push(`האתר נטען לאט: ב־${percent(vitals.lcp.poor, lcp)} מהביקורים הטעינה הייתה איטית.`)
  // A dropped connection is the visitor's network, not our code: it is worth a look only when there are many.
  const network = errorKinds.network ?? 0
  if (browserErrors - network >= 3)
    watch.push(`${browserErrors - network} דיווחים על שגיאה בקוד האתר בדפדפן של מבקרים (ייתכן שכמה מאותו מבקר).`)
  if (network >= 10) watch.push(`${network} מבקרים איבדו את החיבור באמצע. לרוב זו רשת חלשה אצלם, אבל אם זה רב, אולי השרת לא עונה.`)
  if (sampled >= 20 && slow / sampled >= 0.1) watch.push(`השרת איטי: ${percent(slow, sampled)} מהתשובות שנבדקו לקחו שתי שניות או יותר.`)
  if (summary) {
    if (summary.export && !summary.export.ok) bad.push("הגיבוי הלילי האחרון לא הושלם.")
    if (summary.retention.last && !summary.retention.last.ok) bad.push("המחיקה האוטומטית האחרונה לא הושלמה.")
    if (summary.drill && summary.drill.ok === false) watch.push("תרגיל השחזור האחרון נכשל.")
    const stuck = summary.mail_delivery ? summary.mail_delivery.uncertain + summary.mail_delivery.stopped : 0
    if (stuck) watch.push(`${stuck} מיילי אימות נתקעו או שלא ברור אם הגיעו.`)
    if (summary.mail_budget && summary.mail_budget.public > summary.mail_budget.public_limit * 0.8)
      watch.push("מכסת המיילים היומית כמעט נגמרה.")
  }
  const level: Level = bad.length ? "bad" : watch.length ? "watch" : health.hours.length ? "good" : "empty"
  return {
    hours,
    failures,
    serverErrors,
    jobFailures,
    browserErrors,
    errorKinds,
    issues,
    visits,
    vitals,
    sampled,
    estimated: sampled * health.sample_every,
    meanMs: sampled ? Math.round(sum(http, (r) => r.total_ms) / sampled) : null,
    slow,
    byStatus: [...statuses].map(([code, n]) => ({ code, n })).sort((a, b) => b.n - a.n),
    timeline,
    level,
    reasons: [...bad, ...watch],
  }
}

export const HEADLINE: Record<Level, string> = {
  good: "הכול תקין",
  watch: "כדאי לבדוק",
  bad: "יש תקלה שצריך לטפל בה",
  empty: "עוד אין נתונים",
}

/** Google's three measures of how a visit felt, by what a visitor would notice. */
export const VITAL = {
  lcp: "מהירות טעינה (LCP)",
  inp: "תגובה ללחיצה (INP)",
  cls: "קפיצות בעמוד (CLS)",
} as const

const times = (n: number) => (n === 1 ? "פעם אחת" : `${n.toLocaleString("he-IL")} פעמים`)
const percent = (a: number, b: number) => `${Math.round((a * 1000) / b) / 10}%`
const clock = (iso: string) =>
  new Date(iso).toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

/**
 * Everything on the screen and a little more, as plain text to paste to a developer: the version, the window, every
 * failure code with its hours, the sampled traffic and timings, the jobs' and mail's state, and the raw counters.
 * Codes and counts only, as stored: nothing of a visitor.
 */
export function healthReport(health: SiteHealth, summary: OpsSummary | null, r: Reading): string {
  const lines: string[] = []
  lines.push("דוח מצב · מקום לזכור")
  lines.push(`נוצר: ${clock(health.generated_at)} (שעון ישראל)`)
  lines.push(`גרסה באוויר: ${health.version ?? "לא ידועה"}`)
  lines.push(`טווח: ${r.hours} השעות האחרונות`)
  lines.push(`מצב: ${HEADLINE[r.level]}`)
  for (const reason of r.reasons) lines.push(`  - ${reason}`)
  lines.push("")
  lines.push("תקלות (כל אחת נספרת, בלי דגימה):")
  if (!r.failures.length) lines.push("  אין")
  for (const f of r.failures) {
    const when = health.hours
      .filter((h) => h.code === f.code && r.timeline.some((t) => t.hour === h.hour))
      .map((h) => `${clock(h.hour)} ×${h.samples}`)
      .join(" · ")
    lines.push(`  - ${f.code} (${f.label}): ${f.n} [${when}]`)
  }
  lines.push("")
  lines.push(`תעבורה (מדגם של תשובה אחת מכל ${health.sample_every}):`)
  lines.push(`  תשובות שנדגמו: ${r.sampled} (הערכה: כ־${r.estimated.toLocaleString("he-IL")} תשובות)`)
  lines.push(`  זמן תגובה ממוצע בשרת: ${r.meanMs === null ? "אין נתונים" : `${r.meanMs} ms`}`)
  lines.push(`  שתי שניות או יותר: ${r.slow}${r.sampled ? ` (${percent(r.slow, r.sampled)})` : ""}`)
  lines.push(`  לפי קוד: ${r.byStatus.map((s) => `${s.code}=${s.n}`).join(", ") || "אין"}`)
  if (summary) {
    lines.push("")
    lines.push("עבודות ומיילים:")
    lines.push(`  גיבוי אחרון: ${summary.export ? `${summary.export.ok ? "הושלם" : "נכשל"} ${clock(summary.export.created_at)}` : "אין"}`)
    const last = summary.retention.last
    lines.push(`  מחיקה אוטומטית אחרונה: ${last ? `${last.ok ? "הושלמה" : "לא הושלמה"} ${clock(last.started_at)}` : "אין"}`)
    const drill = summary.drill
    lines.push(
      `  תרגיל שחזור אחרון: ${drill ? `${drill.ok === null ? "לא הסתיים" : drill.ok ? "הצליח" : `נכשל (${drill.failure ?? "?"})`} ${clock(drill.started_at)}` : "אין"}`,
    )
    const m = summary.mail_delivery
    if (m)
      lines.push(
        `  מיילי אימות: בתור ${m.due + m.retry}, נשלחים ${m.sending}, נמסרו ${m.accepted}, לא ברור ${m.uncertain}, נעצרו ${m.stopped}`,
      )
    const b = summary.mail_budget
    if (b) lines.push(`  מכסת מיילים היום: ${b.public}/${b.public_limit}, התראות טכניות ${b.ops}/${b.ops_limit}`)
    lines.push(`  התראות אחרונות שנשלחו: ${summary.alerts.map((a) => `${a.job} ${clock(a.sent_at)}`).join(", ") || "אין"}`)
  }
  lines.push("")
  lines.push(`ביקורים שדווחו: ${r.visits} (נספר ביקור כשהמבקר עוזב או מסתיר את הדף, אז זו הערכה מלמטה)`)
  for (const m of ["lcp", "inp", "cls"] as const) {
    const v = r.vitals[m]
    const n = v.good + v.ni + v.poor
    lines.push(`  ${VITAL[m]}: ${n ? `טוב ${v.good}, בינוני ${v.ni}, איטי ${v.poor} (${percent(v.good, n)} טוב)` : "אין נתונים"}`)
  }
  lines.push("")
  lines.push("מה עוד לא נמדד: Worker שנעצר בגלל חריגת זמן או זיכרון (רק בלוח של Cloudflare), ותקלות שקורות לפני שהדף נטען בכלל.")
  lines.push("")
  lines.push("המונים הגולמיים (JSON):")
  lines.push(JSON.stringify(health.hours.filter((h) => r.timeline.some((t) => t.hour === h.hour))))
  return lines.join("\n")
}
