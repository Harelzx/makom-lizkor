import { useState } from "react"
import { Check, Clock, CornerUpLeft, LoaderCircle, Lock, MapPin, Pencil, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { KINDS } from "@/data/taxonomy"
import { cn } from "@/lib/utils"
import type { Kind } from "@/types"
import { ago, detailBar, detailBarInner, detailBody, meta } from "./ui"

export interface Item {
  id: string
  rev: number
  revisionId: string
  /** When it was sent: the queue is read oldest first. */
  created_at: string
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
export async function fetchQueue(): Promise<Item[] | string> {
  try {
    const res = await fetch("/api/admin/queue")
    if (!res.ok) return res.status === 401 ? "צריך להתחבר." : "אין הרשאה."
    return ((await res.json()) as { items: Item[] }).items
  } catch {
    return "אין חיבור לשרת."
  }
}

export type Action = "approve" | "reject" | "return"
export type Decide = (item: Item, action: Action, note?: string) => Promise<void>

const DAY = 86_400_000
export const waited = (item: Item) => ago(item.created_at)
/** Two weeks is when the queue's own reminders call a submission late. */
export const overdue = (item: Item) => Date.now() - new Date(item.created_at).getTime() > 14 * DAY
export const proposalMeta = (item: Item) => meta([KINDS[item.kind].label, item.place_he])

/**
 * Approve, reject, or return to the sender with a note. The note is the only thing a moderator writes: a returned
 * place comes back as the sender's own correction. The keys in the hints work from anywhere on the page (inbox.tsx).
 */
function Decision({ item, busy, decide }: { item: Item; busy: boolean; decide: Decide }) {
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
        className={cn(detailBarInner, "flex-col items-stretch")}
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
    <div className={detailBarInner}>
      <Button
        data-shortcut="approve"
        className="pressable min-w-28 bg-hope text-white hover:bg-hope/90 dark:text-canvas"
        disabled={busy}
        onClick={() => run("approve")}
      >
        {waiting("approve") ? <LoaderCircle aria-hidden className="animate-spin" /> : <Check aria-hidden />}
        אישור
        <Key>א</Key>
      </Button>
      <Button data-shortcut="return" className="pressable" variant="outline" disabled={busy} onClick={() => setReturning(true)}>
        <CornerUpLeft aria-hidden />
        החזרה לתיקון
        <Key>ת</Key>
      </Button>
      <Button data-shortcut="reject" className="pressable ms-auto text-ink-2" variant="ghost" disabled={busy} onClick={() => run("reject")}>
        {waiting("reject") ? <LoaderCircle aria-hidden className="animate-spin" /> : <X aria-hidden />}
        דחייה
        <Key>ד</Key>
      </Button>
    </div>
  )
}

/** A key's hint on its button: for the eye only (the button's name stays the action), and only where there's a keyboard. */
export function Key({ children }: { children: string }) {
  return (
    <kbd
      aria-hidden
      className="hidden h-5 min-w-5 place-items-center rounded-md border border-current px-1 font-sans text-micro opacity-55 pointer-fine:inline-grid"
    >
      {children}
    </kbd>
  )
}

/** One submission as it would be published, laid out to be read top to bottom before deciding. */
export function ProposalDetail({ item, busy, decide }: { item: Item; busy: boolean; decide: Decide }) {
  const flags = [
    !!item.correction && {
      icon: <Pencil />,
      text: item.hidden ? "תיקון למקום שמוסתר כרגע: אישור לא יחזיר אותו לאתר" : "תיקון למקום שכבר מופיע באתר",
    },
    overdue(item) && { icon: <Clock />, text: `ממתינה יותר משבועיים (${waited(item)})`, late: true },
  ].filter(Boolean) as { icon: React.ReactNode; text: string; late?: boolean }[]
  return (
    <article aria-label={item.name_he} className="flex flex-1 flex-col">
      <div className={detailBody}>
        <p className="text-caption text-ink-2">
          {meta([KINDS[item.kind].label, item.place_he, item.in_memory_of && `לזכר ${item.in_memory_of}`])}
        </p>
        <h2 className="mt-2 text-title-2 text-ink-1">{item.name_he}</h2>
        {/* The point that would be published, to check against a map before approving. */}
        <p className="mt-3 flex items-center gap-2 text-caption text-ink-2">
          <MapPin aria-hidden className="size-4 shrink-0" />
          <a
            className="inline-flex min-h-8 items-center text-ink-1 tabular-nums underline decoration-line-strong decoration-2 underline-offset-4 hover:decoration-current"
            dir="ltr"
            href={`https://www.openstreetmap.org/?mlat=${item.lat}&mlon=${item.lng}#map=17/${item.lat}/${item.lng}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {item.lat.toFixed(5)}, {item.lng.toFixed(5)}
          </a>
          {item.location_precision === "approximate" && <span className="font-medium text-ink-1">(משוער)</span>}
        </p>
        {/* Shown as text, never as a link: the moderator reads where it goes before anyone can follow it. */}
        {item.link_url && (
          <p className="mt-1 text-right text-caption break-all text-ink-2" dir="ltr">
            {item.link_url}
          </p>
        )}

        {(flags.length > 0 || !!item.on_private_property) && (
          <ul className="mt-6 divide-y divide-line border-y border-line">
            {flags.map((f) => (
              <li key={f.text} className={cn("flex gap-3 py-3 text-body", f.late ? "text-brand" : "text-ink-1")}>
                <span aria-hidden className="mt-1 shrink-0 [&_svg]:size-4">
                  {f.icon}
                </span>
                {f.text}
              </li>
            ))}
            {/* Private property: what the visitor will be told, read before it is approved (the access note is published). */}
            {!!item.on_private_property && (
              <li className="flex gap-3 py-3 text-body text-ink-1">
                <Lock aria-hidden className="mt-1 size-4 shrink-0 text-ink-2" />
                <div>
                  <p className="font-medium">
                    {item.location_permission ? "במקום פרטי, במיקום מדויק באישור הבעלים" : "במקום פרטי, בלי אישור הבעלים: יוצג מיקום משוער"}
                  </p>
                  {item.access_note_he && (
                    <p className="mt-1 whitespace-pre-line">
                      <span className="text-ink-2">איך מגיעים (יפורסם): </span>
                      {item.access_note_he}
                    </p>
                  )}
                </div>
              </li>
            )}
          </ul>
        )}

        {item.photo_url && (
          <figure className="mt-7">
            <img
              src={item.photo_url}
              alt={item.photo_alt ?? ""}
              className="max-h-[28rem] w-full rounded-2xl border border-line bg-surface-2 object-cover"
            />
            <figcaption className="mt-2 text-caption text-ink-2">
              {meta([item.photo_alt, item.photo_credit && `צילום: ${item.photo_credit}`])}
            </figcaption>
          </figure>
        )}
        {item.story_he ? (
          <p className="reading-copy mt-7 text-body-lg whitespace-pre-line text-ink-1">{item.story_he}</p>
        ) : (
          !item.photo_url && <p className="mt-7 text-body text-ink-3">בלי סיפור ובלי תמונה: רק השם והמיקום.</p>
        )}
      </div>
      <div className={detailBar}>
        <Decision key={item.id} item={item} busy={busy} decide={decide} />
      </div>
    </article>
  )
}
