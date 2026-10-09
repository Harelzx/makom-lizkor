import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { BASIS_LABEL, ELEMENT_LABEL, REQUESTER_LABEL } from "@/data/reports"
import { ELEMENTS, type Element } from "@/shared/contract"
import { createPager, type Page, type PagerState } from "./pager"

interface Report {
  id: string
  place_id: string
  origin: "contribution" | "curated"
  elements: string
  requester_type: keyof typeof REQUESTER_LABEL
  relationship: string | null
  explanation: string | null
  has_contact: number
  outcome: "hidden_for_review" | "received"
  status: "open" | "in_review" | "closed"
  received_at: string
  handling_note: string | null
  place_name: string | null
}
interface Suppression {
  id: string
  field: Element
  kind: "precautionary" | "manual"
  report_id: string | null
  created_at: string
  reason: string | null
}
interface PlaceView {
  id: string
  status: string
  rev: number
  suppressions: Suppression[]
}
interface Attention {
  id: string
  place_id: string
  kind: string
  problem: "interrupted" | "ledger_repair" | "media_failed" | "purge_abandoned"
}

const PROBLEM: Record<Attention["problem"], string> = {
  interrupted: "הסתרה שנעצרה לפני שנשמרה: צריך לבצע אותה שוב",
  ledger_repair: "ההחלטה נשמרה, אבל הרישום ב־ledger עוד לא הושלם",
  media_failed: "העברת קובץ לא הושלמה",
  purge_abandoned: "ניקוי המטמון בקצה לא הצליח; העותק יפוג תוך דקה",
}
const when = (iso: string) => new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" })

async function send(url: string, body: unknown): Promise<string> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    if (res.ok) return ""
    const { code } = (await res.json().catch(() => ({}))) as { code?: string }
    return REFUSAL[code ?? ""] ?? "הפעולה לא נשמרה. נסו שוב."
  } catch {
    return "אין חיבור לשרת. הפעולה לא נשמרה."
  }
}
const REFUSAL: Record<string, string> = {
  changed_meanwhile: "המקום השתנה בינתיים. טענו מחדש ונסו שוב.",
  ledger_unavailable: "אי אפשר לרשום את ההחלטה כרגע, ולכן היא לא בוצעה. נסו שוב בעוד דקה.",
  basis_confirmation_required: "צריך לאשר את שתי ההצהרות על בסיס ההחזרה.",
  evidence_required: "בהסדרת זכויות צריך הפניה לראיה.",
  adviser_required: "בייעוץ משפטי צריך את שם היועץ ואת התאריך.",
  verification_required: "צריך לתעד איך נבדקה הבקשה.",
  correction_required: "צריך גרסה חדשה שאושרה, ואישור שהחומר שבמחלוקת איננו בה.",
  family_contact_required: "ההסתרה נבעה מבקשה משפחתית: צריך לתעד פנייה למשפחה או לגוף שהקים את האנדרטה.",
  note_required: "צריך לכתוב מה נעשה.",
}

