import { useCallback, useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { CircleCheck, EyeOff, FileWarning, Mail, RotateCcw, Search, ShieldAlert, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { BASIS_LABEL, ELEMENT_LABEL, REQUESTER_LABEL } from "@/data/reports"
import { ELEMENTS, type Element } from "@/shared/contract"
import { ease } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { createPager, type Page, type PagerState } from "./pager"
import { Alert, Empty, Loading, Section, block, card, check, meta, select } from "./ui"

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
      className="mt-3 flex flex-col gap-4 rounded-2xl border border-line p-4 sm:p-5"
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
        <select id={`${id}-code`} className={select} value={code} onChange={(e) => setCode(e.target.value as keyof typeof BASIS_LABEL)}>
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
        <div className="grid gap-4 sm:grid-cols-2">
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
        <label className="flex items-start gap-3 text-label text-ink-1">
          <input type="checkbox" className={cn(check, "mt-0.5")} checked={absent} onChange={(e) => setAbsent(e.target.checked)} />
          בדקתי שהחומר שבמחלוקת איננו בגרסה החדשה
        </label>
      )}
      {/* Required by the server whenever the hide came from a family's request; a verified request of theirs can be it. */}
      <div className="grid gap-4">
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
      <div className="flex flex-col gap-3 border-t border-line pt-4">
        <label className="flex items-start gap-3 text-label text-ink-1">
          <input type="checkbox" className={cn(check, "mt-0.5")} checked={affirmative} onChange={(e) => setAffirmative(e.target.checked)} />
          יש בסיס חיובי ומתועד להחזרה
        </label>
        <label className="flex items-start gap-3 text-label text-ink-1">
          <input type="checkbox" className={cn(check, "mt-0.5")} checked={notSilence} onChange={(e) => setNotSilence(e.target.checked)} />
          הבסיס אינו היעדר תגובה, ואינו מחלוקת בין בני משפחה
        </label>
      </div>
      <Button type="submit" className="pressable self-start" disabled={!note.trim()}>
        <RotateCcw aria-hidden />
        החזרת {ELEMENT_LABEL[sup.field]}
      </Button>
    </form>
  )
}

/** A manual hide: never limited by the automatic path's safeguards, but always with a reason. */
/**
 * A deletion someone asked for: final, so it takes a confirmation. The server records it as a removal, so no restore
 * brings it back.
 */
function EraseForm({ place, done }: { place: PlaceView; done: (error: string) => void }) {
  const [open, setOpen] = useState(false)
  const [sure, setSure] = useState(false)
  if (place.status === "erased" || place.status === "withdrawn") return null
  if (!open)
    return (
      <Button variant="ghost" className="pressable mt-3 self-start text-destructive dark:text-brand" onClick={() => setOpen(true)}>
        <Trash2 aria-hidden />
        מחיקת המקום לפי בקשה
      </Button>
    )
  return (
    <form
      className="mt-3 flex flex-col gap-4 rounded-2xl border border-destructive/40 p-4 sm:p-5"
      onSubmit={async (e) => {
        e.preventDefault()
        done(await send(`/api/admin/places/${place.id}/erase`, { expectedRev: place.rev, confirm: true }))
      }}
    >
      <p className="flex items-start gap-2.5 text-body text-ink-1">
        <ShieldAlert aria-hidden className="mt-1 size-4 shrink-0 text-destructive dark:text-brand" />
        המחיקה סופית: התוכן, התמונות, המקורות ופרטי השולח נמחקים מיד, וגם שחזור מגיבוי לא יחזיר אותם. נשאר רק רישום שהמקום נמחק.
      </p>
      <label className="flex items-start gap-3 text-label text-ink-1">
        <input
          type="checkbox"
          className={cn(check, "mt-0.5 accent-destructive")}
          checked={sure}
          onChange={(e) => setSure(e.target.checked)}
        />
        ביקשו למחוק את המקום, ואני מבין או מבינה שאי אפשר לבטל את המחיקה
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="destructive" className="pressable" disabled={!sure}>
          מחיקה סופית
        </Button>
        <Button type="button" variant="ghost" className="pressable" onClick={() => setOpen(false)}>
          ביטול
        </Button>
      </div>
    </form>
  )
}

