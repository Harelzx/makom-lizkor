import { useState } from "react"
import { cn } from "@/lib/utils"
import type { Action, Item } from "./api"
import { Btn, fieldHint, fieldLabel, inputClass } from "./controls"
import { ago, overdue } from "./inbox-state"
import { Chip, Glyph, Kbd, KindArt, kindLabel, MapThumb, meta } from "./parts"
import type { GlyphName } from "../glyphs"

export type Decide = (item: Item, action: Action, note?: string) => Promise<void>

/** The things to look at before approving, each said in full: what the visitor will be told, where a link goes. */
export function checksOf(item: Item) {
  const list: { glyph: GlyphName; tone: "sun" | "green" | "ink"; title: string; detail?: string; ltr?: boolean }[] = []
  if (item.correction)
    list.push({
      glyph: "pencil",
      tone: "sun",
      title: item.hidden ? "תיקון למקום שמוסתר כרגע" : "תיקון למקום שכבר מופיע באתר",
      detail: item.hidden ? "אישור לא יחזיר אותו לאתר." : "הגרסה שבאתר נשארת עד האישור.",
    })
  if (item.on_private_property)
    list.push({
      glyph: "lock",
      tone: "sun",
      title: item.location_permission ? "במקום פרטי, במיקום מדויק באישור הבעלים" : "במקום פרטי, בלי אישור הבעלים: יוצג מיקום משוער",
      detail: item.access_note_he ? `איך מגיעים (יפורסם): ${item.access_note_he}` : undefined,
    })
  // Shown as text, never as a link: the moderator reads where it goes before anyone can follow it.
  if (item.link_url) list.push({ glyph: "link", tone: "sun", title: "קישור חיצוני", detail: item.link_url, ltr: true })
  if (overdue(item)) list.push({ glyph: "clock", tone: "sun", title: `ממתינה יותר משבועיים`, detail: `נשלחה ${ago(item.created_at)}` })
  if (item.photo_url)
    list.push({
      glyph: "camera",
      tone: "green",
      title: item.photo_credit ? "תמונה עם קרדיט" : "תמונה בלי קרדיט",
      detail: item.photo_alt ?? undefined,
    })
  if (!item.story_he && !item.photo_url)
    list.push({ glyph: "pencil", tone: "ink", title: "בלי סיפור ובלי תמונה", detail: "רק השם והמיקום." })
  return list
}