/** Lifting one hide, with the basis its code needs. The code checks it was recorded; the judgment stays the moderator's. */
function LiftForm({ place, sup, done }: { place: PlaceView; sup: Suppression; done: (error: string) => void }) {
  const [code, setCode] = useState<keyof typeof BASIS_LABEL>("review_supports_restore")
  const [note, setNote] = useState("")
  const [affirmative, setAffirmative] = useState(false)
  const [notSilence, setNotSilence] = useState(false)
  const [extra, setExtra] = useState({
    evidenceRef: "",
    adviserName: "",
    adviceDate: "",
    verificationNote: "",
    contactNote: "",
    contactDate: "",
  })
  const [absent, setAbsent] = useState(false)
  const set = (k: keyof typeof extra) => (e: { target: { value: string } }) => setExtra({ ...extra, [k]: e.target.value })
  const id = `lift-${sup.id}`
  return (
    <form
      className="mt-2 flex flex-col gap-3 rounded-xl border border-line p-3"
      onSubmit={async (e) => {
        e.preventDefault()
        done(
          await send(`/api/admin/suppressions/${sup.id}/lift`, {
            expectedRev: place.rev,
            basisCode: code,
            basisNote: note.trim(),
            confirm: { affirmativeBasis: affirmative, notNonresponseOrDispute: notSilence },
            ...(extra.evidenceRef.trim() ? { evidenceRef: extra.evidenceRef.trim() } : {}),
            ...(extra.adviserName.trim() ? { adviserName: extra.adviserName.trim() } : {}),
            ...(extra.adviceDate ? { adviceDate: extra.adviceDate } : {}),
            ...(extra.verificationNote.trim() ? { verificationNote: extra.verificationNote.trim() } : {}),
            ...(extra.contactNote.trim() && extra.contactDate
              ? { familyContact: { note: extra.contactNote.trim(), date: extra.contactDate } }
              : {}),
            ...(code === "content_corrected" ? { materialAbsent: absent } : {}),
          }),
        )
      }}
    >
      <Field>
        <FieldLabel htmlFor={`${id}-code`}>בסיס ההחזרה</FieldLabel>
        <select
          id={`${id}-code`}
          className="rounded-lg border border-line bg-surface p-2 text-ink-1"
          value={code}
          onChange={(e) => setCode(e.target.value as keyof typeof BASIS_LABEL)}
        >
          {Object.entries(BASIS_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-note`}>הנימוק בכתב</FieldLabel>
        <Textarea id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} required />
        <FieldDescription>מה נבדק ומה נמצא. בלי פרטי קשר.</FieldDescription>
      </Field>
      {code === "rights_cleared" && (
        <Field>
          <FieldLabel htmlFor={`${id}-evidence`}>הפניה לראיה</FieldLabel>
          <Input id={`${id}-evidence`} value={extra.evidenceRef} onChange={set("evidenceRef")} maxLength={300} />
        </Field>
      )}
      {code === "legal_advice" && (
        <div className="flex gap-2">
          <Field>
            <FieldLabel htmlFor={`${id}-adviser`}>שם היועץ</FieldLabel>
            <Input id={`${id}-adviser`} value={extra.adviserName} onChange={set("adviserName")} maxLength={120} />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-date`}>תאריך הייעוץ</FieldLabel>
            <Input id={`${id}-date`} type="date" value={extra.adviceDate} onChange={set("adviceDate")} />
          </Field>
        </div>
      )}
      {(code === "requester_withdrew" || code === "family_requested_restore") && (
        <Field>
          <FieldLabel htmlFor={`${id}-verify`}>איך נבדקה הבקשה</FieldLabel>
          <Textarea id={`${id}-verify`} value={extra.verificationNote} onChange={set("verificationNote")} maxLength={500} />
          <FieldDescription>בדיקה מידתית, למשל מאותה כתובת מייל. לעולם לא מסמכי זיהוי.</FieldDescription>
        </Field>
      )}
      {code === "content_corrected" && (
        <label className="flex items-center gap-2 text-label text-ink-1">
          <input type="checkbox" checked={absent} onChange={(e) => setAbsent(e.target.checked)} />
          בדקתי שהחומר שבמחלוקת איננו בגרסה החדשה
        </label>
      )}
      {/* Required by the server whenever the hide came from a family's request; a verified request of theirs can be it. */}
      <div className="flex flex-col gap-2">
        <Field>
          <FieldLabel htmlFor={`${id}-contact`}>הפנייה למשפחה או לגוף שהקים את האנדרטה</FieldLabel>
          <Textarea id={`${id}-contact`} value={extra.contactNote} onChange={set("contactNote")} maxLength={500} />
          <FieldDescription>חובה כשההסתרה נבעה מבקשה של המשפחה.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-contact-date`}>תאריך הפנייה</FieldLabel>
          <Input id={`${id}-contact-date`} type="date" value={extra.contactDate} onChange={set("contactDate")} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-label text-ink-1">
        <input type="checkbox" checked={affirmative} onChange={(e) => setAffirmative(e.target.checked)} />
        יש בסיס חיובי ומתועד להחזרה
      </label>
      <label className="flex items-center gap-2 text-label text-ink-1">
        <input type="checkbox" checked={notSilence} onChange={(e) => setNotSilence(e.target.checked)} />
        הבסיס אינו היעדר תגובה, ואינו מחלוקת בין בני משפחה
      </label>
      <Button type="submit" className="pressable self-start" disabled={!note.trim()}>
        החזרת {ELEMENT_LABEL[sup.field]}
      </Button>
    </form>
  )
}

/** A manual hide: never limited by the automatic path's safeguards, but always with a reason. */
function HideForm({ place, reportId, done }: { place: PlaceView; reportId?: string; done: (error: string) => void }) {
  const [fields, setFields] = useState<Element[]>([])
  const [reason, setReason] = useState("")
  const id = `hide-${place.id}-${reportId ?? "manual"}`
  return (
    <form
      className="mt-2 flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault()
        done(
          await send("/api/admin/suppressions", {
            placeId: place.id,
            fields,
            expectedRev: place.rev,
            reason: reason.trim(),
            ...(reportId ? { reportId } : {}),
          }),
        )
      }}
    >
      <fieldset className="flex flex-wrap gap-3">
        <legend className="text-caption text-ink-2">מה להסתיר</legend>
        {ELEMENTS.map((el) => (
          <label key={el} className="flex items-center gap-1 text-label text-ink-1">
            <input
              type="checkbox"
              checked={fields.includes(el)}
              onChange={(e) => setFields(e.target.checked ? [...fields, el] : fields.filter((f) => f !== el))}
            />
            {ELEMENT_LABEL[el]}
          </label>
        ))}
      </fieldset>
      <Field>
        <FieldLabel htmlFor={`${id}-reason`}>סיבת ההסתרה</FieldLabel>
        <Input id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </Field>
      <Button type="submit" variant="outline" className="pressable self-start" disabled={!fields.length || !reason.trim()}>
        הסתרה עכשיו
      </Button>
    </form>
  )
}

/** The place a request names, as a moderator decides on it; curated places have no row to show until phase 7. */
async function fetchPlace(report: Report): Promise<PlaceView | null> {
  if (report.origin !== "contribution") return null
  const res = await fetch(`/api/admin/places/${report.place_id}`).catch(() => null)
  return res?.ok ? ((await res.json()) as PlaceView) : null
}

/** One page of a list, or the Hebrew reason it couldn't be read. */
async function fetchPage<T>(path: string, key: "items" | "ops", cursor: string | null): Promise<Page<T> | string> {
  try {
    const res = await fetch(cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path)
    if (!res.ok) return res.status === 401 ? "צריך להתחבר." : res.status === 403 ? "אין הרשאה." : "השרת לא ענה."
    const body = (await res.json()) as Record<string, unknown> & { next: string | null }
    return { items: body[key] as T[], next: body.next }
  } catch {
    return "אין חיבור לשרת."
  }
}

/** A paged list as React state; its refresh and more are stable, so they can be effect dependencies. */
function usePaged<T>(path: string, key: "items" | "ops") {
  const [state, setState] = useState<PagerState<T>>({ items: null, next: null, error: "", failed: null, busy: false })
  const [pager] = useState(() => createPager<T>((cursor) => fetchPage<T>(path, key, cursor), setState))
  return { ...state, ...pager }
}

/** One request: what was asked, what is hidden now, and what a moderator can do about it. */
function ReportCard({ report, reload, fail }: { report: Report; reload: () => Promise<void>; fail: (error: string) => void }) {
  const [place, setPlace] = useState<PlaceView | null>(null)
  const [contact, setContact] = useState<string | null>(null)
  const [lifting, setLifting] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const loadPlace = useCallback(async () => {
    const view = await fetchPlace(report)
    if (view) setPlace(view)
  }, [report])
  useEffect(() => {
    let live = true
    void fetchPlace(report).then((view) => live && view && setPlace(view))
    return () => {
      live = false
    }
  }, [report])
  const after = async (error: string) => {
    fail(error)
    if (!error) {
      setLifting(null)
      setNote("")
    }
    await Promise.all([loadPlace(), reload()])
  }
  const elements = (JSON.parse(report.elements) as Element[]).map((e) => ELEMENT_LABEL[e]).join(", ")
  return (
    <article aria-label={`בקשה על ${report.place_name ?? report.place_id}`} className="rounded-2xl border border-line p-4">
      <p className="text-caption text-ink-2">
        {[
          when(report.received_at),
          report.outcome === "hidden_for_review" ? "הוסתר באופן זהיר" : "לא הוסתר אוטומטית",
          report.origin === "curated" && "מקום של האתר עצמו",
          report.status === "in_review" && "בטיפול",
          report.status === "closed" && "סגור",
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <h3 className="text-headline text-ink-1">{report.place_name ?? report.place_id}</h3>
      <p className="text-caption text-ink-2">
        {[`מבקשים להסיר: ${elements}`, REQUESTER_LABEL[report.requester_type], report.relationship].filter(Boolean).join(" · ")}
      </p>
      {report.explanation && <p className="mt-2 whitespace-pre-line text-ink-1">{report.explanation}</p>}
      {report.handling_note && <p className="mt-1 text-body text-ink-2">טיפול: {report.handling_note}</p>}
      {!!report.has_contact &&
        (contact ? (
          <p className="mt-1 text-caption text-ink-1" dir="ltr">
            {contact}
          </p>
        ) : (
          <Button
            variant="ghost"
            className="pressable mt-1"
            onClick={async () => {
              const res = await fetch(`/api/admin/reports/${report.id}/contact`).catch(() => null)
              if (res?.ok) setContact(((await res.json()) as { email: string }).email)
            }}
          >
            הצגת כתובת המבקש
          </Button>
        ))}
      {place && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-caption text-ink-2">{place.status === "hidden" ? "המקום מוסתר כולו" : "מוסתר כרגע"}</p>
          {place.suppressions.length === 0 && <p className="text-caption text-ink-2">שום דבר לא מוסתר.</p>}
          {place.suppressions.map((s) => (
            <div key={s.id} className="mt-1">
              <p className="text-label text-ink-1">
                {ELEMENT_LABEL[s.field]} · {s.kind === "precautionary" ? "הסתרה זהירה" : "הסתרה ידנית"} · {when(s.created_at)}
              </p>
              {lifting === s.id ? (
                <LiftForm place={place} sup={s} done={after} />
              ) : (
                <Button variant="ghost" className="pressable" onClick={() => setLifting(s.id)}>
                  החזרה עם בסיס מתועד
                </Button>
              )}
            </div>
          ))}
          <HideForm place={place} reportId={report.id} done={after} />
        </div>
      )}
      <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
        {report.status !== "closed" ? (
          <>
            <Field>
              <FieldLabel htmlFor={`handle-${report.id}`}>מה נעשה</FieldLabel>
              <Textarea id={`handle-${report.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              <FieldDescription>התזכורות נעצרות רק כשמתועד טיפול. צפייה בבקשה לא מספיקה.</FieldDescription>
            </Field>
            <div className="flex gap-2">
              {report.status === "open" && (
                <Button
                  className="pressable"
                  disabled={!note.trim()}
                  onClick={async () => after(await send(`/api/admin/reports/${report.id}/handle`, { note: note.trim() }))}
                >
                  תיעוד טיפול
                </Button>
              )}
              <Button
                variant="outline"
                className="pressable"
                disabled={!note.trim()}
                onClick={async () => after(await send(`/api/admin/reports/${report.id}/close`, { note: note.trim() }))}
              >
                סגירת הבקשה
              </Button>
            </div>
          </>
        ) : (
          <Button
            variant="ghost"
            className="pressable self-start"
            onClick={async () => after(await send(`/api/admin/reports/${report.id}/reopen`, {}))}
          >
            פתיחה מחדש
          </Button>
        )}
      </div>
    </article>
  )
}