function HideForm({ place, reportId, done }: { place: PlaceView; reportId?: string; done: (error: string) => void }) {
  const [fields, setFields] = useState<Element[]>([])
  const [reason, setReason] = useState("")
  const id = `hide-${place.id}-${reportId ?? "manual"}`
  return (
    <form
      className="mt-4 flex flex-col gap-4"
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
      <fieldset className="flex flex-wrap gap-x-5 gap-y-3">
        <legend className="mb-3 text-label text-ink-1">מה להסתיר</legend>
        {ELEMENTS.map((el) => (
          <label key={el} className="flex items-center gap-2 text-label text-ink-1">
            <input
              type="checkbox"
              className={check}
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
        <EyeOff aria-hidden />
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
  const hidden = report.outcome === "hidden_for_review"
  return (
    <>
      {/* The dot is the datum: crimson when something was taken down as a precaution and waits on a decision. */}
      <p className="flex items-center gap-2 text-caption text-ink-3">
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full",
            report.status === "closed" ? "border border-line-strong" : hidden ? "bg-brand" : "bg-ink-3",
          )}
        />
        {meta([
          when(report.received_at),
          hidden ? "הוסתר באופן זהיר" : "לא הוסתר אוטומטית",
          report.origin === "curated" && "מקום של האתר עצמו",
          report.status === "in_review" && "בטיפול",
          report.status === "closed" && "סגור",
        ])}
      </p>
      <h3 className="mt-1 text-title-3 text-ink-1">{report.place_name ?? report.place_id}</h3>
      <p className="mt-1 text-caption text-ink-2">
        {meta([`מבקשים להסיר: ${elements}`, REQUESTER_LABEL[report.requester_type], report.relationship])}
      </p>
      {report.explanation && (
        <p className="reading-copy mt-4 border-s-2 border-line-strong ps-4 text-body whitespace-pre-line text-ink-1">
          {report.explanation}
        </p>
      )}
      {report.handling_note && <p className="mt-3 text-body text-ink-2">טיפול: {report.handling_note}</p>}
      {!!report.has_contact &&
        (contact ? (
          <p className="mt-3 flex items-center gap-2 text-caption text-ink-1">
            <Mail aria-hidden className="size-3.5 shrink-0 text-ink-2" />
            <span dir="ltr">{contact}</span>
          </p>
        ) : (
          <Button
            variant="ghost"
            className="pressable -ms-3 mt-2"
            onClick={async () => {
              const res = await fetch(`/api/admin/reports/${report.id}/contact`).catch(() => null)
              if (res?.ok) setContact(((await res.json()) as { email: string }).email)
            }}
          >
            <Mail aria-hidden />
            הצגת כתובת המבקש
          </Button>
        ))}
      {place && (
        <div className={block}>
          <p className="text-headline text-ink-1">{place.status === "hidden" ? "המקום מוסתר כולו" : "מוסתר כרגע"}</p>
          {place.suppressions.length === 0 && (
            <p className="mt-2 flex items-center gap-2 text-body text-ink-2">
              <CircleCheck aria-hidden className="size-4 shrink-0 text-hope" />
              שום דבר לא מוסתר.
            </p>
          )}
          {!!place.suppressions.length && (
            <ul className="mt-2 divide-y divide-line">
              {place.suppressions.map((s) => (
                <li key={s.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-label text-ink-1">
                      <EyeOff aria-hidden className="size-4 shrink-0 text-ink-2" />
                      {ELEMENT_LABEL[s.field]} · {s.kind === "precautionary" ? "הסתרה זהירה" : "הסתרה ידנית"} · {when(s.created_at)}
                    </p>
                    {lifting !== s.id && (
                      <Button variant="ghost" className="pressable" onClick={() => setLifting(s.id)}>
                        <RotateCcw aria-hidden />
                        החזרה עם בסיס מתועד
                      </Button>
                    )}
                  </div>
                  {lifting === s.id && <LiftForm place={place} sup={s} done={after} />}
                </li>
              ))}
            </ul>
          )}
          <HideForm place={place} reportId={report.id} done={after} />
          <EraseForm place={place} done={after} />
        </div>
      )}
      <div className={cn(block, "flex flex-col gap-4")}>
        {report.status !== "closed" ? (
          <>
            <Field>
              <FieldLabel htmlFor={`handle-${report.id}`}>מה נעשה</FieldLabel>
              <Textarea id={`handle-${report.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              <FieldDescription>התזכורות נעצרות רק כשמתועד טיפול. צפייה בבקשה לא מספיקה.</FieldDescription>
            </Field>
            <div className="flex flex-wrap gap-2">
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
            <RotateCcw aria-hidden />
            פתיחה מחדש
          </Button>
        )}
        {(report.has_contact || report.explanation || report.relationship) && (
          <Button
            variant="ghost"
            className="pressable -ms-3 self-start text-destructive dark:text-brand"
            onClick={async () => {
              // The requester asked to be forgotten: their address and words go now, not at the request's date.
              if (!confirm("למחוק עכשיו את פרטי המבקש ואת נוסח הבקשה? אי אפשר לבטל, והבקשה תיסגר.")) return
              await after(await send(`/api/admin/reports/${report.id}/purge`, {}))
            }}
          >
            <Trash2 aria-hidden />
            מחיקת פרטי המבקש והנוסח עכשיו
          </Button>
        )}
      </div>
    </>
  )
}

/**
 * A place reached by its link or id, for a request that came by mail or phone rather than through the form: hide what
 * was asked, or delete the place on request.
 */
function PlaceLookup() {
  const [input, setInput] = useState("")
  const [place, setPlace] = useState<PlaceView | null>(null)
  const [message, setMessage] = useState("")
  const idOf = (s: string) => /(?:\/place\/|#\/place\/)?([A-Za-z0-9_-]{1,80})\/?$/.exec(s.trim())?.[1] ?? ""
  const load = async (id = place?.id ?? idOf(input)) => {
    if (!id) return
    const res = await fetch(`/api/admin/places/${encodeURIComponent(id)}`).catch(() => null)
    if (!res?.ok) {
      setPlace(null)
      setMessage(res?.status === 404 ? "לא נמצא מקום כזה." : "לא הצלחנו לטעון את המקום.")
      return
    }
    setMessage("")
    setPlace((await res.json()) as PlaceView)
  }
  return (
    <div className={card}>
      <form
        className="flex flex-wrap items-start gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void load(idOf(input))
        }}
      >
        <Field className="min-w-60 flex-1">
          <FieldLabel htmlFor="place-lookup">מקום לפי קישור או מזהה</FieldLabel>
          <Input id="place-lookup" dir="ltr" value={input} onChange={(e) => setInput(e.target.value)} />
          <FieldDescription>לבקשה שהגיעה במייל או בטלפון: הדביקו את קישור השיתוף של המקום.</FieldDescription>
        </Field>
        {/* Level with the input, past the label above it. */}
        <Button type="submit" variant="outline" className="pressable sm:mt-8" disabled={!idOf(input)}>
          <Search aria-hidden />
          פתיחה
        </Button>
      </form>
      {message && (
        <p role="status" className="mt-4 text-body text-ink-2">
          {message}
        </p>
      )}
      {place && (
        <div className={block}>
          <p className="text-caption text-ink-2">
            <span dir="ltr">{place.id}</span> · {place.status}
          </p>
          <HideForm
            place={place}
            done={async (error) => {
              await load(place.id)
              setMessage(error)
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
    </div>
  )
}

/** How many requests and operations wait, as read so far, for the page's header. */
export interface ReportCounts {
  reports: number | null
  moreReports: boolean
  attention: number | null
  moreAttention: boolean
}

/** Requests to remove or correct, newest first, and the operations that need a person's eye. */
export function Reports({ onCounts }: { onCounts?: (counts: ReportCounts) => void }) {
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
  const open = reports.items ? reports.items.filter((r) => r.status !== "closed").length : null
  useEffect(
    () =>
      onCounts?.({
        reports: open,
        moreReports: !!reports.next,
        attention: attention.items ? attention.items.length : null,
        moreAttention: !!attention.next,
      }),
    [open, reports.next, attention.items, attention.next, onCounts],
  )
  const loading = reports.items === null && !reports.error
  return (
    <Section
      id="reports"
      title="בקשות להסרה או לתיקון"
      lead="החדשות ראשונות. לכל בקשה: מה ביקשו, מה מוסתר עכשיו, ומה אפשר לעשות."
      count={open === null ? null : `${open}${reports.next ? "+" : ""}`}
      busy={loading}
    >
      <PlaceLookup />
      {error && <Alert className="mt-5">{error}</Alert>}
      {attention.error && (
        // Whatever was already shown stays: a moment without the server is not an empty list.
        <Alert className="mt-5">הפעולות שדורשות תשומת לב לא נטענו. {attention.error}</Alert>
      )}
      {attention.failed === "refresh" && (
        <Button variant="ghost" className="pressable mt-2" disabled={attention.busy} onClick={() => void attention.refresh()}>
          <RotateCcw aria-hidden />
          לנסות שוב לטעון את הפעולות
        </Button>
      )}
      {!!attention.items?.length && (
        <div className={cn(card, "mt-5")}>
          <p className="flex items-center gap-2 text-headline text-ink-1">
            <FileWarning aria-hidden className="size-5 shrink-0 text-dawn" />
            פעולות שנעצרו באמצע
          </p>
          <ul aria-label="דורש תשומת לב" className="mt-3 divide-y divide-line">
            {attention.items.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-body text-ink-1">
                <span>{PROBLEM[a.problem]}</span>
                <span className="text-caption text-ink-3" dir="ltr">
                  {a.place_id}
                </span>
              </li>
            ))}
          </ul>
          {attention.next && (
            <Button variant="ghost" className="pressable -ms-3 mt-2" disabled={attention.busy} onClick={() => void attention.more()}>
              פעולות נוספות שדורשות תשומת לב
            </Button>
          )}
        </div>
      )}
      {reports.error && <Alert className="mt-5">הבקשות לא נטענו. {reports.error}</Alert>}
      {reports.failed === "refresh" && (
        <Button variant="ghost" className="pressable mt-2" disabled={reports.busy} onClick={() => void reports.refresh()}>
          <RotateCcw aria-hidden />
          לנסות שוב לטעון את הבקשות
        </Button>
      )}
      <div className="mt-5">
        {loading && <Loading rows={1} />}
        {reports.items?.length === 0 && (
          <Empty icon={<CircleCheck className="size-5" />} title="אין בקשות פתוחות.">
            אף אחד לא ביקש להסיר או לתקן דבר.
          </Empty>
        )}
        <div className="grid gap-4">
          <AnimatePresence initial={false}>
            {reports.items?.map((r, i) => (
              <motion.article
                key={r.id}
                aria-label={`בקשה על ${r.place_name ?? r.place_id}`}
                className={card}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0, transition: { duration: 0.38, ease, delay: Math.min(i, 8) * 0.04 } }}
                exit={{ opacity: 0, transition: { duration: 0.2, ease } }}
              >
                <ReportCard report={r} reload={load} fail={setError} />
              </motion.article>
            ))}
          </AnimatePresence>
        </div>
      </div>
      {reports.next && (
        <Button variant="outline" className="pressable mt-5" disabled={reports.busy} onClick={() => void reports.more()}>
          בקשות ישנות יותר
        </Button>
      )}
    </Section>
  )
}
