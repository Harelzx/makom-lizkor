import { useEffect, useState, useSyncExternalStore } from "react"
import { Button } from "@/components/ui/button"
import { ELSEWHERE, messageOf, useHolder } from "@/components/report-state"
import { DISCARD_LABEL } from "@/data/reports"
import { pendingReports, reportsVersion, subscribeReports, type PendingReport } from "@/lib/report-outbox"
import { useStore } from "@/store"

/**
 * Requests sent from this browser about places that aren't shown now (hidden, perhaps by the request itself, or
 * withdrawn), whose arrival isn't known. Their card can't be opened, so they're offered here: to go again as they were,
 * or to be let go. Nothing of the place or of the request is shown; a place that is shown keeps its request in its card.
 */
export function PendingReports() {
  const feedVersion = useStore((s) => s.feedVersion)
  const feedLive = useStore((s) => s.feedLive)
  const seed = useStore((s) => s.seed)
  const remote = useStore((s) => s.remote)
  const version = useSyncExternalStore(subscribeReports, reportsVersion)
  // Each stays listed once found, until the visitor closes it, so the answer to a resend stays readable.
  const [found, setFound] = useState<PendingReport[]>([])
  useEffect(() => {
    // Only the server's own feed tells which places aren't shown; before it, every contribution would look hidden.
    if (!feedVersion || !feedLive) return
    let live = true
    void pendingReports().then(({ reports }) => {
      if (!live) return
      const shown = new Set([...seed, ...remote].map((p) => p.id))
      setFound((was) => {
        const more = reports.filter((r) => !shown.has(r.placeId) && !was.some((w) => w.key === r.key))
        return more.length ? [...was, ...more] : was
      })
    })
    return () => {
      live = false
    }
  }, [feedVersion, feedLive, seed, remote, version])
  if (!found.length) return null
  return (
    <div className="fixed inset-x-4 top-4 z-40 mx-auto flex max-w-md flex-col gap-3">
      {found.map((r) => (
        <Pending key={r.key} report={r} onClose={() => setFound((all) => all.filter((x) => x.key !== r.key))} />
      ))}
    </div>
  )
}

function Pending({ report, onClose }: { report: PendingReport; onClose: () => void }) {
  const [h, s] = useHolder()
  useEffect(() => h.restore(report), [h, report])
  // Its place isn't shown, so it can't be one of the site's own: those are never hidden before a review.
  const { status, alert } = messageOf(s, false, ELSEWHERE)
  return (
    <section
      aria-label="בקשה ששלחתם"
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 text-body text-ink-1 shadow-float"
    >
      {status ? <p role="status">{status}</p> : alert && <p role="alert">{alert}</p>}
      <div className="flex justify-end gap-2">
        {s.kept ? (
          <>
            <Button variant="ghost" disabled={s.busy} onClick={() => void h.discard()}>
              {DISCARD_LABEL}
            </Button>
            <Button className="pressable rounded-full px-5" disabled={s.busy} aria-busy={s.busy} onClick={() => void h.resend()}>
              שליחה שוב
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            סגירה
          </Button>
        )}
      </div>
    </section>
  )
}