/** Requests to remove or correct, newest first, and the operations that need a person's eye. */
export function Reports() {
  const reports = usePaged<Report>("/api/admin/reports", "items")
  const attention = usePaged<Attention>("/api/admin/attention", "ops")
  // A decision's own failure, from a card; each list keeps its own.
  const [error, setError] = useState("")
  const { refresh: refreshReports } = reports
  const { refresh: refreshAttention } = attention
  const load = useCallback(async () => {
    await Promise.all([refreshReports(), refreshAttention()])
  }, [refreshReports, refreshAttention])
  useEffect(() => {
    void load()
  }, [load])
  return (
    <section id="reports" aria-labelledby="reports-title">
      <h2 id="reports-title" className="text-title-2 text-ink-1">
        בקשות להסרה או לתיקון
      </h2>
      {error && (
        <p role="alert" className="mt-3 text-label text-destructive">
          {error}
        </p>
      )}
      {attention.error && (
        // Whatever was already shown stays: a moment without the server is not an empty list.
        <p role="alert" className="mt-3 text-label text-destructive">
          הפעולות שדורשות תשומת לב לא נטענו. {attention.error}
        </p>
      )}
      {attention.failed === "refresh" && (
        <Button variant="ghost" className="pressable mt-1" disabled={attention.busy} onClick={() => void attention.refresh()}>
          לנסות שוב לטעון את הפעולות
        </Button>
      )}
      {!!attention.items?.length && (
        <ul aria-label="דורש תשומת לב" className="mt-3 flex flex-col gap-1">
          {attention.items.map((a) => (
            <li key={a.id} className="text-caption text-ink-1">
              {PROBLEM[a.problem]} · {a.place_id}
            </li>
          ))}
        </ul>
      )}
      {attention.next && (
        <Button variant="ghost" className="pressable mt-1" disabled={attention.busy} onClick={() => void attention.more()}>
          פעולות נוספות שדורשות תשומת לב
        </Button>
      )}
      {reports.error && (
        <p role="alert" className="mt-3 text-label text-destructive">
          הבקשות לא נטענו. {reports.error}
        </p>
      )}
      {reports.failed === "refresh" && (
        <Button variant="ghost" className="pressable mt-1" disabled={reports.busy} onClick={() => void reports.refresh()}>
          לנסות שוב לטעון את הבקשות
        </Button>
      )}
      {reports.items?.length === 0 && <p className="mt-4 text-ink-2">אין בקשות פתוחות.</p>}
      <div className="mt-4 grid gap-4">
        {reports.items?.map((r) => (
          <ReportCard key={r.id} report={r} reload={load} fail={setError} />
        ))}
      </div>
      {reports.next && (
        <Button variant="outline" className="pressable mt-4" disabled={reports.busy} onClick={() => void reports.more()}>
          בקשות ישנות יותר
        </Button>
      )}
    </section>
  )
}
