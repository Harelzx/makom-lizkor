import { useCallback, useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { fetchHealth, markHealthSeen, type OpsSummary } from "./api"
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
  // When neither way of copying is allowed (some embedded browsers), the report is shown to select and copy by hand.
  const [manual, setManual] = useState("")
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
  const [marking, setMarking] = useState(false)
  const [markFailed, setMarkFailed] = useState(false)
  const mark = async (seen: boolean) => {
    setMarking(true)
    const h = await markHealthSeen(seen)
    setMarking(false)
    setMarkFailed(!h)
    if (h) setHealth(h)
  }
  const reading = useMemo(() => (health ? readHealth(health, summary, hours) : null), [health, summary, hours])

  const copy = async () => {
    if (!health || !reading) return
    const text = healthReport(health, summary, reading)
    const done = await copyText(text)
    setCopied(done ? "done" : "failed")
    setManual(done ? "" : text)
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
      {manual && (
        <div className="mt-4 rounded-2xl border border-(--a-line) bg-(--a-panel) p-4">
          <p className="text-a-14 text-(--a-ink-1)">הדפדפן לא איפשר העתקה אוטומטית. סמנו את הדוח שבתיבה (לחיצה עליה מסמנת הכול) והעתיקו.</p>
          <textarea
            readOnly
            value={manual}
            onFocus={(e) => e.currentTarget.select()}
            rows={8}
            dir="rtl"
            aria-label="הדוח להעתקה"
            className="a-focus-ring mt-2 w-full resize-y rounded-xl border border-(--a-line) bg-(--a-sunk) p-3 font-mono text-a-12 text-(--a-ink-1)"
          />
          <Btn size="sm" variant="ghost" className="mt-1" onClick={() => setManual("")}>
            סגירה
          </Btn>
        </div>
      )}
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

          {(reading.failures.length > 0 || reading.seenAt) && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-a-13 text-(--a-ink-2)">
              {reading.failures.length > 0 && (
                <Btn size="sm" variant="outline" disabled={marking} onClick={() => void mark(true)}>
                  <Glyph name="approve" className="size-3.5" />
                  סימון הכול כנבדק
                </Btn>
              )}
              <span>
                {reading.seenAt
                  ? `סומן כנבדק ${ago(reading.seenAt)}${reading.seenFailures ? `: ${faults(reading.seenFailures)} מלפני כן לא נספרות כאן` : ""}.`
                  : "אחרי שבדקתם: מה שקרה עד עכשיו יירד מהספירה ומהכותרת. הוא יישאר חיוור בגרף ובדוח."}
              </span>
              {reading.seenAt && (
                <Btn size="sm" variant="ghost" disabled={marking} onClick={() => void mark(false)}>
                  ביטול הסימון
                </Btn>
              )}
              {markFailed && <span className="text-(--a-red-ink)">הסימון לא נשמר. נסו שוב.</span>}
            </div>
          )}

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
              <h3 className="text-a-15 font-bold text-(--a-ink-1)">כל התקלות בטווח, ומתי</h3>
              <ul className="mt-2 divide-y divide-(--a-line) rounded-2xl border border-(--a-line) bg-(--a-panel)">
                {reading.failures.map((f) => (
                  <li key={f.code} className="flex items-start justify-between gap-3 px-4 py-2.5 text-a-14">
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-(--a-ink-1)">{f.label}</span>
                      <span className="text-a-13 text-(--a-ink-3) tabular-nums">
                        {f.when.map((w) => `${hourLabel(w.hour)}${w.n > 1 ? ` (${w.n})` : ""}`).join(" · ")}
                      </span>
                    </span>
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

/** «22.10 בשעה 20:00», in Israel's time: the hour a counter starts. A word between the numbers keeps them in order in RTL. */
const hourLabel = (iso: string) => {
  const at = new Date(iso)
  const day = at.toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric" })
  return `${day} בשעה ${at.toLocaleTimeString("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" })}`
}

const faults = (n: number) => (n === 1 ? "תקלה אחת" : `${n} תקלות`)

/** Copy to the clipboard; where the clipboard API is refused, the older selection copy. False when both are. */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement("textarea")
    area.value = text
    area.setAttribute("readonly", "")
    area.style.cssText = "position:fixed;opacity:0;inset-inline-start:0;top:0"
    document.body.append(area)
    area.select()
    try {
      return document.execCommand("copy")
    } catch {
      return false
    } finally {
      area.remove()
    }
  }
}

type Hour = { hour: string; failures: number; seen: number; sampled: number }

const hourSays = (t: Hour) =>
  [
    t.failures ? faults(t.failures) : "בלי תקלות חדשות",
    t.seen ? `${faults(t.seen)} שכבר סומנו כנבדקו` : "",
    t.sampled ? `${t.sampled} פניות לשרת שנבדקו` : "בלי פניות שנבדקו",
  ]
    .filter(Boolean)
    .join(", ")

/**
 * Hour by hour, now at the start of the reading line and the oldest at its end, in a frame of its own with its key
 * beneath it: a grey column for how busy the server was, a red cap on an hour with a failure (pale once looked at).
 * Hovering an hour says what it held; each hour is also a button, so a phone, which has no hover, can ask too.
 */
function Timeline({ timeline }: { timeline: Hour[] }) {
  const [picked, setPicked] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const peak = Math.max(1, ...timeline.map((t) => t.sampled))
  const ordered = [...timeline].reverse()
  const shown = timeline.find((t) => t.hour === picked) ?? ordered.find((t) => t.failures > 0) ?? null
  const mid = timeline[Math.floor(timeline.length / 2)]
  return (
    <figure className="mt-6">
      <figcaption className="text-a-15 font-bold text-(--a-ink-1)">שעה אחרי שעה</figcaption>
      <div className="mt-2 rounded-2xl border border-(--a-line) bg-(--a-panel) px-3 pt-10 pb-2 sm:px-4">
        <div className="flex h-24 items-end gap-0.5" onMouseLeave={() => setHovered(null)}>
          {ordered.map((t, i) => {
            const on = shown?.hour === t.hour
            return (
              <button
                key={t.hour}
                type="button"
                aria-pressed={on}
                aria-label={`${hourLabel(t.hour)}: ${hourSays(t)}`}
                onClick={() => setPicked(t.hour)}
                onMouseEnter={() => setHovered(t.hour)}
                onFocus={() => setHovered(t.hour)}
                onBlur={() => setHovered(null)}
                className={cn(
                  "a-focus-ring group relative flex h-full flex-1 cursor-pointer items-end rounded-t-sm",
                  (on || hovered === t.hour) && "bg-(--a-sunk)",
                )}
              >
                <span
                  className={cn(
                    "w-full rounded-t-sm transition-colors",
                    on ? "bg-(--a-ink-3)" : hovered === t.hour ? "bg-(--a-ink-3)/60" : "bg-(--a-line-2)",
                  )}
                  style={{ height: `${Math.max(4, (t.sampled / peak) * 100)}%` }}
                />
                {(t.failures > 0 || t.seen > 0) && (
                  <span className={cn("absolute inset-x-0 -top-2.5 h-1.5 rounded-full", t.failures ? "bg-(--a-red)" : "bg-(--a-red)/30")} />
                )}
                {hovered === t.hour && (
                  <span
                    role="tooltip"
                    className={cn(
                      "pointer-events-none absolute bottom-full z-10 mb-4 w-max max-w-64 rounded-xl bg-(--a-ink-1) px-3 py-2 text-start text-a-12 leading-snug text-(--a-panel) shadow-(--a-shadow-lg)",
                      i < 4 ? "start-0" : i > ordered.length - 5 ? "end-0" : "start-1/2 translate-x-1/2",
                    )}
                  >
                    <b className="block font-semibold">{hourLabel(t.hour)}</b>
                    {hourSays(t)}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <div className="mt-1.5 flex justify-between border-t border-(--a-line) pt-1.5 text-a-12 text-(--a-ink-3) tabular-nums">
          <span>עכשיו</span>
          <span>{hourLabel(mid.hour)}</span>
          <span>{hourLabel(timeline[0].hour)}</span>
        </div>
      </div>
      <p className="mt-2 rounded-xl bg-(--a-sunk) px-3 py-2 text-a-13 text-(--a-ink-1)" aria-live="polite">
        {shown ? `${hourLabel(shown.hour)}: ${hourSays(shown)}.` : "מעבר עם העכבר או לחיצה על שעה מראים מה היה בה."}
      </p>
      <ul aria-label="מקרא" className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-a-12 text-(--a-ink-2)">
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-3.5 w-2.5 shrink-0 rounded-sm bg-(--a-line-2)" />
          עמודה: כמה עבודה הייתה לשרת באותה שעה
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-1.5 w-3.5 shrink-0 rounded-full bg-(--a-red)" />
          פס אדום מעל עמודה: תקלה באותה שעה
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-1.5 w-3.5 shrink-0 rounded-full bg-(--a-red)/30" />
          פס חיוור: תקלה שכבר סומנה כנבדקה
        </li>
      </ul>
    </figure>
  )
}
