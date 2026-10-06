import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { ELSEWHERE, messageOf, useReports } from "@/components/report-state"
import { DISCARD_LABEL } from "@/data/reports"
import { allEntries, discard, dismiss, hydrate, readFailed, resend, type Entry } from "@/lib/report-holder"
import { useStore } from "@/store"

const UNREAD_ANY = "לא הצלחנו לבדוק אם שמורה בדפדפן הזה בקשת הסרה או תיקון ששלחתם ועוד לא אושרה. אם שלחתם בקשה כזו, נסו לבדוק שוב בעוד רגע."

/**
 * Requests sent from this browser about places that aren't shown now (hidden, perhaps by the request itself, or
 * withdrawn), whose arrival isn't known. Their card can't be opened, so they're offered here: to go again as they were,
 * or to be let go. Nothing of the place or of the request is shown; a place that is shown keeps its request in its card.
 * A settled one stays, with only its answer, until the visitor closes it.
 */
export function PendingReports() {
  useReports()
  const feedVersion = useStore((s) => s.feedVersion)
  const feedLive = useStore((s) => s.feedLive)
  const remote = useStore((s) => s.remote)
  useEffect(() => void hydrate(), [])
  // Only the server's own feed tells which places aren't shown; before it, every contribution would look hidden.
  const live = !!feedVersion && feedLive
  // Every place shown comes with the feed now, the site's own included (phase 7): a request about one of them is
  // judged by the same live feed as a contribution's.
  const shown = new Set(remote.map((p) => p.id))
  const elsewhere = live ? allEntries().filter((e) => !shown.has(e.placeId) && (e.r || e.shown)) : []
  const unread = readFailed()
  if (!elsewhere.length && !unread) return null
  return (
    <div className="fixed inset-x-4 top-4 z-40 mx-auto flex max-w-md flex-col gap-3">
      {unread && (
        <section aria-label="בקשה ששלחתם" className={CARD}>
          <p role="alert">{UNREAD_ANY}</p>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => void hydrate()}>
              לבדוק שוב
            </Button>
          </div>
        </section>
      )}
      {elsewhere.map((e) => (
        <Pending key={e.key} e={e} />
      ))}
    </div>
  )
}

const CARD = "flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 text-body text-ink-1 shadow-float"

function Pending({ e }: { e: Entry }) {
  // Its place isn't shown, so it can't be one of the site's own: those are never hidden before a review.
  const { status, alert } = messageOf(e, false, ELSEWHERE)
  return (
    <section aria-label="בקשה ששלחתם" className={CARD}>
      {status ? <p role="status">{status}</p> : alert && <p role="alert">{alert}</p>}
      <div className="flex justify-end gap-2">
        {e.r ? (
          <>
            <Button variant="ghost" disabled={e.busy} onClick={() => void discard(e.key)}>
              {DISCARD_LABEL}
            </Button>
            <Button className="pressable rounded-full px-5" disabled={e.busy} aria-busy={e.busy} onClick={() => void resend(e.key)}>
              שליחה שוב
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={() => dismiss(e.key)}>
            סגירה
          </Button>
        )}
      </div>
    </section>
  )
}
