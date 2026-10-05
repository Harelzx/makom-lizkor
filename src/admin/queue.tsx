import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { KINDS } from "@/data/taxonomy"
import type { Kind } from "@/types"

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
  photo_url: string | null
  photo_alt: string | null
  photo_credit: string | null
  place_he: string | null
  in_memory_of: string | null
  story_he: string | null
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
  if (returning)
    return (
      <form
        className="mt-3 flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (note.trim()) void decide(item, "return", note.trim())
        }}
      >
        <Field>
          <FieldLabel htmlFor={`note-${item.id}`}>הערה למגיש</FieldLabel>
          <Textarea id={`note-${item.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} required />
          <FieldDescription>מה צריך לתקן. ההערה מוצגת למי ששלח את ההצעה, בקישור המעקב שלו.</FieldDescription>
        </Field>
        <div className="flex gap-2">
          <Button type="submit" className="pressable" disabled={busy || !note.trim()}>
            שליחת ההחזרה
          </Button>
          <Button type="button" variant="ghost" className="pressable" onClick={() => setReturning(false)}>
            ביטול
          </Button>
        </div>
      </form>
    )
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Button className="pressable" disabled={busy} onClick={() => decide(item, "approve")}>
        אישור
      </Button>
      <Button className="pressable" variant="outline" disabled={busy} onClick={() => setReturning(true)}>
        החזרה לתיקון
      </Button>
      <Button className="pressable" variant="ghost" disabled={busy} onClick={() => decide(item, "reject")}>
        דחייה
      </Button>
    </div>
  )
}

/** The moderation queue: read a submission, approve or reject it. Moderators never edit what a contributor wrote. */
export function Queue() {
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

  return (
    // The site's body never scrolls (the map fills it), so the queue scrolls on its own.
    <main className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl p-6">
        <h1 className="text-title-2 text-ink-1">הצעות שממתינות לבדיקה</h1>
        {error && (
          <p role="alert" className="mt-3 text-label text-destructive">
            {error}
          </p>
        )}
        {items?.length === 0 && <p className="mt-6 text-ink-2">אין הצעות ממתינות.</p>}
        <div className="mt-6 grid gap-4">
          {items?.map((item) => (
            <article key={item.id} aria-label={item.name_he} className="rounded-2xl border border-line p-4">
              {!!item.correction && <p className="text-caption text-ink-2">תיקון למקום שכבר מופיע באתר</p>}
              <h2 className="text-label font-bold text-ink-1">{item.name_he}</h2>
              <p className="text-caption text-ink-2">
                {[KINDS[item.kind].label, item.place_he, item.in_memory_of && `לזכר ${item.in_memory_of}`].filter(Boolean).join(" · ")}
              </p>
              {/* The point that would be published, to check against a map before approving. */}
              <p className="text-caption text-ink-2 tabular-nums" dir="ltr">
                <a
                  className="underline underline-offset-2"
                  href={`https://www.openstreetmap.org/?mlat=${item.lat}&mlon=${item.lng}#map=17/${item.lat}/${item.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {item.lat.toFixed(5)}, {item.lng.toFixed(5)}
                </a>
                {item.location_precision === "approximate" && " (משוער)"}
              </p>
              {/* Shown as text, never as a link: the moderator reads where it goes before anyone can follow it. */}
              {item.link_url && (
                <p className="text-caption break-all text-ink-2" dir="ltr">
                  {item.link_url}
                </p>
              )}
              {item.photo_url && (
                <figure className="mt-2">
                  <img src={item.photo_url} alt={item.photo_alt ?? ""} className="max-h-64 rounded-xl object-contain" />
                  <figcaption className="text-caption text-ink-2">
                    {[item.photo_alt, item.photo_credit && `צילום: ${item.photo_credit}`].filter(Boolean).join(" · ")}
                  </figcaption>
                </figure>
              )}
              {item.story_he && <p className="mt-2 whitespace-pre-line text-ink-1">{item.story_he}</p>}
              <Decision item={item} busy={busy === item.id} decide={decide} />
            </article>
          ))}
        </div>
      </div>
    </main>
  )
}
