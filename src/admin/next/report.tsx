import { useCallback, useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { BASIS_LABEL, ELEMENT_LABEL, REQUESTER_LABEL } from "@/data/reports"
import { ELEMENTS, type Element } from "@/shared/contract"
import { ease } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { fetchContact, fetchPlace, send, type Basis, type PlaceView, type Report, type Suppression } from "./api"
import { Btn, checkClass, fieldHint, fieldLabel, inputClass } from "./controls"
import { ago, elementsOf, reportName } from "./inbox-state"
import { Alert, Chip, Glyph, meta } from "./parts"

/** Lifting one hide, with the basis its code needs. The code checks it was recorded; the judgment stays the moderator's. */
function LiftForm({
  place,
  sup,
  done,
  cancel,
}: {
  place: PlaceView
  sup: Suppression
  done: (error: string) => Promise<void>
  cancel: () => void
}) {
  const [code, setCode] = useState<Basis>("review_supports_restore")
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
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof extra) => (e: { target: { value: string } }) => setExtra({ ...extra, [k]: e.target.value })
  const id = `lift-${sup.id}`
  const text = (k: keyof typeof extra, label: string, hint?: string, long?: boolean, type?: string) => (
    <label className="block">
      <span className={fieldLabel}>{label}</span>
      {long ? (
        <textarea value={extra[k]} onChange={set(k)} maxLength={500} rows={2} className={cn(inputClass, "resize-none py-2.5")} />
      ) : (
        <input type={type ?? "text"} value={extra[k]} onChange={set(k)} maxLength={300} className={cn(inputClass, "h-11")} />
      )}
      {hint && <span className={fieldHint}>{hint}</span>}
    </label>
  )
  return (
    <motion.form
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.22, ease } }}
      className="mt-3 flex flex-col gap-4 rounded-2xl border border-(--a-line-2) bg-(--a-panel-2) p-4 sm:p-5"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        await done(
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
        setBusy(false)
      }}
    >
      <label className="block">
        <span className={fieldLabel}>בסיס ההחזרה</span>
        <select id={`${id}-code`} className={cn(inputClass, "h-11")} value={code} onChange={(e) => setCode(e.target.value as Basis)}>
          {Object.entries(BASIS_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={fieldLabel}>הנימוק בכתב</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          required
          rows={3}
          className={cn(inputClass, "resize-none py-2.5")}
        />
        <span className={fieldHint}>מה נבדק ומה נמצא. בלי פרטי קשר.</span>
      </label>
      {code === "rights_cleared" && text("evidenceRef", "הפניה לראיה")}
      {code === "legal_advice" && (
        <div className="grid gap-4 sm:grid-cols-2">
          {text("adviserName", "שם היועץ")}
          {text("adviceDate", "תאריך הייעוץ", undefined, false, "date")}
        </div>
      )}
      {(code === "requester_withdrew" || code === "family_requested_restore") &&
        text("verificationNote", "איך נבדקה הבקשה", "בדיקה מידתית, למשל מאותה כתובת מייל. לעולם לא מסמכי זיהוי.", true)}
      {code === "content_corrected" && (
        <label className="flex items-start gap-3 text-[0.9375rem] text-(--a-ink-1)">
          <input type="checkbox" className={checkClass} checked={absent} onChange={(e) => setAbsent(e.target.checked)} />
          בדקתי שהחומר שבמחלוקת איננו בגרסה החדשה
        </label>
      )}
      {/* Required by the server whenever the hide came from a family's request; a verified request of theirs can be it. */}
      {text("contactNote", "הפנייה למשפחה או לגוף שהקים את האנדרטה", "חובה כשההסתרה נבעה מבקשה של המשפחה.", true)}
      {text("contactDate", "תאריך הפנייה", undefined, false, "date")}
      <div className="flex flex-col gap-3 border-t border-(--a-line) pt-4">
        <label className="flex items-start gap-3 text-[0.9375rem] text-(--a-ink-1)">
          <input type="checkbox" className={checkClass} checked={affirmative} onChange={(e) => setAffirmative(e.target.checked)} />
          יש בסיס חיובי ומתועד להחזרה
        </label>
        <label className="flex items-start gap-3 text-[0.9375rem] text-(--a-ink-1)">
          <input type="checkbox" className={checkClass} checked={notSilence} onChange={(e) => setNotSilence(e.target.checked)} />
          הבסיס אינו היעדר תגובה, ואינו מחלוקת בין בני משפחה
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Btn type="submit" variant="primary" disabled={!note.trim() || busy}>
          <Glyph name="restore" />
          החזרת {ELEMENT_LABEL[sup.field]}
        </Btn>
        <Btn variant="ghost" onClick={cancel}>
          ביטול
        </Btn>
      </div>
    </motion.form>
  )
}

