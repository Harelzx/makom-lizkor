import { useCallback, useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Check, CornerUpLeft, Inbox, LoaderCircle, MapPin, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { KINDS } from "@/data/taxonomy"
import { ease, spring } from "@/lib/motion"
import { cn } from "@/lib/utils"
import type { Kind } from "@/types"
import { Alert, Empty, Loading, Section, block, card, meta } from "./ui"

interface Item {
  id: string
  rev: number
  revisionId: string
  kind: Kind
  name_he: string
  lat: number
  lng: number
  location_precision: "exact" | "approximate"
  link_url: string | null
  /** 1 when this is a correction of a place that is already published (the published version stays live meanwhile). */
  correction: number
  /** 1 when that place is hidden now: approving the correction doesn't show it again. */
  hidden: number
  photo_url: string | null
  photo_alt: string | null
  photo_credit: string | null
  place_he: string | null
  in_memory_of: string | null
  story_he: string | null
  /** 1 when the sender said the place is on private property. */
  on_private_property: number
  /** 1 when the owner allowed the exact location to be shown; only then is there an access note. */
  location_permission: number
  access_note_he: string | null
}

/** The pending items, or the Hebrew reason they can't be shown. */
async function fetchQueue(): Promise<Item[] | string> {
  try {
    const res = await fetch("/api/admin/queue")
    if (!res.ok) return res.status === 401 ? "צריך להתחבר." : "אין הרשאה."
    return ((await res.json()) as { items: Item[] }).items
  } catch {
    return "אין חיבור לשרת."
  }
}

type Action = "approve" | "reject" | "return"

/**
 * Approve, reject, or return to the sender with a note. The note is the only thing a moderator writes: a returned
 * place comes back as the sender's own correction.
 */
function Decision({
  item,
  busy,
  decide,
}: {
  item: Item
  busy: boolean
  decide: (item: Item, action: Action, note?: string) => Promise<void>
}) {
  const [returning, setReturning] = useState(false)
  const [note, setNote] = useState("")
  // Which button was pressed, so the wait shows on it rather than on the whole card.
  const [pressed, setPressed] = useState<Action | null>(null)
  const run = (action: Action, text?: string) => {
    setPressed(action)
    void decide(item, action, text)
  }
  const waiting = (action: Action) => busy && pressed === action
  if (returning)
    return (
      <form
        className={cn(block, "flex flex-col gap-4")}
        onSubmit={(e) => {
          e.preventDefault()
          if (note.trim()) run("return", note.trim())
        }}
      >
        <Field>
          <FieldLabel htmlFor={`note-${item.id}`}>הערה למגיש</FieldLabel>
          <Textarea id={`note-${item.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} required autoFocus />
          <FieldDescription>מה צריך לתקן. ההערה מוצגת למי ששלח את ההצעה, בקישור המעקב שלו.</FieldDescription>
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" className="pressable" disabled={busy || !note.trim()}>
            {waiting("return") ? <LoaderCircle aria-hidden className="animate-spin" /> : <CornerUpLeft aria-hidden />}
            שליחת ההחזרה
          </Button>
          <Button type="button" variant="ghost" className="pressable" onClick={() => setReturning(false)}>
            ביטול
          </Button>
        </div>
      </form>
    )
  return (
    <div className={cn(block, "flex flex-wrap items-center gap-2")}>
      <Button className="pressable min-w-28" disabled={busy} onClick={() => run("approve")}>
        {waiting("approve") ? <LoaderCircle aria-hidden className="animate-spin" /> : <Check aria-hidden />}
        אישור
      </Button>
      <Button className="pressable" variant="outline" disabled={busy} onClick={() => setReturning(true)}>
        <CornerUpLeft aria-hidden />
        החזרה לתיקון
      </Button>
      <Button className="pressable ms-auto text-ink-2" variant="ghost" disabled={busy} onClick={() => run("reject")}>
        {waiting("reject") ? <LoaderCircle aria-hidden className="animate-spin" /> : <X aria-hidden />}
        דחייה
      </Button>
    </div>
  )
}

/** One submission as it would be published, laid out to be read top to bottom before deciding. */
function Submission({
  item,
  busy,
  decide,
}: {
  item: Item
  busy: boolean
  decide: (item: Item, action: Action, note?: string) => Promise<void>
}) {
  return (
    <>
      {!!item.correction && (
        <p className="mb-2 flex items-center gap-2 text-label text-ink-1">
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-dawn" />
          {item.hidden ? "תיקון למקום שמוסתר כרגע: אישור לא יחזיר אותו לאתר" : "תיקון למקום שכבר מופיע באתר"}
        </p>
      )}
      <p className="text-caption text-ink-3">
        {meta([KINDS[item.kind].label, item.place_he, item.in_memory_of && `לזכר ${item.in_memory_of}`])}
      </p>
      <h3 className="mt-1 text-title-3 text-ink-1">{item.name_he}</h3>
      {/* The point that would be published, to check against a map before approving. */}
      <p className="mt-2 flex items-center gap-1.5 text-caption text-ink-2">
        <MapPin aria-hidden className="size-3.5 shrink-0" />
        <a
          className="tabular-nums underline decoration-line-strong underline-offset-4 hover:text-ink-1 hover:decoration-current"
          dir="ltr"
          href={`https://www.openstreetmap.org/?mlat=${item.lat}&mlon=${item.lng}#map=17/${item.lat}/${item.lng}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {item.lat.toFixed(5)}, {item.lng.toFixed(5)}
        </a>
        {item.location_precision === "approximate" && <span>(משוער)</span>}
      </p>
      {/* Shown as text, never as a link: the moderator reads where it goes before anyone can follow it. */}
      {item.link_url && (
        <p className="mt-1 text-caption break-all text-ink-2" dir="ltr">
          {item.link_url}
        </p>
      )}
      {/* Private property: what the visitor will be told, read before it is approved (the access note is published). */}
      {!!item.on_private_property && (
        <div className="mt-4 border-s-2 border-dawn ps-4">
          <p className="text-label font-bold text-ink-1">
            {item.location_permission ? "במקום פרטי, במיקום מדויק באישור הבעלים" : "במקום פרטי, בלי אישור הבעלים: יוצג מיקום משוער"}
          </p>
          {item.access_note_he && (
            <p className="mt-1 text-body whitespace-pre-line text-ink-1">
              <span className="text-ink-2">איך מגיעים (יפורסם): </span>
              {item.access_note_he}
            </p>
          )}
        </div>
      )}
      {item.photo_url && (
        <figure className="mt-4">
          <img
            src={item.photo_url}
            alt={item.photo_alt ?? ""}
            className="max-h-72 rounded-2xl border border-line bg-surface-2 object-contain"
          />
          <figcaption className="mt-2 text-caption text-ink-2">
            {meta([item.photo_alt, item.photo_credit && `צילום: ${item.photo_credit}`])}
          </figcaption>
        </figure>
      )}
      {item.story_he && <p className="reading-copy mt-4 text-body-lg whitespace-pre-line text-ink-1">{item.story_he}</p>}
      <Decision item={item} busy={busy} decide={decide} />
    </>
  )
}

/** The moderation queue: read a submission, approve or reject it. Moderators never edit what a contributor wrote. */
export function Queue({ onCount }: { onCount?: (n: number | null) => void }) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(async () => {
    const r = await fetchQueue()
    if (typeof r === "string") setError(r)
    else setItems(r)
  }, [])
  useEffect(() => {
    let live = true
    void fetchQueue().then((r) => {
      if (!live) return
      if (typeof r === "string") setError(r)
      else setItems(r)
    })
    return () => {
      live = false
    }
  }, [])
  // The page's header counts what waits here.
  useEffect(() => onCount?.(items ? items.length : null), [items, onCount])

  const decide = async (item: Item, action: Action, note?: string) => {
    setBusy(item.id)
    setError("")
    try {
      const res = await fetch(`/api/admin/places/${item.id}/transitions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, revisionId: item.revisionId, expectedRev: item.rev, ...(note ? { note } : {}) }),
      })
      if (res.status === 409) setError("מישהו אחר כבר טיפל בהצעה הזו.")
      else if (!res.ok) setError("הפעולה לא נשמרה. נסו שוב.")
    } catch {
      setError("אין חיבור לשרת. הפעולה לא נשמרה.")
    }
    setBusy(null)
    await load()
  }

  const loading = items === null && !error
  return (
    <Section
      id="queue"
      title="הצעות שממתינות לבדיקה"
      lead="מה שאנשים שלחו, בדיוק כפי שיפורסם. בודקים את המיקום במפה, קוראים, ומחליטים."
      count={items ? String(items.length) : null}
      busy={loading}
    >
      {error && <Alert className="mb-5">{error}</Alert>}
      {loading && <Loading />}
      {items?.length === 0 && (
        <Empty icon={<Inbox className="size-5" />} title="אין הצעות ממתינות.">
          הצעה חדשה תופיע כאן ברגע שתגיע.
        </Empty>
      )}
      <div className="grid gap-4">
        <AnimatePresence initial={false}>
          {items?.map((item, i) => (
            // A decided submission fades out of the list, and the ones after it close the gap.
            <motion.article
              key={item.id}
              layout="position"
              aria-label={item.name_he}
              className={card}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.38, ease, delay: Math.min(i, 8) * 0.04 } }}
              exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.2, ease } }}
              transition={spring.soft}
            >
              <Submission item={item} busy={busy === item.id} decide={decide} />
            </motion.article>
          ))}
        </AnimatePresence>
      </div>
    </Section>
  )
}
