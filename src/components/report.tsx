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
import { discard, dismiss, entry, heldFor, hydrate, readFailed, resend, start } from "@/lib/report-holder"
import { freeze } from "@/lib/report-outbox"
import { CURRENT_REPORT_NOTICE, REQUESTER_TYPES, type Element, type ReportInput } from "@/shared/contract"
import type { Place } from "@/types"

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
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Fields>(EMPTY)
  useReports()
  // The request this card shows, by key: the page holds it (src/lib/report-holder.ts), so it outlives the card closing.
  const [key, setKey] = useState<string | null>(null)
  const s = entry(key)
  // A request sent from here earlier comes back first; nothing can be sent until that is known.
  const [restoring, setRestoring] = useState(true)
  const curated = place.coord_source !== "contribution"
  // While a request is kept, the form shows it as it was sent, and only it.
  const kept = s?.r ?? null
  const busy = !!s?.busy
  const f = kept ? fieldsOf(kept.payload) : draft
  const change = (patch: Partial<Fields>) => setDraft((d) => ({ ...d, ...patch }))

  useEffect(() => {
    let live = true
    void hydrate().then(() => {
      if (!live) return
      const held = heldFor(place.id)
      if (held) {
        setKey(held.key)
        setOpen(true)
      }
      setRestoring(false)
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
    if (!ready || !draft.requester) return
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
    if (key) dismiss(key)
    setKey(r.key)
    setDraft(EMPTY)
    await start(r)
    if (entry(r.key)?.shown?.view === "editable") setDraft(fieldsOf(r.payload))
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
      {status ? (
        <p role="status" className="text-body text-ink-1">
          {status}
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
                      checked={f.elements.includes(e)}
                      onCheckedChange={(v) => change({ elements: v === true ? [...f.elements, e] : f.elements.filter((x) => x !== e) })}
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
          <div className="flex items-center justify-between gap-2">
            {kept ? (
              // Letting go here doesn't take back a request that arrived: a person reviews it as usual.
              <Button variant="ghost" disabled={busy} onClick={() => void discard(kept.key)}>
                {DISCARD_LABEL}
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => setOpen(false)}>
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
    </section>
  )
}
