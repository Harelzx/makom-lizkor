import { useState } from "react"
import { Activity, ChartNoAxesColumn, ChevronDown, DatabaseBackup, Gauge, Inbox, LoaderCircle, Mail, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { card } from "./ui"
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
  const row = "flex items-start gap-3 py-3"
  const icon = "mt-1 size-4 shrink-0 text-ink-3"
  return (
    <details
      className={cn(card, "group p-0 sm:p-0")}
      onToggle={(e) => {
        if (e.currentTarget.open && !summary) void load()
      }}
    >
      <summary className="pressable flex cursor-pointer list-none items-center gap-3 rounded-3xl px-5 py-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/30 sm:px-6 [&::-webkit-details-marker]:hidden">
        <Activity aria-hidden className="size-5 shrink-0 text-ink-2" />
        <span className="flex-1 text-title-3 text-ink-1">מצב המערכת</span>
        <ChevronDown
          aria-hidden
          className="size-5 shrink-0 text-ink-3 transition-transform duration-300 ease-(--ease-out-soft) group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="border-t border-line px-5 pt-2 pb-5 text-body text-ink-2 sm:px-6" aria-live="polite">
        {busy && !summary && (
          <div className="flex flex-col gap-3 py-3">
            <p className="flex items-center gap-2">
              <LoaderCircle aria-hidden className="size-4 animate-spin" />
              קורא את המצב העדכני…
            </p>
            <Skeleton aria-hidden className="h-3.5 w-full rounded-full bg-surface-3" />
            <Skeleton aria-hidden className="h-3.5 w-3/4 rounded-full bg-surface-3" />
          </div>
        )}
        {failed && (
          <p className="flex items-start gap-2.5 border-s-2 border-destructive py-1 ps-3 text-destructive dark:border-brand dark:text-brand">
            לא הצלחנו לקרוא את המצב. בדקו שהכניסה עדיין בתוקף ונסו לרענן.
          </p>
        )}
        {summary && (
          <div className={cn("divide-y divide-line transition-opacity", busy && "opacity-60")}>
            <p className={row}>
              <Inbox aria-hidden className={icon} />
              ממתינות לבדיקה: {summary.queue.pending}. מתוכן יותר משבועיים: {summary.queue.overdue}.
            </p>
            {mail && (
              <p className={row}>
                <Mail aria-hidden className={icon} />
                <span>
                  מיילי אימות שממתינים למשלוח: {mail.due + mail.retry}. מסירות לא ודאיות: {mail.uncertain}. מסירות שנעצרו: {mail.stopped}.
                  לפני שליחה חוזרת של מסירה לא ודאית, בדקו בתיבת הדואר.
                </span>
              </p>
            )}
            {budget && (
              <p className={row}>
                <Gauge aria-hidden className={icon} />
                <span>
                  ניסיונות דואר היום: {budget.public} מתוך {budget.public_limit}; התראות תפעול: {budget.ops} מתוך {budget.ops_limit}.
                </span>
              </p>
            )}
            <p className={row}>
              <ChartNoAxesColumn aria-hidden className={icon} />
              {summary.errors.status === "ok" ? (
                <span>
                  בדגימה: {summary.errors.requests} בקשות, מתוכן {Object.values(summary.errors.by_code).reduce((a, b) => a + b, 0)} תשובות
                  שגיאה או סירוב.{" "}
                  {summary.errors.sample_every ? `נדגמת בממוצע בקשה אחת מכל ${summary.errors.sample_every}. זהו אומדן ולא נתון חיוב.` : ""}
                </span>
              ) : (
                <span>עדיין אין דגימת בקשות זמינה. אין להסיק מכך שאין תקלות.</span>
              )}
            </p>
            <p className={row}>
              <DatabaseBackup aria-hidden className={icon} />
              <span>
                גיבוי אחרון: {summary.export?.ok ? "הושלם" : "דורש בדיקה"}. עבודת מחיקה אחרונה:{" "}
                {summary.retention.last?.ok ? "הושלמה" : "דורשת בדיקה"}.
              </span>
            </p>
            <p className="py-3 text-caption text-ink-3">
              הנתונים הם ספירות בלבד. תוכן פניות, כתובות וקישורי מעקב אינם נשמרים במוני התפעול.
            </p>
          </div>
        )}
        <Button variant="outline" className="pressable mt-2" disabled={busy} onClick={() => void load()}>
          <RefreshCw aria-hidden className={cn(busy && "animate-spin")} />
          רענון מצב
        </Button>
      </div>
    </details>
  )
}