/** A deletion someone asked for: final, so it takes a confirmation. The server records it as a removal. */
export function EraseForm({ place, done }: { place: PlaceView; done: (error: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [sure, setSure] = useState(false)
  if (place.status === "erased" || place.status === "withdrawn") return null
  if (!open)
    return (
      <Btn variant="danger-ghost" className="-ms-3 self-start" onClick={() => setOpen(true)}>
        <Glyph name="trash" />
        מחיקת המקום לפי בקשה
      </Btn>
    )
  return (
    <form
      className="flex flex-col gap-4 rounded-2xl border border-(--a-red)/40 bg-(--a-red-soft) p-4 sm:p-5"
      onSubmit={async (e) => {
        e.preventDefault()
        await done(await send(`/api/admin/places/${place.id}/erase`, { expectedRev: place.rev, confirm: true }))
      }}
    >
      <p className="text-[0.9375rem] leading-relaxed text-(--a-ink-1)">
        המחיקה סופית: התוכן, התמונות, המקורות ופרטי השולח נמחקים מיד, וגם שחזור מגיבוי לא יחזיר אותם. נשאר רק רישום שהמקום נמחק.
      </p>
      <label className="flex items-start gap-3 text-[0.9375rem] font-medium text-(--a-ink-1)">
        <input type="checkbox" className={cn(checkClass, "accent-(--a-red)")} checked={sure} onChange={(e) => setSure(e.target.checked)} />
        ביקשו למחוק את המקום, ואני מבין או מבינה שאי אפשר לבטל את המחיקה
      </label>
      <div className="flex flex-wrap gap-2">
        <Btn type="submit" variant="danger" disabled={!sure}>
          מחיקה סופית
        </Btn>
        <Btn variant="ghost" onClick={() => setOpen(false)}>
          ביטול
        </Btn>
      </div>
    </form>
  )
}

/** A manual hide: never limited by the automatic path's safeguards, but always with a reason. */
export function HideForm({ place, reportId, done }: { place: PlaceView; reportId?: string; done: (error: string) => Promise<void> }) {
  const [fields, setFields] = useState<Element[]>([])
  const [reason, setReason] = useState("")
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault()
        await done(
          await send("/api/admin/suppressions", {
            placeId: place.id,
            fields,
            expectedRev: place.rev,
            reason: reason.trim(),
            ...(reportId ? { reportId } : {}),
          }),
        )
        setFields([])
        setReason("")
      }}
    >
      <fieldset>
        <legend className={fieldLabel}>מה להסתיר</legend>
        <div className="flex flex-wrap gap-2">
          {ELEMENTS.map((el) => (
            <label
              key={el}
              className={cn(
                "flex h-10 cursor-pointer items-center gap-2 rounded-xl border px-3 text-[0.875rem] font-medium transition-colors has-focus-visible:outline-2 has-focus-visible:outline-(--a-focus)",
                fields.includes(el)
                  ? "border-(--a-ink-1) bg-(--a-ink-1) text-(--a-panel)"
                  : "border-(--a-line-2) text-(--a-ink-1) hover:bg-(--a-panel-2)",
              )}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={fields.includes(el)}
                onChange={(e) => setFields(e.target.checked ? [...fields, el] : fields.filter((f) => f !== el))}
              />
              {ELEMENT_LABEL[el]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className={fieldLabel}>סיבת ההסתרה</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className={cn(inputClass, "h-11")} />
      </label>
      <Btn type="submit" variant="outline" className="self-start" disabled={!fields.length || !reason.trim()}>
        <Glyph name="hide" />
        הסתרה עכשיו
      </Btn>
    </form>
  )
}

/** Forgetting the requester now: their address and words go, the request closes. Asked twice, as it can't be undone. */
function PurgeRequester({ report, done }: { report: Report; done: (error: string) => Promise<void> }) {
  const [asking, setAsking] = useState(false)
  if (!asking)
    return (
      <Btn variant="danger-ghost" className="-ms-3 self-start" onClick={() => setAsking(true)}>
        <Glyph name="trash" />
        מחיקת פרטי המבקש והנוסח עכשיו
      </Btn>
    )
  return (
    <div
      role="alertdialog"
      aria-label="מחיקת פרטי המבקש"
      className="flex flex-col gap-3 rounded-2xl border border-(--a-red)/40 bg-(--a-red-soft) p-4"
    >
      <p className="text-[0.9375rem] text-(--a-ink-1)">למחוק עכשיו את פרטי המבקש ואת נוסח הבקשה? אי אפשר לבטל, והבקשה תיסגר.</p>
      <div className="flex flex-wrap gap-2">
        <Btn variant="danger" onClick={async () => done(await send(`/api/admin/reports/${report.id}/purge`, {}))}>
          כן, למחוק את הפרטים
        </Btn>
        <Btn variant="ghost" onClick={() => setAsking(false)}>
          ביטול
        </Btn>
      </div>
    </div>
  )
}

/** The place a request names, kept fresh after every action on it; curated places have no row to show. */
export function useReportPlace(report: Report) {
  const [place, setPlace] = useState<PlaceView | null>(null)
  const load = useCallback(async () => {
    if (report.origin !== "contribution") return setPlace(null)
    const view = await fetchPlace(report.place_id)
    setPlace(typeof view === "string" ? null : view)
  }, [report])
  useEffect(() => {
    let live = true
    if (report.origin !== "contribution") return setPlace(null)
    void fetchPlace(report.place_id).then((view) => live && setPlace(typeof view === "string" ? null : view))
    return () => {
      live = false
    }
  }, [report])
  return { place, load }
}

export type ReportTools = ReturnType<typeof useReportTools>
/** One request's actions and their outcome: every write reloads the place and the lists, and says what happened. */
export function useReportTools(report: Report, reload: () => Promise<void>, say: (text: string, tone?: "done" | "error") => void) {
  const { place, load } = useReportPlace(report)
  const [error, setError] = useState("")
  const after = useCallback(
    async (what: string, failure: string) => {
      setError(failure)
      if (!failure) say(what)
      await Promise.all([load(), reload()])
    },
    [load, reload, say],
  )
  useEffect(() => setError(""), [report.id])
  return { place, error, after }
}

/** One request: what was asked, in their words, what is hidden now, and the rarer actions behind one disclosure. */
export function ReportBody({ report, tools, aside }: { report: Report; tools: ReportTools; aside?: "inline" | "none" }) {
  const { place, after } = tools
  const [contact, setContact] = useState<string | null>(null)
  const [lifting, setLifting] = useState<string | null>(null)
  const hidden = report.outcome === "hidden_for_review"
  const forget = !!(report.has_contact || report.explanation || report.relationship)
  useEffect(() => {
    setContact(null)
    setLifting(null)
  }, [report.id])
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {hidden ? (
          <Chip tone={report.status === "closed" ? "ink" : "red"} glyph="hide">
            הוסתר באופן זהיר
          </Chip>
        ) : (
          <Chip>לא הוסתר אוטומטית</Chip>
        )}
        {report.status === "in_review" && <Chip tone="sun">בטיפול</Chip>}
        {report.status === "closed" && <Chip>סגור</Chip>}
        {report.origin === "curated" && <Chip>מקום של האתר עצמו</Chip>}
      </div>
      <p className="mt-4 text-[0.875rem] text-(--a-ink-3)">
        {meta([`התקבלה ${ago(report.received_at)}`, REQUESTER_LABEL[report.requester_type], report.relationship])}
      </p>
      <h2 className="mt-1 text-[2rem] leading-tight font-bold tracking-[-0.01em] text-(--a-ink-1)">{reportName(report)}</h2>
      <p className="mt-1.5 text-[1rem] text-(--a-ink-2)">מבקשים להסיר: {elementsOf(report).join(", ")}</p>

      {report.explanation && (
        <>
          <h3 className="mt-7 mb-2 text-[0.8125rem] font-bold text-(--a-ink-3)">במילים שלהם</h3>
          <blockquote className="border-s-[3px] border-(--a-red) ps-4 text-[1.0625rem] leading-[1.8] whitespace-pre-line text-(--a-ink-1)">
            {report.explanation}
          </blockquote>
        </>
      )}
      {report.handling_note && (
        <p className="mt-5 rounded-xl bg-(--a-sunk) px-4 py-3 text-[0.9375rem] text-(--a-ink-1)">
          <span className="font-semibold">טיפול: </span>
          {report.handling_note}
        </p>
      )}
      {!!report.has_contact && aside !== "none" && <Contact report={report} contact={contact} setContact={setContact} />}

      {place && (
        <section className="mt-7">
          <h3 className="mb-2 text-[0.8125rem] font-bold text-(--a-ink-3)">
            {place.status === "hidden" ? "המקום מוסתר כולו" : "מוסתר כרגע"}
          </h3>
          {place.suppressions.length === 0 ? (
            <p className="flex items-center gap-2.5 rounded-2xl border border-(--a-line) px-4 py-4 text-[0.9375rem] text-(--a-ink-2)">
              <Glyph name="approve" className="size-4 text-(--a-green)" />
              שום דבר לא מוסתר.
            </p>
          ) : (
            <ul className="divide-y divide-(--a-line) overflow-hidden rounded-2xl border border-(--a-line) bg-(--a-panel)">
              <AnimatePresence initial={false}>
                {place.suppressions.map((s) => (
                  <motion.li
                    key={s.id}
                    layout="position"
                    exit={{ opacity: 0, height: 0, transition: { duration: 0.2 } }}
                    className="px-4 py-3"
                  >
                    <div className="flex min-h-11 flex-wrap items-center gap-3">
                      <Glyph name="hide" className="size-4 text-(--a-red)" />
                      <p className="flex-1 text-[0.9375rem] text-(--a-ink-1)">
                        <span className="font-semibold">{ELEMENT_LABEL[s.field]}</span>
                        <span className="block text-[0.8125rem] text-(--a-ink-3)">
                          {s.kind === "precautionary" ? "הסתרה זהירה" : "הסתרה ידנית"} · מאז {ago(s.created_at)}
                        </span>
                      </p>
                      {lifting !== s.id && (
                        <Btn size="sm" onClick={() => setLifting(s.id)}>
                          <Glyph name="restore" className="size-3.5" />
                          החזרה עם בסיס מתועד
                        </Btn>
                      )}
                    </div>
                    {lifting === s.id && (
                      <LiftForm
                        place={place}
                        sup={s}
                        cancel={() => setLifting(null)}
                        done={async (error) => {
                          if (!error) setLifting(null)
                          await after(`${ELEMENT_LABEL[s.field]} הוחזר לאתר`, error)
                        }}
                      />
                    )}
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </section>
      )}

      {(place || forget) && (
        <details className="group mt-7 rounded-2xl border border-(--a-line) bg-(--a-panel)">
          <summary className="a-focus-ring flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 rounded-2xl px-4 text-[0.9375rem] font-semibold text-(--a-ink-1) [&::-webkit-details-marker]:hidden">
            פעולות נוספות
            <Glyph name="arrow" className="size-3.5 rotate-90 text-(--a-ink-3) transition-transform duration-300 group-open:-rotate-90" />
          </summary>
          <div className="flex flex-col gap-5 border-t border-(--a-line) p-4">
            {place && <HideForm place={place} reportId={report.id} done={(e) => after("ההסתרה נשמרה", e)} />}
            {place && <EraseForm place={place} done={(e) => after("המקום נמחק", e)} />}
            {forget && <PurgeRequester report={report} done={(e) => after("פרטי המבקש נמחקו", e)} />}
          </div>
        </details>
      )}
    </div>
  )
}

/** The requester's address, shown only when asked for (the reading is recorded on the server). */
export function Contact({ report, contact, setContact }: { report: Report; contact: string | null; setContact: (c: string) => void }) {
  return contact ? (
    <p className="mt-4 flex items-center gap-2 text-[0.9375rem] text-(--a-ink-1)">
      <Glyph name="mail" className="size-4 text-(--a-ink-3)" />
      <span dir="ltr">{contact}</span>
    </p>
  ) : (
    <Btn
      variant="ghost"
      className="-ms-3 mt-3"
      onClick={async () => {
        const email = await fetchContact(report.id)
        if (email) setContact(email)
      }}
    >
      <Glyph name="mail" />
      הצגת כתובת המבקש
    </Btn>
  )
}

/** Recording what was done, closing, or opening again: the reminders stop only once handling is written down. */
export function ReportActions({ report, tools, size = "md" }: { report: Report; tools: ReportTools; size?: "md" | "lg" }) {
  const [note, setNote] = useState("")
  useEffect(() => setNote(""), [report.id])
  const act = async (verb: "handle" | "close", what: string) => {
    const error = await send(`/api/admin/reports/${report.id}/${verb}`, { note: note.trim() })
    if (!error) setNote("")
    await tools.after(what, error)
  }
  return (
    <div className="flex w-full flex-col gap-2.5">
      {tools.error && <Alert>{tools.error}</Alert>}
      {report.status !== "closed" ? (
        <div className="flex w-full flex-wrap items-stretch gap-2">
          <label className="min-w-60 flex-1">
            <span className="sr-only">מה נעשה</span>
            <textarea
              value={note}
              placeholder="מה נעשה? התזכורות נעצרות רק כשמתועד טיפול."
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={1}
              className={cn(inputClass, "h-full min-h-11 resize-none py-2.5")}
            />
          </label>
          {report.status === "open" && (
            <Btn variant="primary" size={size} disabled={!note.trim()} onClick={() => act("handle", "הטיפול תועד")}>
              תיעוד טיפול
            </Btn>
          )}
          <Btn variant="outline" size={size} disabled={!note.trim()} onClick={() => act("close", "הבקשה נסגרה")}>
            סגירת הבקשה
          </Btn>
        </div>
      ) : (
        <Btn
          variant="outline"
          size={size}
          className="self-start"
          onClick={async () => tools.after("הבקשה נפתחה מחדש", await send(`/api/admin/reports/${report.id}/reopen`, {}))}
        >
          <Glyph name="restore" />
          פתיחה מחדש
        </Btn>
      )}
    </div>
  )
}
