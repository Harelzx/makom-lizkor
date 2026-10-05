import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"

interface Item {
  id: string
  rev: number
  revisionId: string
  name_he: string
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

  const decide = async (item: Item, action: "approve" | "reject") => {
    setBusy(item.id)
    setError("")
    try {
      const res = await fetch(`/api/admin/places/${item.id}/transitions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, revisionId: item.revisionId, expectedRev: item.rev }),
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
              <h2 className="text-label font-bold text-ink-1">{item.name_he}</h2>
              <p className="text-caption text-ink-2">
                {[item.place_he, item.in_memory_of && `לזכר ${item.in_memory_of}`].filter(Boolean).join(" · ")}
              </p>
              {item.story_he && <p className="mt-2 whitespace-pre-line text-ink-1">{item.story_he}</p>}
              <div className="mt-3 flex gap-2">
                <Button className="pressable" disabled={busy === item.id} onClick={() => decide(item, "approve")}>
                  אישור
                </Button>
                <Button className="pressable" variant="ghost" disabled={busy === item.id} onClick={() => decide(item, "reject")}>
                  דחייה
                </Button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </main>
  )
}
