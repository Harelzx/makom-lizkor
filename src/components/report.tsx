import { useEffect, useId, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { noticeHtml } from "@/data/legal"
import { ELEMENT_LABEL, REQUESTER_LABEL } from "@/data/reports"
import { newSubmitKey } from "@/lib/api"
import { attempt, forget, freeze, pendingReport, remember, type PendingReport } from "@/lib/report-outbox"
import { ease } from "@/lib/motion"
import { CURRENT_REPORT_NOTICE, REQUESTER_TYPES, type Element } from "@/shared/contract"
import type { Place } from "@/types"

const NOTICE_HTML = noticeHtml(CURRENT_REPORT_NOTICE)

// The privacy session's wording for each result (2026-10-06), word for word: a hide is never a decision on the request.
const HIDDEN = "מה שציינתם הוסתר באופן זמני, כאמצעי זהירות, עד שאדם יבדוק את הבקשה. ההסתרה אינה הכרעה בבקשה."
const RECEIVED = "הבקשה התקבלה. אדם יבדוק אותה בדחיפות."
const RECEIVED_CURATED = "הבקשה התקבלה. אדם יבדוק אותה בדחיפות. במקומות שהאתר הוסיף בעצמו, שום דבר לא מוסתר לפני הבדיקה."

// Not known to have arrived: never worded as received (F4-R12), and never as if nothing had arrived either.
const UNKNOWN = "לא ברור אם הבקשה הגיעה אלינו. אפשר לשלוח אותה שוב כמו שהיא: אם כבר הגיעה, לא תיפתח בקשה נוספת."
const RESTORED = "בקשה ששלחתם מכאן עוד לא אושרה כמתקבלת. אפשר לשלוח אותה שוב כמו שהיא: אם כבר הגיעה, לא תיפתח בקשה נוספת."
const CONFLICT =
  "הקוד של הבקשה הזו כבר שמור אצלנו עם בקשה אחרת, ולכן לא ברור אם הבקשה הזו הגיעה. אפשר להסיר אותה מהמכשיר הזה ולשלוח בקשה חדשה."
const NOT_KEPT = " הדפדפן הזה לא שומר אותה: אם תסגרו או תרעננו את הדף, לא יהיה אפשר לשלוח אותה שוב."
// Refused before the server stored anything: about this try only.
const NOT_SENT: Record<string, string> = {
  not_found: "המקום הזה אינו מוצג עכשיו, ולכן אי אפשר לשלוח עליו בקשה מכאן.",
  invalid_input: "משהו בטופס לא תקין. בדקו את המייל ואת ההסבר, ונסו שוב.",
  turnstile_required: "בדיקת הדפדפן לא הושלמה. נסו שוב בעוד רגע.",
  turnstile_failed: "בדיקת הדפדפן לא עברה. נסו שוב בעוד רגע.",
  rate_limited: "נשלחו מכאן הרבה בקשות בזמן קצר. נסו שוב בעוד דקה.",
  not_configured: "השליחה לא זמינה כרגע. נסו שוב מאוחר יותר.",
  turnstile_unavailable: "השליחה לא זמינה כרגע. נסו שוב בעוד רגע.",
}
const AFTER_EARLIER = " ניסיון קודם עדיין לא אושר, ואפשר לנסות שוב כמו שהבקשה נשלחה."

/** What a request can name on this place: only what it shows, and always the place as a whole. */
function elementsOf(place: Place): Element[] {
  const shown: Element[] = ["name_he"]
  if (place.inMemoryOf) shown.push("in_memory_of")
  if (place.summary_he) shown.push("story_he")
  if (place.contributedPhoto || place.photos?.length) shown.push("photo")
  return [...shown, "whole"]
}

/**
 * A request to remove or correct something on a place (spec 6), opened from a quiet link at the foot of its card.
 * Anyone can send one; what happens next is decided on the server, and a person reviews every request. A request is
 * kept in this browser, as sent, until its arrival is known (src/lib/report-outbox.ts), and every resend is the same
 * request: same place, same body, same key.
 */
export function ReportRequest({ place }: { place: Place }) {
  const uid = useId()
  const [open, setOpen] = useState(false)
  const [elements, setElements] = useState<Element[]>([])
  const [requester, setRequester] = useState<(typeof REQUESTER_TYPES)[number] | null>(null)
  const [relationship, setRelationship] = useState("")
  const [explanation, setExplanation] = useState("")
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  // The request as sent, while its arrival isn't known: the form shows it and can only send it again, as it was.
  const [kept, setKept] = useState<PendingReport | null>(null)
  // Whether any try of it may have reached the server.
  const [uncertain, setUncertain] = useState(false)
  // Whether this browser kept it (false: it lives only in this page).
  const [stored, setStored] = useState(true)
  // A request sent from here earlier comes back first; nothing can be sent until that is known.
  const [restoring, setRestoring] = useState(true)
  const [result, setResult] = useState<string | null>(null)
  const curated = place.coord_source !== "contribution"

  useEffect(() => {
    let live = true
    void pendingReport(place.id).then((r) => {
      if (!live) return
      // A request sent from here earlier, as it was sent and locked: it can only be sent again, or let go.
      if (r) {
        setKept(r)
        setUncertain(true)
        setElements(r.payload.elements)
        setRequester(r.payload.requesterType)
        setRelationship(r.payload.relationship ?? "")
        setExplanation(r.payload.explanation)
        setEmail(r.payload.email ?? "")
        setOpen(true)
        setError(RESTORED)
      }
      setRestoring(false)
    })
    return () => {
      live = false
    }
  }, [place.id])

  const ready = elements.length > 0 && !!requester && explanation.trim().length > 0

  const send = async () => {
    if (busy || restoring || (!kept && (!ready || !requester))) return
    setBusy(true)
    setError("")
    let r = kept
    // Read from this try, not from state: a first try learns here whether the browser kept it.
    let keptHere = stored
    if (!r) {
      r = freeze(
        place.id,
        {
          placeId: place.id,
          elements,
          requesterType: requester!,
          ...(relationship.trim() ? { relationship: relationship.trim() } : {}),
          explanation: explanation.trim(),
          ...(email.trim() ? { email: email.trim() } : {}),
          noticeVersion: CURRENT_REPORT_NOTICE,
        },
        newSubmitKey(),
      )
      setKept(r)
      keptHere = await remember(r)
      setStored(keptHere)
    }
    const next = await attempt(r, uncertain)
    setBusy(false)
    if (next.view === "result") {
      setKept(null)
      return setResult(next.outcome === "hidden_for_review" ? HIDDEN : curated ? RECEIVED_CURATED : RECEIVED)
    }
    if (next.view === "editable") {
      // Refused before anything was stored, and no earlier try is in doubt: the form is the visitor's again.
      setKept(null)
      return setError(NOT_SENT[next.code] ?? NOT_SENT.not_configured)
    }
    setUncertain(true)
    const keptNote = keptHere ? "" : NOT_KEPT
    if (next.reason === "conflict") return setError(CONFLICT + keptNote)
    if (next.reason === "refused") return setError((NOT_SENT[next.code!] ?? NOT_SENT.not_configured) + AFTER_EARLIER + keptNote)
    setError(UNKNOWN + keptNote)
  }

  /** Lets go of the kept request here, at the visitor's word. If it arrived, it is reviewed as usual. */
  const discard = async () => {
    if (!kept) return
    await forget(kept.key)
    setKept(null)
    setUncertain(false)
    setError("")
  }

  if (!open)
    return (
      <button type="button" className="pressable self-start underline underline-offset-2" onClick={() => setOpen(true)}>
        בקשת הסרה או תיקון
      </button>
    )

  return (
    <section aria-labelledby={`${uid}-title`} className="mt-2 flex flex-col gap-4 border-t border-line pt-4 text-body text-ink-1">
      <h3 id={`${uid}-title`} className="text-title-3 text-ink-1">
        בקשת הסרה או תיקון
      </h3>
      {result ? (
        <p role="status" className="text-body text-ink-1">
          {result}
        </p>
      ) : (
        <>
          <p className="text-caption text-ink-2">כל בקשה נבדקת בידי אדם בדחיפות. אין צורך בשם, בתעודה מזהה או במסמכים.</p>
          <fieldset disabled={!!kept || busy || restoring} className="contents">
            <FieldGroup>
              <FieldSet>
                <FieldLegend variant="label">מה לבקש להסיר או לתקן</FieldLegend>
                {elementsOf(place).map((e) => (
                  <Field key={e} orientation="horizontal">
                    <Checkbox
                      id={`${uid}-${e}`}
                      checked={elements.includes(e)}
                      onCheckedChange={(v) => setElements((all) => (v === true ? [...all, e] : all.filter((x) => x !== e)))}
                    />
                    <FieldLabel htmlFor={`${uid}-${e}`} className="font-normal">
                      {ELEMENT_LABEL[e]}
                    </FieldLabel>
                  </Field>
                ))}
              </FieldSet>
              <FieldSet>
                <FieldLegend variant="label">מי מבקש</FieldLegend>
                {REQUESTER_TYPES.map((t) => (
                  <Field key={t} orientation="horizontal">
                    <input
                      type="radio"
                      id={`${uid}-who-${t}`}
                      name={`${uid}-who`}
                      checked={requester === t}
                      onChange={() => setRequester(t)}
                      className="size-4 accent-brand"
                    />
                    <FieldLabel htmlFor={`${uid}-who-${t}`} className="font-normal">
                      {REQUESTER_LABEL[t]}
                    </FieldLabel>
                  </Field>
                ))}
              </FieldSet>
              <Field>
                <FieldLabel htmlFor={`${uid}-rel`}>הקשר שלכם למקום או למי שהוא מנציח (לא חובה)</FieldLabel>
                <Input id={`${uid}-rel`} value={relationship} onChange={(e) => setRelationship(e.target.value)} maxLength={200} />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${uid}-why`}>מה לבדוק, ולמה</FieldLabel>
                <Textarea
                  id={`${uid}-why`}
                  value={explanation}
                  onChange={(e) => setExplanation(e.target.value)}
                  maxLength={2000}
                  rows={4}
                />
                <FieldDescription>כמה משפטים מספיקים. אל תכתבו כאן פרטים מזהים שאינם נחוצים לבקשה.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${uid}-email`}>מייל (לא חובה)</FieldLabel>
                <Input
                  id={`${uid}-email`}
                  type="email"
                  dir="ltr"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={254}
                />
                <FieldDescription>רק כדי שנוכל לעדכן אתכם או לשאול שאלה. המייל לא יתפרסם.</FieldDescription>
              </Field>
              {/* The notice sits beside the form it is about, as the privacy law asks. */}
              <details className="group rounded-2xl border border-line px-4 py-3 text-caption text-ink-2">
                <summary className="pressable cursor-pointer text-label text-ink-1 marker:text-ink-3">הודעת הפרטיות</summary>
                <div
                  className="mt-2 flex flex-col gap-2 [&_a]:text-ink-1 [&_a]:underline [&_a]:underline-offset-2"
                  dangerouslySetInnerHTML={{ __html: NOTICE_HTML }}
                />
              </details>
            </FieldGroup>
          </fieldset>
          <AnimatePresence>
            {error && (
              <motion.p
                key={error}
                role="alert"
                className="text-label text-destructive"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.22, ease }}
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>
          <div className="flex items-center justify-between gap-2">
            {kept ? (
              // Letting go here doesn't take back a request that arrived: a person reviews it as usual.
              <Button variant="ghost" disabled={busy} onClick={discard}>
                הסרה מהמכשיר הזה
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => setOpen(false)}>
                ביטול
              </Button>
            )}
            <Button className="pressable rounded-full px-5" disabled={restoring || (!kept && !ready)} aria-busy={busy} onClick={send}>
              {kept ? "שליחה שוב" : "שליחת הבקשה"}
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
