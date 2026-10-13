import { useState } from "react"
import { Button } from "@/components/ui/button"
import { OpsSummary } from "../../worker/lib/ops-schema"

/** Existing owner sign-in only. Aggregates, no contacts, private links or request contents. */
export function Operations() {
  const [summary, setSummary] = useState<OpsSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const load = async () => {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      const response = await fetch("/api/admin/summary", { cache: "no-store", signal: AbortSignal.timeout(8000) })
      if (!response.ok) throw new Error("unavailable")
      setSummary(OpsSummary.parse(await response.json()))
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  const mail = summary?.mail_delivery
  const budget = summary?.mail_budget
  return (
    <details
      className="rounded-2xl border border-line bg-surface px-5 py-4"
      onToggle={(e) => {
        if (e.currentTarget.open && !summary) void load()
      }}
    >
      <summary className="cursor-pointer text-title-3 text-ink-1">מצב המערכת</summary>
      <div className="mt-4 space-y-4 text-body text-ink-2" aria-live="polite">
        {busy && <p>קורא את המצב העדכני…</p>}
        {failed && <p>לא הצלחנו לקרוא את המצב. בדקו שהכניסה עדיין בתוקף ונסו לרענן.</p>}
        {summary && (
          <>
            <p>
              ממתינות לבדיקה: {summary.queue.pending}. מתוכן יותר משבועיים: {summary.queue.overdue}.
            </p>
            {mail && (
              <p>
                מיילי אימות שממתינים למשלוח: {mail.due + mail.retry}. מסירות לא ודאיות: {mail.uncertain}. מסירות שנעצרו: {mail.stopped}.
                לפני שליחה חוזרת של מסירה לא ודאית, בדקו בתיבת הדואר.
              </p>
            )}
            {budget && (
              <p>
                ניסיונות דואר היום: {budget.public} מתוך {budget.public_limit}; התראות תפעול: {budget.ops} מתוך {budget.ops_limit}.
              </p>
            )}
            {summary.errors.status === "ok" ? (
              <p>
                בדגימה: {summary.errors.requests} בקשות, מתוכן {Object.values(summary.errors.by_code).reduce((a, b) => a + b, 0)} תשובות
                שגיאה או סירוב.{" "}
                {summary.errors.sample_every ? `נדגמת בממוצע בקשה אחת מכל ${summary.errors.sample_every}. זהו אומדן ולא נתון חיוב.` : ""}
              </p>
            ) : (
              <p>עדיין אין דגימת בקשות זמינה. אין להסיק מכך שאין תקלות.</p>
            )}
            <p>
              גיבוי אחרון: {summary.export?.ok ? "הושלם" : "דורש בדיקה"}. עבודת מחיקה אחרונה:{" "}
              {summary.retention.last?.ok ? "הושלמה" : "דורשת בדיקה"}.
            </p>
            <p className="text-caption">הנתונים הם ספירות בלבד. תוכן פניות, כתובות וקישורי מעקב אינם נשמרים במוני התפעול.</p>
          </>
        )}
        <Button variant="outline" disabled={busy} onClick={() => void load()}>
          רענון מצב
        </Button>
      </div>
    </details>
  )
}
