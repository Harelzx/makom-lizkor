import { useId, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { noticeHtml } from "@/data/legal"
import { ELEMENT_LABEL, REQUESTER_LABEL } from "@/data/reports"
import { newSubmitKey, sendReport } from "@/lib/api"
import { ease } from "@/lib/motion"
import { CURRENT_REPORT_NOTICE, REQUESTER_TYPES, type Element } from "@/shared/contract"
import type { Place } from "@/types"

const NOTICE_HTML = noticeHtml(CURRENT_REPORT_NOTICE)

// The privacy session's wording for each result (2026-10-06), word for word: a hide is never a decision on the request.
const HIDDEN = "מה שציינתם הוסתר באופן זמני, כאמצעי זהירות, עד שאדם יבדוק את הבקשה. ההסתרה אינה הכרעה בבקשה."
const RECEIVED = "הבקשה התקבלה. אדם יבדוק אותה בדחיפות."
const RECEIVED_CURATED = "הבקשה התקבלה. אדם יבדוק אותה בדחיפות. במקומות שהאתר הוסיף בעצמו, שום דבר לא מוסתר לפני הבדיקה."

// Not sent, or not known to have arrived: never worded as if it had been received (F4-R12).
const NOT_SENT = "הבקשה לא נשלחה. אפשר לנסות שוב בעוד רגע."
const UNKNOWN = "לא ברור אם הבקשה הגיעה אלינו. אפשר לשלוח אותה שוב: אם כבר הגיעה, לא תיפתח בקשה נוספת."
const REFUSED: Record<string, string> = {
  not_found: "המקום הזה אינו מוצג עכשיו, ולכן אי אפשר לשלוח עליו בקשה מכאן.",
  invalid_input: "משהו בטופס לא תקין. בדקו את המייל ואת אורך ההסבר, ונסו שוב.",
}
const REFUSED_OTHER = "הבקשה לא התקבלה. אפשר לכתוב לנו במייל."

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
 * Anyone can send one; what happens next is decided on the server, and a person reviews every request.
 */
export function ReportRequest({ place }: { place: Place }) {
  const uid = useId()
  const [open, setOpen] = useState(false)
  // One key for this request, kept across every try: a resend after a lost answer is the same request.
  const [key] = useState(newSubmitKey)
  const [elements, setElements] = useState<Element[]>([])
  const [requester, setRequester] = useState<(typeof REQUESTER_TYPES)[number] | null>(null)
  const [relationship, setRelationship] = useState("")
  const [explanation, setExplanation] = useState("")
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  // After a try whose answer was lost the request may be on the server: it is sent again as it was, never edited.
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const curated = place.coord_source !== "contribution"
  const ready = elements.length > 0 && requester && explanation.trim().length > 0

  const send = async () => {
    if (!ready || !requester || busy) return
    setBusy(true)
    setError("")
    const r = await sendReport(
      {
        placeId: place.id,
        elements,
        requesterType: requester,
        ...(relationship.trim() ? { relationship: relationship.trim() } : {}),
        explanation: explanation.trim(),
        ...(email.trim() ? { email: email.trim() } : {}),
        noticeVersion: CURRENT_REPORT_NOTICE,
      },
      key,
    )
    setBusy(false)
    if (r.ok) return setResult(r.outcome === "hidden_for_review" ? HIDDEN : curated ? RECEIVED_CURATED : RECEIVED)
    if (r.kind === "unknown") {
      setPending(true)
      return setError(UNKNOWN)
    }
    if (r.kind === "temporary") return setError(NOT_SENT)
    setError(REFUSED[r.code] ?? REFUSED_OTHER)
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
        <div className="flex flex-col gap-2">
          <p role="status" className="text-body text-ink-1">
            {result}
          </p>
        </div>
      ) : (
        <>
          <p className="text-caption text-ink-2">כל בקשה נבדקת בידי אדם בדחיפות. אין צורך בשם, בתעודה מזהה או במסמכים.</p>
          <fieldset disabled={pending || busy} className="contents">
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
            {pending ? (
              <span />
            ) : (
              <Button variant="ghost" onClick={() => setOpen(false)}>
                ביטול
              </Button>
            )}
            <Button className="pressable rounded-full px-5" disabled={!ready} aria-busy={busy} onClick={send}>
              {pending ? "שליחה שוב" : "שליחת הבקשה"}
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
