import { useCallback, useEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { importCurated } from "../../scripts/curated-import.mjs"
import { MAX_PACKET_BYTES, readImportPacket } from "./import-packet"
import { fetchPlace, fetchSummary, request, type OpsSummary, type PlaceView } from "./api"
import { Btn, Field, inputClass } from "./controls"
import { EraseForm, HideForm } from "./report"
import { Alert, Glyph, Kbd } from "./parts"
import { ago } from "./inbox-state"
import type { GlyphName } from "./glyphs"

/** The operations counts as a few lines a person reads: each with its own mark, and a red line only where action is due. */
export function useSummary() {
  const [summary, setSummary] = useState<OpsSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const load = useCallback(async () => {
    setBusy(true)
    const s = await fetchSummary()
    setBusy(false)
    setFailed(!s)
    if (s) setSummary(s)
  }, [])
  return { summary, busy, failed, load }
}

export function SystemStatus({ status }: { status: ReturnType<typeof useSummary> }) {
  const { summary, busy, failed, load } = status
  useEffect(() => {
    if (!summary && !busy) void load()
    // Only on first show; a refresh is the button's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const mail = summary?.mail_delivery
  const budget = summary?.mail_budget
  const errors = summary && summary.errors.status === "ok" ? Object.values(summary.errors.by_code).reduce((a, b) => a + b, 0) : null
  const rows: { glyph: GlyphName; title: string; value: string; warn?: boolean; detail?: string }[] = summary
    ? [
        {
          glyph: "queue",
          title: "ממתינות לבדיקה",
          value: String(summary.queue.pending),
          warn: summary.queue.overdue > 0,
          detail: `ממתינות לבדיקה: ${summary.queue.pending}. מתוכן יותר משבועיים: ${summary.queue.overdue}.`,
        },
        ...(mail
          ? [
              {
                glyph: "mail" as const,
                title: "מיילים",
                value: String(mail.due + mail.retry),
                warn: mail.uncertain + mail.stopped > 0,
                detail: `ממתינים למשלוח: ${mail.due + mail.retry}. מסירות לא ודאיות: ${mail.uncertain}. נעצרו: ${mail.stopped}. לפני שליחה חוזרת של מסירה לא ודאית, בדקו בתיבת הדואר.`,
              },
            ]
          : []),
        ...(budget
          ? [
              {
                glyph: "pulse" as const,
                title: "מכסת דואר היום",
                value: `${budget.public}/${budget.public_limit}`,
                warn: budget.public > budget.public_limit * 0.8,
                detail: `ניסיונות דואר היום: ${budget.public} מתוך ${budget.public_limit}; התראות תפעול: ${budget.ops} מתוך ${budget.ops_limit}.`,
              },
            ]
          : []),
        {
          glyph: "reject",
          title: "שגיאות בדגימה",
          value: errors === null ? "—" : String(errors),
          detail:
            summary.errors.status === "ok"
              ? `בדגימה: ${summary.errors.requests} בקשות, מתוכן ${errors} תשובות שגיאה או סירוב.${summary.errors.sample_every ? ` נדגמת בממוצע בקשה אחת מכל ${summary.errors.sample_every}: אומדן, לא נתון חיוב.` : ""}`
              : "עדיין אין דגימת בקשות זמינה. אין להסיק מכך שאין תקלות.",
        },
        {
          glyph: "import",
          title: "גיבוי ומחיקות",
          value: summary.export?.ok && summary.retention.last?.ok ? "תקין" : "לבדוק",
          warn: !(summary.export?.ok && summary.retention.last?.ok),
          detail: `גיבוי אחרון: ${summary.export?.ok ? `הושלם ${ago(summary.export.created_at)}` : "דורש בדיקה"}. עבודת מחיקה אחרונה: ${summary.retention.last?.ok ? "הושלמה" : "דורשת בדיקה"}.`,
        },
      ]
    : []
  return (
    <section aria-labelledby="status-title" aria-busy={busy || undefined}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="status-title" className="text-[1.375rem] font-bold text-(--a-ink-1)">
          מצב המערכת
        </h2>
        <Btn size="sm" variant="ghost" disabled={busy} onClick={() => void load()}>
          <Glyph name="restore" className={cn("size-3.5", busy && "animate-spin")} />
          רענון
        </Btn>
      </div>
      {summary && (
        <p className="mt-1 text-[0.8125rem] text-(--a-ink-3)">
          עודכן {ago(summary.generated_at)}. ספירות בלבד: בלי תוכן פניות, כתובות או קישורי מעקב.
        </p>
      )}
      {failed && <Alert className="mt-4">לא הצלחנו לקרוא את המצב. בדקו שהכניסה עדיין בתוקף ונסו לרענן.</Alert>}
      {!summary && busy && (
        <div aria-hidden className="mt-4 grid gap-2 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-(--a-sunk)" />
          ))}
        </div>
      )}
      {summary && (
        <ul className={cn("mt-4 grid gap-2 transition-opacity sm:grid-cols-2", busy && "opacity-60")}>
          {rows.map((r) => (
            <li key={r.title} className="rounded-2xl border border-(--a-line) bg-(--a-panel) p-4">
              <div className="flex items-center gap-2 text-[0.8125rem] font-bold text-(--a-ink-3)">
                <Glyph name={r.glyph} className="size-4" />
                {r.title}
              </div>
              <p
                className={cn("mt-1.5 text-[1.625rem] leading-none font-bold tabular-nums", r.warn ? "text-(--a-sun)" : "text-(--a-ink-1)")}
              >
                {r.value}
              </p>
              {r.detail && <p className="mt-2 text-[0.8125rem] leading-relaxed text-(--a-ink-2)">{r.detail}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** A place reached by its link or id, for a request that came by mail or phone: hide what was asked, or delete it. */
export function PlaceLookup() {
  const [input, setInput] = useState("")
  const [place, setPlace] = useState<PlaceView | null>(null)
  const [message, setMessage] = useState("")
  const idOf = (s: string) => /(?:\/place\/|#\/place\/)?([A-Za-z0-9_-]{1,80})\/?$/.exec(s.trim())?.[1] ?? ""
  const load = async (id: string) => {
    if (!id) return
    const view = await fetchPlace(id)
    if (typeof view === "string") {
      setPlace(null)
      setMessage(view === "missing" ? "לא נמצא מקום כזה." : "לא הצלחנו לטעון את המקום.")
      return
    }
    setMessage("")
    setPlace(view)
  }
  return (
    <section aria-labelledby="lookup-title">
      <h2 id="lookup-title" className="text-[1.375rem] font-bold text-(--a-ink-1)">
        בקשה שהגיעה במייל או בטלפון
      </h2>
      <p className="mt-1 text-[0.9375rem] text-(--a-ink-2)">הדביקו את קישור השיתוף של המקום, והסתירו או מחקו לפי הבקשה.</p>
      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void load(idOf(input))
        }}
      >
        <Field label="מקום לפי קישור או מזהה" className="min-w-60 flex-1">
          {(p) => (
            <input
              {...p}
              dir="ltr"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="https://makomlizkor.org/place/…"
              className={cn(inputClass, "h-11")}
            />
          )}
        </Field>
        <Btn type="submit" variant="primary" disabled={!idOf(input)}>
          <Glyph name="search" />
          פתיחה
        </Btn>
      </form>
      {message && (
        <p role="status" className="mt-4 text-[0.9375rem] text-(--a-ink-2)">
          {message}
        </p>
      )}
      {place && (
        <div className="mt-5 flex flex-col gap-5 rounded-2xl border border-(--a-line) bg-(--a-panel) p-4 sm:p-5">
          <p className="text-[0.875rem] text-(--a-ink-3)">
            <span dir="ltr">{place.id}</span> · {place.status === "erased" ? "נמחק" : place.status === "hidden" ? "מוסתר" : "מפורסם"}
            {place.suppressions.length > 0 && ` · מוסתרים ${place.suppressions.length} שדות`}
          </p>
          <HideForm
            place={place}
            done={async (error) => {
              await load(place.id)
              setMessage(error || "ההסתרה נשמרה.")
            }}
          />
          <EraseForm
            place={place}
            done={async (error) => {
              await load(place.id)
              setMessage(error || "המקום נמחק.")
            }}
          />
        </div>
      )}
    </section>
  )
}

type Packet = ReturnType<typeof readImportPacket>
/** The site's own places from a packet prepared with their sources, through the ordinary approval route; insert only. */
export function CuratedImport() {
  const [packet, setPacket] = useState<Packet | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const selection = useRef(0)
  async function choose(file: File | undefined) {
    const id = ++selection.current
    setPacket(null)
    setMessage("")
    setError("")
    if (!file) return
    try {
      if (file.size > MAX_PACKET_BYTES) throw new Error("קובץ היבוא גדול מדי.")
      const next = readImportPacket(await file.text())
      if (id === selection.current) setPacket(next)
    } catch (e) {
      if (id === selection.current) setError(e instanceof Error ? e.message : "לא ניתן לקרוא את הקובץ.")
    }
  }
  async function publish() {
    if (!packet || busy) return
    setBusy(true)
    setError("")
    setMessage("מייבאים את המקומות. השאירו את העמוד פתוח.")
    try {
      const result = await importCurated({
        fetch: (url: string, init?: RequestInit) => request(url, { ...init, credentials: "same-origin", redirect: "error" }),
        base: location.origin,
        records: packet.places,
        headers: {},
        readPhoto: async (file: string) => {
          const picture = packet.pictures.get(file)
          if (!picture) throw new Error("missing_picture")
          return picture
        },
      })
      setMessage(`היבוא הושלם: ${result.created.length} מקומות פורסמו, ${result.skipped.length} מקומות קיימים נשארו ללא שינוי.`)
    } catch {
      setMessage("")
      setError(
        "היבוא נעצר. מקומות שכבר פורסמו נשמרו. בדקו את החיבור ואת כניסת המנהל; לאחר מכן אפשר להמשיך עם אותו קובץ. מקומות קיימים לא ישתנו.",
      )
    } finally {
      setBusy(false)
    }
  }
  const done = !busy && message.startsWith("היבוא הושלם")
  return (
    <section aria-labelledby="import-title">
      <h2 id="import-title" className="text-[1.375rem] font-bold text-(--a-ink-1)">
        יבוא מקומות האתר
      </h2>
      <p className="mt-1 text-[0.9375rem] text-(--a-ink-2)">
        מקומות שהאתר עצמו מביא, מקובץ שהוכן מראש עם המקורות, התמונות והרישיונות. הפרסום עובר במסלול האישור הרגיל, ומקומות קיימים לא ייערכו.
      </p>
      <label
        className={cn(
          "mt-4 flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-(--a-line-2) bg-(--a-panel) px-6 py-8 text-center transition-colors hover:border-(--a-ink-3) has-focus-visible:outline-2 has-focus-visible:outline-(--a-focus)",
          busy && "pointer-events-none opacity-60",
        )}
      >
        <Glyph name="import" className="size-8 text-(--a-ink-2)" />
        <span id="import-file-label" className="text-[0.9375rem] font-semibold text-(--a-ink-1)">
          קובץ יבוא JSON
        </span>
        <span id="import-file-hint" className="text-[0.8125rem] text-(--a-ink-3)">
          לחיצה לבחירת קובץ
        </span>
        <input
          aria-labelledby="import-file-label"
          aria-describedby="import-file-hint"
          type="file"
          accept="application/json,.json"
          disabled={busy}
          className="sr-only"
          onChange={(e) => void choose(e.target.files?.[0])}
        />
      </label>
      {packet && (
        <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-(--a-line) bg-(--a-panel) p-4">
          <p className="flex items-center gap-2 text-[0.9375rem] font-medium text-(--a-ink-1)">
            <Glyph name="queue" className="size-4 text-(--a-ink-3)" />
            מוכנים לפרסום: {packet.places.length} מקומות ו־{packet.photoCount} תמונות.
          </p>
          <ul className="max-h-48 divide-y divide-(--a-line) overflow-auto rounded-xl border border-(--a-line) text-[0.875rem]">
            {packet.places.map((p) => (
              <li key={p.id} className="px-3 py-2">
                {p.name_he}
              </li>
            ))}
          </ul>
          <Btn variant="primary" className="self-start" disabled={busy} onClick={() => void publish()}>
            {busy ? (
              <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <Glyph name="import" />
            )}
            פרסום המקומות שנבחרו
          </Btn>
        </div>
      )}
      {message && (
        <p role="status" className={cn("mt-4 flex items-start gap-2.5 text-[0.9375rem]", done ? "text-(--a-ink-1)" : "text-(--a-ink-2)")}>
          <Glyph name={done ? "approve" : "clock"} className={cn("mt-1 size-4", done && "text-(--a-green)")} />
          {message}
        </p>
      )}
      {error && <Alert className="mt-4">{error}</Alert>}
    </section>
  )
}

export const SHORTCUTS: [string[], string][] = [
  [["J", "↓"], "הפריט הבא"],
  [["K", "↑"], "הפריט הקודם"],
  [["א", "A"], "אישור ההצעה"],
  [["ת", "R"], "החזרה לתיקון"],
  [["ד", "D"], "דחיית ההצעה"],
  [["Esc"], "חזרה, או סגירה"],
  [["?"], "החלון הזה"],
]
export function Shortcuts({
  open,
  onOpenChange,
  extra = [],
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  extra?: [string[], string][]
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="admin-ui font-admin">
        <DialogHeader>
          <DialogTitle className="text-[1.25rem] font-bold">קיצורי מקלדת</DialogTitle>
          <DialogDescription className="text-[0.9375rem] text-(--a-ink-2)">
            פועלים בכל מקום בעמוד, חוץ מבתוך שדה כתיבה, ובכל פריסת מקלדת.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-3 text-[0.9375rem]">
          {[...SHORTCUTS, ...extra].map(([k, what]) => (
            <div key={what} className="contents">
              <dt className="flex gap-1">
                {k.map((key) => (
                  <Kbd key={key} className="inline-grid h-6 min-w-6 text-[0.75rem] opacity-80">
                    {key}
                  </Kbd>
                ))}
              </dt>
              <dd className="text-(--a-ink-2)">{what}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The keys, by their place on the keyboard (e.code), so they work on a Hebrew layout too; the Hebrew letters on the
 * buttons are what that layout types there. Never while typing, never with a modifier, never under a dialog.
 */
export function useKeys(on: Partial<Record<"next" | "prev" | "approve" | "return" | "reject" | "escape" | "help" | "list", () => void>>) {
  const ref = useRef(on)
  useEffect(() => {
    ref.current = on
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
      const el = e.target as HTMLElement
      if (el.closest("input, textarea, select, [contenteditable=true], [role=dialog], [role=alertdialog]")) return
      const key =
        e.key === "?" || (e.code === "Slash" && e.shiftKey)
          ? "help"
          : e.key === "Escape"
            ? "escape"
            : (
                {
                  KeyJ: "next",
                  ArrowDown: "next",
                  KeyK: "prev",
                  ArrowUp: "prev",
                  KeyA: "approve",
                  KeyR: "return",
                  KeyD: "reject",
                  KeyL: "list",
                } as const
              )[e.code as "KeyJ"]
      const run = key && ref.current[key]
      if (!run) return
      e.preventDefault()
      run()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])
}
