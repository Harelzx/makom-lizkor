import { useCallback, useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { fetchHealth, type OpsSummary } from "./api"
import type { SiteHealth } from "../../worker/lib/health-schema"
import { Btn } from "./controls"
import { Alert, Glyph } from "./parts"
import bouquet from "./assets/bouquet.webp"
import { ago } from "./inbox-state"
import { failureLabel, HEADLINE, healthReport, readHealth, type Level } from "./health-model"

const WINDOWS = [
  { hours: 6, label: "שש שעות" },
  { hours: 24, label: "יממה" },
  { hours: 48, label: "יומיים" },
] as const

const TONE: Record<Level, { dot: string; ink: string; soft: string }> = {
  good: { dot: "bg-(--a-green)", ink: "text-(--a-green-ink)", soft: "bg-(--a-green-soft)" },
  watch: { dot: "bg-(--a-sun)", ink: "text-(--a-ink-1)", soft: "bg-(--a-sun-soft)" },
  bad: { dot: "bg-(--a-red)", ink: "text-(--a-red-ink)", soft: "bg-(--a-red-soft)" },
  empty: { dot: "bg-(--a-line-2)", ink: "text-(--a-ink-2)", soft: "bg-(--a-sunk)" },
}

/**
 * «מה שלום האתר»: one line that says whether all is well and why not, the failures counted in the chosen window, the
 * server's pace, an hour-by-hour strip, and a button that copies all of it as a report to paste to a developer.
 */
export function SiteHealthPanel({ summary }: { summary: OpsSummary | null }) {
  const [health, setHealth] = useState<SiteHealth | null>(null)
  // The first read starts with the screen; later ones are the refresh button's.
  const [busy, setBusy] = useState(true)
  const [failed, setFailed] = useState(false)
  const [hours, setHours] = useState<number>(24)
  const [copied, setCopied] = useState<"" | "done" | "failed">("")
  const settle = useCallback((h: SiteHealth | null) => {
    setBusy(false)
    setFailed(!h)
    if (h) setHealth(h)
  }, [])
  const load = useCallback(async () => {
    setBusy(true)
    settle(await fetchHealth())
  }, [settle])
  useEffect(() => {
    let live = true
    void fetchHealth().then((h) => live && settle(h))
    return () => {
      live = false
    }
  }, [settle])
  const reading = useMemo(() => (health ? readHealth(health, summary, hours) : null), [health, summary, hours])

  const copy = async () => {
    if (!health || !reading) return
    try {
      await navigator.clipboard.writeText(healthReport(health, summary, reading))
      setCopied("done")
    } catch {
      setCopied("failed")
    }
    window.setTimeout(() => setCopied(""), 4000)
  }

  const tone = TONE[reading?.level ?? "empty"]
  const otherIssues = reading ? Object.entries(reading.issues).filter(([k]) => k !== "crash" && k !== "stale_bundle") : []
  const others = (reading?.browserErrors ?? 0) + otherIssues.reduce((a, [, n]) => a + n, 0)
  const breakdown = [
    ...Object.entries(reading?.errorKinds ?? {}).map(([k, n]) => `${failureLabel(`err_client_error_${k}`)}: ${n}`),
    ...otherIssues.map(([k, n]) => `${failureLabel(`err_client_${k}`)}: ${n}`),
  ].join(" · ")
  const lcpTotal = reading ? reading.vitals.lcp.good + reading.vitals.lcp.ni + reading.vitals.lcp.poor : 0
  return (
    <section aria-labelledby="health-title" aria-busy={busy || undefined} className="mb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="health-title" className="text-a-22 font-bold text-(--a-ink-1)">
          מה שלום האתר
        </h2>
        <div className="flex items-center gap-1">
          <Btn size="sm" variant="ghost" disabled={busy} onClick={() => void load()}>
            <Glyph name="restore" className={cn("size-3.5", busy && "animate-spin")} />
            רענון
          </Btn>
          <Btn size="sm" variant="outline" disabled={!reading} onClick={() => void copy()}>
            <Glyph name="import" className="size-3.5" />
            {copied === "done" ? "הדוח הועתק" : copied === "failed" ? "ההעתקה לא הצליחה" : "העתקת דוח"}
          </Btn>
        </div>
      </div>
      <p className="mt-1 text-a-13 text-(--a-ink-3)" aria-live="polite">
        {copied === "done"
          ? "הדוח המלא בלוח. אפשר להדביק אותו בשיחה עם מי שמטפל באתר."
          : health
            ? `עודכן ${ago(health.generated_at)} · גרסה ${health.version ?? "לא ידועה"}`
            : ""}
      </p>
      {failed && <Alert className="mt-4">לא הצלחנו לקרוא את הנתונים. רעננו את העמוד (ייתכן שצריך להתחבר מחדש) ונסו שוב.</Alert>}
      {!reading && busy && <div aria-hidden className="mt-4 h-40 animate-pulse rounded-2xl bg-(--a-sunk)" />}

      {reading && (
        <div className={cn("mt-4 transition-opacity", busy && "opacity-60")}>
          <div className={cn("relative overflow-hidden rounded-2xl p-4", tone.soft, reading.level === "good" && "pe-28 sm:pe-36")}>
            {reading.level === "good" && (
              <img
                src={bouquet}
                alt=""
                width={140}
                height={140}
                className="pointer-events-none absolute -end-2 -bottom-4 size-28 -rotate-12 select-none sm:size-36"
                draggable={false}
              />
            )}
            <p className={cn("flex items-center gap-2.5 text-a-18 font-bold", tone.ink)}>
              <span aria-hidden className={cn("size-2.5 rounded-full", tone.dot)} />
              {HEADLINE[reading.level]}
            </p>
            {reading.reasons.length > 0 ? (
              <ul className="mt-2 space-y-1 text-a-15 leading-relaxed text-(--a-ink-1)">
                {reading.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-a-15 text-(--a-ink-2)">
                {reading.level === "empty"
                  ? "השרת עוד לא אסף מספרים. זה לא אומר שאין תקלות."
                  : `ב־${hours} השעות האחרונות לא נרשמה תקלה בשרת, בעבודות הרקע או בדפדפנים של מבקרים.`}
              </p>
            )}
          </div>

          <div role="radiogroup" aria-label="טווח זמן" className="mt-5 inline-flex rounded-xl bg-(--a-sunk) p-1">
            {WINDOWS.map((w) => (
              <button
                key={w.hours}
                type="button"
                role="radio"
                aria-checked={hours === w.hours}
                onClick={() => setHours(w.hours)}
                className={cn(
                  "h-8 rounded-lg px-3 text-a-13 font-semibold transition-colors",
                  hours === w.hours ? "bg-(--a-panel) text-(--a-ink-1) shadow-sm" : "text-(--a-ink-3) hover:text-(--a-ink-1)",
                )}
              >
                {w.label}
              </button>
            ))}
          </div>

          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            <Card
              title="שגיאות בשרת"
              value={reading.serverErrors}
              warn={reading.serverErrors > 0}
              detail="פעמים שמבקר ביקש משהו מהשרת וקיבל שגיאה. כל אחת נספרת."
            />
            <Card
              title="עבודות רקע שנכשלו"
              value={reading.jobFailures}
              warn={reading.jobFailures > 0}
              detail="גיבוי, מחיקה אוטומטית, מיילים וכדומה. אם משהו כאן לא אפס, צריך בדיקה טכנית."
            />
            <Card
              title="קריסות (מסך לבן)"
              value={reading.issues.crash ?? 0}
              warn={(reading.issues.crash ?? 0) > 0}
              detail="פעמים שהאתר קרס אצל מבקר והוא נשאר מול מסך ריק. כל קריסה חשובה."
            />
            <Card
              title="תקלות אחרות אצל מבקרים"
              value={others}
              warn={others >= 5}
              detail={
                others
                  ? `${breakdown}. נשלח רק סוג התקלה, בלי שום פרט על המבקר או על המקום.`
                  : "מפה, תמונות, רשימת המקומות ושגיאות בקוד האתר. נשלח רק סוג התקלה, בלי שום פרט על המבקר."
              }
            />
            <Card
              title="מהירות טעינה אצל מבקרים"
              value={lcpTotal ? `${Math.round((reading.vitals.lcp.good * 100) / lcpTotal)}%` : "—"}
              warn={lcpTotal >= 20 && reading.vitals.lcp.poor / lcpTotal >= 0.25}
              detail={
                lcpTotal
                  ? `מהביקורים נטענו מהר. ${reading.vitals.lcp.ni} בינוניים, ${reading.vitals.lcp.poor} איטיים, מתוך ${reading.visits.toLocaleString("he-IL")} ביקורים שדווחו.`
                  : "עוד לא דווחו ביקורים בטווח הזה. ביקור נספר כשהמבקר עוזב את הדף."
              }
            />
            <Card
              title="מהירות השרת"
              value={reading.meanMs === null ? "—" : `${(reading.meanMs / 1000).toLocaleString("he-IL", { maximumFractionDigits: 2 })} שנ׳`}
              warn={reading.sampled >= 20 && reading.slow / reading.sampled >= 0.1}
              detail={
                reading.sampled
                  ? `זמן ממוצע לתשובה, בשניות. ${reading.slow} מתוך ${reading.sampled} תשובות שנבדקו לקחו שתי שניות או יותר. בערך ${reading.estimated.toLocaleString("he-IL")} תשובות בסך הכול (נבדקת אחת מכל ${health!.sample_every}).`
                  : "עוד אין תשובות שנבדקו בטווח הזה."
              }
            />
          </ul>

          <Timeline timeline={reading.timeline} />

          {reading.failures.length > 0 && (
            <div className="mt-5">
              <h3 className="text-a-15 font-bold text-(--a-ink-1)">כל התקלות בטווח</h3>
              <ul className="mt-2 divide-y divide-(--a-line) rounded-2xl border border-(--a-line) bg-(--a-panel)">
                {reading.failures.map((f) => (
                  <li key={f.code} className="flex items-center justify-between gap-3 px-4 py-2.5 text-a-14">
                    <span className="text-(--a-ink-1)">{f.label}</span>
                    <span className="font-bold text-(--a-ink-1) tabular-nums">{f.n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function Card({ title, value, detail, warn }: { title: string; value: number | string; detail: string; warn?: boolean }) {
  return (
    <li className="rounded-2xl border border-(--a-line) bg-(--a-panel) p-4">
      <p className="text-a-13 font-bold text-(--a-ink-3)">{title}</p>
      <p className={cn("mt-1.5 text-a-26 leading-none font-bold tabular-nums", warn ? "text-(--a-sun)" : "text-(--a-ink-1)")}>
        {typeof value === "number" ? value.toLocaleString("he-IL") : value}
      </p>
      <p className="mt-2 text-a-13 leading-relaxed text-(--a-ink-2)">{detail}</p>
    </li>
  )
}

/** Hour by hour, oldest at the start of the line: a red mark for each hour with a failure, grey for the traffic. */
function Timeline({ timeline }: { timeline: { hour: string; failures: number; sampled: number }[] }) {
  const peak = Math.max(1, ...timeline.map((t) => t.sampled))
  const label = (iso: string) =>
    new Date(iso).toLocaleTimeString("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" })
  return (
    <figure className="mt-5">
      <figcaption className="text-a-13 font-bold text-(--a-ink-3)">שעה אחרי שעה</figcaption>
      <div className="mt-2 flex h-16 items-end gap-px" dir="ltr">
        {timeline.map((t) => (
          <div
            key={t.hour}
            title={`${label(t.hour)}: ${t.failures} תקלות, ${t.sampled} תשובות שנבדקו`}
            className="relative flex h-full flex-1 items-end"
          >
            <div className="w-full rounded-t-sm bg-(--a-line-2)" style={{ height: `${Math.max(4, (t.sampled / peak) * 100)}%` }} />
            {t.failures > 0 && <div className="absolute inset-x-0 top-0 h-1.5 rounded-full bg-(--a-red)" />}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-a-12 text-(--a-ink-3) tabular-nums" dir="ltr">
        <span>{label(timeline[0].hour)}</span>
        <span>עכשיו</span>
      </div>
      <p className="mt-1.5 text-a-12 text-(--a-ink-3)">אפור: כמה פניות היו לשרת. קו אדום מעל שעה: הייתה בה תקלה.</p>
    </figure>
  )
}
