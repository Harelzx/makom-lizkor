import { useEffect, useId, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { messageOf, UNREAD, useReports } from "@/components/report-state"
import { noticeHtml } from "@/data/legal"
import { DISCARD_LABEL, ELEMENT_LABEL, REQUESTER_LABEL } from "@/data/reports"
import { newSubmitKey } from "@/lib/api"
import { ease } from "@/lib/motion"
import { discard, dismiss, entry, heldFor, hydrate, latestFor, readFailed, resend, start } from "@/lib/report-holder"
import { freeze } from "@/lib/report-outbox"
import { CURRENT_REPORT_NOTICE, REQUESTER_TYPES, type Element, type ReportInput } from "@/shared/contract"
import type { Place } from "@/types"
import { CARD, Disclosure, PRESS, Segmented } from "@/components/kit"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ChevronLeftIcon } from "lucide-react"
import { cn } from "@/lib/utils"

const NOTICE_HTML = noticeHtml(CURRENT_REPORT_NOTICE)

type Fields = {
  elements: Element[]
  requester: (typeof REQUESTER_TYPES)[number] | null
  relationship: string
  explanation: string
  email: string
}
const EMPTY: Fields = { elements: [], requester: null, relationship: "", explanation: "", email: "" }
const fieldsOf = (p: ReportInput): Fields => ({
  elements: p.elements,
  requester: p.requesterType,
  relationship: p.relationship ?? "",
  explanation: p.explanation,
  email: p.email ?? "",
})

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
  const [intent, setIntent] = useState<"correction" | "removal">("correction")
  const [opened, setOpened] = useState(false)
  const [draft, setDraft] = useState<Fields>(EMPTY)
  useReports()
  // A request sent from here earlier comes back first; nothing can be sent until that is known.
  const [restoring, setRestoring] = useState(true)
  // The page holds the requests (src/lib/report-holder.ts), so the card always shows its place's newest one, whenever it
  // appears (read again after a failure, answered while the card was closed) and until the visitor closes its answer.
  const s = restoring ? undefined : latestFor(place.id)
  const curated = place.coord_source !== "contribution"
  // While a request is kept, the form shows it as it was sent, and only it.
  const kept = s?.r ?? null
  const busy = !!s?.busy
  // A request kept here, or its answer, waits for the visitor in the row below; the window opens only when asked to.
  const f = kept ? fieldsOf(kept.payload) : draft
  const change = (patch: Partial<Fields>) => setDraft((d) => ({ ...d, ...patch }))

  useEffect(() => {
    let live = true
    void hydrate().then(() => {
      if (live) setRestoring(false)
    })
    return () => {
      live = false
    }
  }, [place.id])

  const ready = f.elements.length > 0 && !!f.requester && f.explanation.trim().length > 0
  const message = messageOf(s, curated)
  const status = message.status
  // Unread: the browser's copy couldn't be read, so an earlier request may exist unseen; never shown as none.
  const alert = message.alert ?? (!restoring && !s && readFailed() ? UNREAD : undefined)

  const send = async () => {
    if (restoring || busy) return
    if (kept) return void resend(kept.key)
    // Never a new request in place of one still held for this place (another view may have found it meanwhile).
    if (heldFor(place.id) || !ready || !draft.requester) return
    const r = freeze(
      place.id,
      {
        placeId: place.id,
        elements: draft.elements,
        requesterType: draft.requester,
        ...(draft.relationship.trim() ? { relationship: draft.relationship.trim() } : {}),
        explanation: draft.explanation.trim(),
        ...(draft.email.trim() ? { email: draft.email.trim() } : {}),
        noticeVersion: CURRENT_REPORT_NOTICE,
      },
      newSubmitKey(),
    )
    // The fields show the kept request from here on. The draft goes, and comes back only when this first try is refused
    // before anything was stored; an expired or removed request leaves an empty form.
    if (s) dismiss(s.key)
    setDraft(EMPTY)
    await start(r)
    const after = entry(r.key)
    if (after?.shown?.view === "editable" && !after.r) setDraft(fieldsOf(r.payload))
  }

  /** The visitor is done with an answer, or with the form: a settled request goes from the page. */
  const close = () => {
    if (s && !s.r) dismiss(s.key)
    setOpened(false)
  }

  return (
    <>
      {/* A row of its own, like the card's other rows: a small underlined link at the very bottom went unseen. */}
      <button
        type="button"
        aria-label="בקשת הסרה או תיקון"
        aria-describedby={`${uid}-entry`}
        onClick={() => setOpened(true)}
        className={cn(CARD, "pressable flex min-h-14 w-full items-center gap-3 px-4 py-3 text-start", PRESS)}
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-label text-ink-1">בקשת הסרה או תיקון</span>
          <span id={`${uid}-entry`} className="text-caption text-ink-2">
            {kept ? "הבקשה שלכם שמורה כאן" : status || alert ? "יש עדכון על הבקשה שלכם" : "משהו לא מדויק, או מקום שצריך להסיר"}
          </span>
        </span>
        <ChevronLeftIcon aria-hidden="true" className="size-4 shrink-0 text-ink-2" />
      </button>
      {/* Its own window, as adding a place is: opened at the bottom of the card, the form went on below everything else
          and had to be scrolled to, then scrolled through, under the place it was about. */}
      <Dialog open={opened} onOpenChange={(v) => !v && close()}>
        <DialogContent dir="rtl" className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[520px]">
          <DialogHeader className="gap-1 px-6 pt-6 pb-3 text-start">
            <DialogTitle className="text-title-2 font-extrabold text-ink-1">בקשת הסרה או תיקון</DialogTitle>
            <DialogDescription className="text-body text-ink-2">{place.name_he}</DialogDescription>
          </DialogHeader>
          {status ? (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
                <p role="status" className="text-body text-ink-1">
                  {status}
                </p>
              </div>
              <div className={FOOTER}>
                <span />
                <Button className="pressable rounded-full px-5" onClick={close}>
                  סגירה
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-6 pb-5 text-body text-ink-1 [&_input]:text-base [&_textarea]:text-base">
                <p className="text-body text-ink-2">הבקשה תועבר לבדיקה. אם תשאירו מייל, נוכל לחזור אליכם.</p>
                <p className="text-body text-ink-2">אין צורך בשם, בתעודה מזהה או במסמכים. בקשה עשויה להוביל להסתרה זמנית במהלך הבדיקה.</p>
                <fieldset disabled={!!kept || busy || restoring} className="contents">
                  <FieldGroup>
                    {!kept && (
                      <FieldSet>
                        <FieldLegend variant="label">איך נוכל לעזור?</FieldLegend>
                        <Segmented
                          value={intent}
                          onChange={setIntent}
                          options={[
                            ["correction", "תיקון מידע"],
                            ["removal", "בקשת הסרה"],
                          ]}
                        />
                      </FieldSet>
                    )}

                    <FieldSet>
                      <FieldLegend variant="label">
                        {kept ? "מה לבקש להסיר או לתקן" : intent === "correction" ? "איזה מידע צריך לתקן?" : "מה תרצו להסיר?"}
                      </FieldLegend>
                      {elementsOf(place).map((e) => (
                        <Field key={e} orientation="horizontal">
                          <Checkbox
                            id={`${uid}-${e}`}
                            checked={f.elements.includes(e)}
                            onCheckedChange={(v) =>
                              change({ elements: v === true ? [...f.elements, e] : f.elements.filter((x) => x !== e) })
                            }
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
                            checked={f.requester === t}
                            onChange={() => change({ requester: t })}
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
                      <Input
                        id={`${uid}-rel`}
                        value={f.relationship}
                        onChange={(e) => change({ relationship: e.target.value })}
                        maxLength={200}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`${uid}-why`}>מה לבדוק, ולמה</FieldLabel>
                      <Textarea
                        id={`${uid}-why`}
                        value={f.explanation}
                        onChange={(e) => change({ explanation: e.target.value })}
                        maxLength={2000}
                        rows={4}
                        placeholder={intent === "correction" ? "מה לא מדויק, ומה המידע הנכון?" : "מה תרצו להסיר, ומה הסיבה לבקשה?"}
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
                        value={f.email}
                        onChange={(e) => change({ email: e.target.value })}
                        maxLength={254}
                      />
                      <FieldDescription>רק כדי שנוכל לעדכן אתכם או לשאול שאלה. המייל לא יתפרסם.</FieldDescription>
                    </Field>
                    {/* The notice sits beside the form it is about, as the privacy law asks. */}
                    <Disclosure summary="הודעת הפרטיות">
                      <div
                        className="flex flex-col gap-2 [&_a]:text-ink-1 [&_a]:underline [&_a]:underline-offset-2"
                        dangerouslySetInnerHTML={{ __html: NOTICE_HTML }}
                      />
                    </Disclosure>
                  </FieldGroup>
                </fieldset>
                <AnimatePresence>
                  {alert && (
                    <motion.p
                      key={alert}
                      role="alert"
                      className="text-label text-destructive"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.22, ease }}
                    >
                      {alert}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
              <div className={FOOTER}>
                {kept ? (
                  // Letting go here doesn't take back a request that arrived: a person reviews it as usual.
                  <Button variant="ghost" disabled={busy} onClick={() => void discard(kept.key)}>
                    {DISCARD_LABEL}
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={close}>
                    ביטול
                  </Button>
                )}
                <Button
                  className="pressable rounded-full px-5"
                  disabled={restoring || busy || (!kept && !ready)}
                  aria-busy={busy}
                  onClick={() => void send()}
                >
                  {kept ? "שליחה שוב" : "שליחת הבקשה"}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

/** The window's actions, held under the form as in the add-place window. */
const FOOTER =
  "flex shrink-0 items-center justify-between gap-2 border-t border-line bg-surface px-6 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]"