export function Checks({ item, className }: { item: Item; className?: string }) {
  const list = checksOf(item)
  const attention = list.filter((c) => c.tone === "sun").length
  return (
    <section
      aria-label="מה לבדוק לפני אישור"
      className={cn("overflow-hidden rounded-2xl border border-(--a-line) bg-(--a-panel)", className)}
    >
      <h3 className="flex items-center justify-between border-b border-(--a-line) px-4 py-3 text-[0.8125rem] font-bold text-(--a-ink-3)">
        מה לבדוק לפני אישור
        {attention > 0 ? <Chip tone="sun">{attention}</Chip> : <Chip tone="green">הכול רגיל</Chip>}
      </h3>
      <ul className="divide-y divide-(--a-line)">
        {list.map((c) => (
          <li key={c.title} className="flex gap-3 px-4 py-3 text-[0.9375rem]">
            <Glyph
              name={c.glyph}
              className={cn(
                "mt-1 size-4",
                c.tone === "sun" ? "text-(--a-sun)" : c.tone === "green" ? "text-(--a-green)" : "text-(--a-ink-3)",
              )}
            />
            <div className="min-w-0">
              <p className="font-medium text-(--a-ink-1)">{c.title}</p>
              {c.detail && (
                <p
                  dir={c.ltr ? "ltr" : undefined}
                  className={cn("mt-0.5 text-[0.875rem] break-words text-(--a-ink-2)", c.ltr && "text-right")}
                >
                  {c.detail}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The submission as it would be published, read top to bottom: the kind's drawing, the name, the photo, the story. */
export function ProposalBody({ item, compact, art = true }: { item: Item; compact?: boolean; art?: boolean }) {
  return (
    <div>
      <div className="flex items-start gap-4">
        {art && <KindArt kind={item.kind} className={cn("shrink-0 text-(--a-ink-1)", compact ? "size-14" : "size-20")} />}
        <div className="min-w-0 pt-1">
          <p className="text-[0.875rem] text-(--a-ink-3)">{meta([kindLabel(item.kind), item.place_he, `נשלחה ${ago(item.created_at)}`])}</p>
          <h2
            className={cn("mt-1 leading-tight font-bold tracking-[-0.01em] text-(--a-ink-1)", compact ? "text-[1.75rem]" : "text-[2rem]")}
          >
            {item.name_he}
          </h2>
          {item.in_memory_of && <p className="mt-1 text-[1rem] text-(--a-ink-2)">לזכר {item.in_memory_of}</p>}
        </div>
      </div>
      {(!!item.correction || overdue(item) || !!item.on_private_property) && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {!!item.correction && (
            <Chip tone="sun" glyph="pencil">
              {item.hidden ? "תיקון · המקום מוסתר" : "תיקון"}
            </Chip>
          )}
          {!!item.on_private_property && <Chip glyph="lock">מקום פרטי</Chip>}
          {overdue(item) && (
            <Chip tone="sun" glyph="clock">
              ממתינה מעל שבועיים
            </Chip>
          )}
        </div>
      )}
      {item.photo_url && (
        <figure className="mt-6">
          <img
            src={item.photo_url}
            alt={item.photo_alt ?? ""}
            className="aspect-[16/9] w-full rounded-2xl border border-(--a-line) bg-(--a-sunk) object-cover"
          />
          <figcaption className="mt-2 text-[0.8125rem] text-(--a-ink-3)">
            {meta([item.photo_alt, item.photo_credit && `צילום: ${item.photo_credit}`])}
          </figcaption>
        </figure>
      )}
      {item.story_he ? (
        <p className="mt-6 max-w-[62ch] text-[1.0625rem] leading-[1.85] whitespace-pre-line text-(--a-ink-1)">{item.story_he}</p>
      ) : (
        !item.photo_url && <p className="mt-6 text-[0.9375rem] text-(--a-ink-3)">בלי סיפור ובלי תמונה: רק השם והמיקום.</p>
      )}
    </div>
  )
}

export const ProposalMap = ({ item, className }: { item: Item; className?: string }) => (
  <MapThumb lat={item.lat} lng={item.lng} approximate={item.location_precision === "approximate"} className={className} />
)

/**
 * Approve, return to the sender with a note, or reject. The note is the only thing a moderator writes: a returned
 * place comes back as the sender's own correction. Keys reach these buttons through their data-shortcut, from anywhere.
 */
export function Decision({
  item,
  busy,
  decide,
  size = "md",
  skip,
}: {
  item: Item
  busy: boolean
  decide: Decide
  size?: "md" | "lg"
  skip?: () => void
}) {
  const [returning, setReturning] = useState(false)
  const [note, setNote] = useState("")
  const [pressed, setPressed] = useState<Action | null>(null)
  const run = (action: Action, text?: string) => {
    setPressed(action)
    void decide(item, action, text)
  }
  const waiting = (action: Action) => busy && pressed === action
  const spin = <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
  if (returning)
    return (
      <form
        className="flex w-full flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (note.trim()) run("return", note.trim())
        }}
      >
        <label>
          <span className={fieldLabel}>הערה למגיש</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            required
            autoFocus
            rows={2}
            className={cn(inputClass, "min-h-20 resize-none py-2.5")}
            onKeyDown={(e) => e.key === "Escape" && setReturning(false)}
          />
          <span className={fieldHint}>מה צריך לתקן. ההערה מוצגת למי ששלח את ההצעה, בקישור המעקב שלו.</span>
        </label>
        <div className="flex flex-wrap gap-2">
          <Btn type="submit" variant="primary" size={size} disabled={busy || !note.trim()}>
            {waiting("return") ? spin : <Glyph name="return" />}
            שליחת ההחזרה
          </Btn>
          <Btn variant="ghost" size={size} onClick={() => setReturning(false)}>
            ביטול
          </Btn>
        </div>
      </form>
    )
  return (
    <div className="grid w-full grid-cols-[1.3fr_1fr_auto] items-center gap-2 sm:flex sm:flex-wrap">
      <Btn data-shortcut="approve" variant="approve" size={size} disabled={busy} onClick={() => run("approve")} className="sm:min-w-36">
        {waiting("approve") ? spin : <Glyph name="approve" />}
        אישור<span className="max-sm:sr-only"> ופרסום</span>
        <Kbd>א</Kbd>
      </Btn>
      <Btn data-shortcut="return" variant="outline" size={size} disabled={busy} onClick={() => setReturning(true)}>
        <Glyph name="return" flip />
        החזרה<span className="max-sm:sr-only"> לתיקון</span>
        <Kbd>ת</Kbd>
      </Btn>
      <Btn data-shortcut="reject" variant="ghost" size={size} disabled={busy} onClick={() => run("reject")} className="max-sm:px-3">
        {waiting("reject") ? spin : <Glyph name="reject" className="size-3.5" />}
        דחייה
        <Kbd>ד</Kbd>
      </Btn>
      {skip && (
        <Btn variant="ghost" size={size} onClick={skip} className="ms-auto max-sm:hidden">
          דילוג
          <Glyph name="arrow" flip />
          <Kbd>J</Kbd>
        </Btn>
      )}
    </div>
  )
}
