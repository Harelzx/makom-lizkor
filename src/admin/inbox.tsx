import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { AnimatePresence, motion } from "motion/react"
import { ArrowRight, CircleCheck, House, Keyboard, MoonStar, RotateCcw, Sun } from "lucide-react"
import { AnemoneMark } from "@/components/anemone"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { ease } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { CuratedImport } from "./curated-import"
import { Operations } from "./operations"
import { fetchQueue, ProposalDetail, proposalMeta, overdue, waited, type Action, type Decide, type Item } from "./queue"
import {
  PlaceLookup,
  PROBLEM,
  receivedAt,
  ReportDetail,
  reportMeta,
  reportName,
  urgent,
  usePaged,
  type Attention,
  type Report,
} from "./reports"
import { isDark, toggleTheme } from "./theme"
import { Alert, card, detailBody } from "./ui"

/**
 * The moderators' inbox: one list of everything that waits, most urgent first, and the chosen item beside it. A
 * decision takes the next one in, so a session is read straight through; the keys do the same from the keyboard.
 */

type Selection = { kind: "report" | "proposal"; id: string }
type Filter = "all" | "reports" | "proposals"
const same = (a: Selection | null, b: Selection | null) => !!a && !!b && a.kind === b.kind && a.id === b.id
const rowId = (s: Selection) => `row-${s.kind}-${s.id}`

/** What a decision says once it is saved, in the action's own words. */
const DONE: Record<Action, string> = {
  approve: "ההצעה אושרה ותופיע במפה",
  return: "ההצעה הוחזרה למגיש לתיקון",
  reject: "ההצעה נדחתה",
}

// Wide enough for the list and the item side by side (Tailwind's lg). Below it the item is a layer over the list, and the
// overview sits under the list instead of in a layer nobody opened.
const wideQuery = matchMedia("(min-width: 64rem)")
const useWide = () =>
  useSyncExternalStore(
    (change) => {
      wideQuery.addEventListener("change", change)
      return () => wideQuery.removeEventListener("change", change)
    },
    () => wideQuery.matches,
  )

const today = new Date().toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Jerusalem" })
const count = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`)

function Row({
  sel,
  current,
  title,
  meta,
  age,
  hot,
  onSelect,
}: {
  sel: Selection
  current: boolean
  title: ReactNode
  meta: ReactNode
  age: string
  hot?: boolean
  onSelect: () => void
}) {
  const id = rowId(sel)
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.18, ease } }}
      transition={{ duration: 0.26, ease }}
    >
      {/* Named by its title alone, so it reads (and is found) as the item it opens; the line under it describes it. */}
      <button
        id={id}
        type="button"
        aria-labelledby={`${id}-t`}
        aria-describedby={`${id}-m`}
        aria-current={current || undefined}
        onClick={onSelect}
        className={cn(
          "pressable grid min-h-16 w-full grid-cols-[0.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 rounded-xl px-3 py-2.5 text-start outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
          current ? "bg-surface-3" : "hover:bg-surface-3/50",
        )}
      >
        <span aria-hidden className={cn("row-span-2 size-2 self-center rounded-full", hot ? "bg-brand" : "bg-ink-3/40")} />
        <span id={`${id}-t`} className="truncate text-label text-ink-1">
          {title}
        </span>
        <span className="text-caption whitespace-nowrap text-ink-3">{age}</span>
        <span id={`${id}-m`} className="col-span-2 col-start-2 truncate text-caption text-ink-2">
          {meta}
        </span>
      </button>
    </motion.li>
  )
}

function Group({ title, n, hot, children }: { title: string; n: number; hot?: boolean; children: ReactNode }) {
  return (
    <section aria-label={title} className="mt-4 first:mt-1">
      <h2 className={cn("mx-3 mb-1 flex items-baseline gap-2 text-caption font-semibold", hot ? "text-brand" : "text-ink-2")}>
        {title}
        <span className="font-normal tabular-nums opacity-75">{n}</span>
      </h2>
      <ul className="flex flex-col gap-0.5">
        <AnimatePresence initial={false}>{children}</AnimatePresence>
      </ul>
    </section>
  )
}

function Shortcuts({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const keys: [string[], string][] = [
    [["↓", "j"], "הפריט הבא"],
    [["↑", "k"], "הפריט הקודם"],
    [["א", "a"], "אישור ההצעה"],
    [["ת", "r"], "החזרה לתיקון"],
    [["ד", "d"], "דחיית ההצעה"],
    [["Esc"], "חזרה לרשימה בטלפון, או סגירה"],
    [["?"], "החלון הזה"],
  ]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-title-3">קיצורי מקלדת</DialogTitle>
          <DialogDescription className="text-body text-ink-2">פועלים בכל מקום בעמוד, חוץ מבתוך שדה כתיבה.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-3 text-body">
          {keys.map(([k, what]) => (
            <div key={what} className="contents">
              <dt className="flex gap-1">
                {k.map((key) => (
                  <kbd
                    key={key}
                    className="inline-grid h-6 min-w-6 place-items-center rounded-md border border-line-strong px-1.5 font-sans text-caption"
                  >
                    {key}
                  </kbd>
                ))}
              </dt>
              <dd className="text-ink-2">{what}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}

/** Nothing chosen: where the day stands, and the tools that aren't about one item (status, a place by its link, import). */
function Overview({
  loaded,
  reports,
  proposals,
  attention,
  start,
}: {
  loaded: boolean
  reports: number
  proposals: number
  attention: number
  start: (() => void) | null
}) {
  const parts = [reports && count(reports, "בקשה אחת להסרה", "בקשות להסרה"), proposals && count(proposals, "הצעה אחת", "הצעות")].filter(
    Boolean,
  )
  const waiting = parts.length ? `${parts.join(" ו־")} ${reports + proposals === 1 ? "מחכה" : "מחכות"} לבדיקה.` : ""
  return (
    <div className={detailBody}>
      <p className="text-label text-ink-3">{today}</p>
      <h2 className="mt-1 text-title-1 text-ink-1">תור המנהלים</h2>
      {!loaded ? (
        <Skeleton aria-hidden className="mt-4 h-5 w-72 max-w-full rounded-full bg-surface-3" />
      ) : waiting ? (
        <>
          <p className="reading-copy mt-3 text-body-lg text-ink-2">
            {waiting}{" "}
            {reports ? "הבקשות ראשונות ברשימה, כי כל אחת נבדקת בדחיפות." : "מנהלים לא עורכים את מה שנכתב: מאשרים, מחזירים או דוחים."}
            {attention ? ` ו${count(attention, "פעולה אחת נעצרה", "פעולות נעצרו")} באמצע.` : ""}
          </p>
          {start && (
            <Button className="pressable mt-6" onClick={start}>
              להתחיל מהראשון
            </Button>
          )}
        </>
      ) : (
        <div className="mt-6 flex items-center gap-4">
          <span aria-hidden className="grid size-12 place-items-center rounded-full bg-hope-soft text-hope">
            <CircleCheck className="size-6" />
          </span>
          <div>
            <p className="text-title-3 text-ink-1">הכול טופל</p>
            <p className="text-body text-ink-2">אין בקשות ואין הצעות שמחכות. מה שיגיע יופיע ברשימה.</p>
          </div>
        </div>
      )}

      <div className="mt-12 grid gap-8">
        <Operations />
        <section aria-labelledby="lookup-title" className={card}>
          <h2 id="lookup-title" className="mb-4 text-title-3 text-ink-1">
            בקשה שהגיעה במייל או בטלפון
          </h2>
          <PlaceLookup />
        </section>
        <CuratedImport />
      </div>
    </div>
  )
}

export function Inbox() {
  const [queue, setQueue] = useState<Item[] | null>(null)
  const [queueError, setQueueError] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const reports = usePaged<Report>("/api/admin/reports", "items")
  const attention = usePaged<Attention>("/api/admin/attention", "ops")
  // A request's own failure, shown with that request.
  const [reportError, setReportError] = useState("")
  const [sel, setSel] = useState<Selection | null>(null)
  // On a phone the chosen item is a layer over the list; this says whether it is open (the overview is a choice too).
  const [layer, setLayer] = useState(false)
  const [filter, setFilter] = useState<Filter>("all")
  const [done, setDone] = useState(0)
  const [said, setSaid] = useState<{ text: string; n: number } | null>(null)
  const [keysOpen, setKeysOpen] = useState(false)
  const [dark, setDark] = useState(isDark)
  const detail = useRef<HTMLDivElement>(null)
  const wide = useWide()

  const { refresh: refreshReports } = reports
  const { refresh: refreshAttention } = attention
  const loadReports = useCallback(async () => {
    await Promise.all([refreshReports(), refreshAttention()])
  }, [refreshReports, refreshAttention])
  useEffect(() => {
    void loadReports()
  }, [loadReports])
  useEffect(() => {
    let live = true
    void fetchQueue().then((r) => {
      if (!live) return
      if (typeof r === "string") setQueueError(r)
      else setQueue(r)
    })
    return () => {
      live = false
    }
  }, [])

  const say = (text: string) => setSaid((s) => ({ text, n: (s?.n ?? 0) + 1 }))
  useEffect(() => {
    if (!said) return
    const t = setTimeout(() => setSaid(null), 3200)
    return () => clearTimeout(t)
  }, [said])

  const all = useMemo(() => reports.items ?? [], [reports.items])
  const hot = all.filter(urgent)
  const rest = all.filter((r) => !urgent(r))
  const proposals = useMemo(() => queue ?? [], [queue])
  const ops = attention.items ?? []
  const open = all.filter((r) => r.status !== "closed").length
  const remaining = open + ops.length + proposals.length
  const loaded = reports.items !== null && queue !== null

  // The order the list shows, and the keys move through.
  const order: Selection[] = [
    ...(filter !== "proposals" ? [...hot, ...rest].map((r) => ({ kind: "report" as const, id: r.id })) : []),
    ...(filter !== "reports" ? proposals.map((i) => ({ kind: "proposal" as const, id: i.id })) : []),
  ]
  const report = sel?.kind === "report" ? all.find((r) => r.id === sel.id) : undefined
  const proposal = sel?.kind === "proposal" ? proposals.find((i) => i.id === sel.id) : undefined
  const shown: Selection | null = report || proposal ? sel : null

  const select = useCallback((next: Selection | null) => {
    setSel(next)
    setReportError("")
    setLayer(!!next)
    detail.current?.scrollTo({ top: 0 })
  }, [])

  const decide: Decide = async (item, action, note) => {
    setBusy(item.id)
    setQueueError("")
    let ok = false
    try {
      const res = await fetch(`/api/admin/places/${item.id}/transitions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, revisionId: item.revisionId, expectedRev: item.rev, ...(note ? { note } : {}) }),
      })
      if (res.status === 409) setQueueError("מישהו אחר כבר טיפל בהצעה הזו.")
      else if (!res.ok) setQueueError("הפעולה לא נשמרה. נסו שוב.")
      else ok = true
    } catch {
      setQueueError("אין חיבור לשרת. הפעולה לא נשמרה.")
    }
    const at = proposals.findIndex((i) => i.id === item.id)
    const r = await fetchQueue()
    setBusy(null)
    if (typeof r === "string") return setQueueError(r)
    setQueue(r)
    if (!ok) return
    setDone((d) => d + 1)
    say(DONE[action])
    // The next one takes its place, so a session reads straight through; after the last, the overview says so.
    const next = r[at] ?? r[at - 1]
    select(next ? { kind: "proposal", id: next.id } : null)
  }

  // The keys: moving through the list, and deciding on the proposal in view. Never while typing, never with a modifier.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
      const el = e.target as HTMLElement
      if (el.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return
      if (e.key === "?") {
        e.preventDefault()
        return setKeysOpen(true)
      }
      if (e.key === "Escape" && layer) return setLayer(false)
      const step = e.key === "ArrowDown" || e.key === "j" ? 1 : e.key === "ArrowUp" || e.key === "k" ? -1 : 0
      if (step) {
        if (!order.length) return
        e.preventDefault()
        const at = shown ? order.findIndex((s) => same(s, shown)) : -1
        const next = order[Math.min(Math.max(at + step, 0), order.length - 1)]
        select(next)
        document.getElementById(rowId(next))?.focus({ preventScroll: false })
        return
      }
      const action = { a: "approve", א: "approve", r: "return", ת: "return", d: "reject", ד: "reject" }[e.key.toLowerCase()]
      if (action && proposal) {
        e.preventDefault()
        detail.current?.querySelector<HTMLButtonElement>(`[data-shortcut="${action}"]:not(:disabled)`)?.click()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  })

  const filters: [Filter, string, number][] = [
    ["all", "הכול", remaining],
    ["reports", "בקשות", open + ops.length],
    ["proposals", "הצעות", proposals.length],
  ]
  const progress = done + remaining ? done / (done + remaining) : 0
  const showReports = filter !== "proposals"
  const showProposals = filter !== "reports"

  const overview = (
    <Overview
      loaded={loaded}
      reports={open}
      proposals={proposals.length}
      attention={ops.length}
      start={order.length ? () => select(order[0]) : null}
    />
  )

  return (
    <div className="grid h-full lg:grid-cols-[24rem_minmax(0,1fr)]">
      <h1 className="sr-only">ניהול · מקום לזכור</h1>

      {/* The list */}
      <div className="flex h-full flex-col border-line bg-surface-2 max-lg:overflow-y-auto lg:min-h-0 lg:border-e dark:bg-canvas">
        <div className="px-4 pt-4 sm:px-5">
          <div className="flex items-center justify-between gap-2">
            <a
              href="/"
              className="pressable flex items-center gap-2 rounded-lg py-1 text-label text-ink-2 [--mark-ground:var(--surface-2)] hover:text-ink-1 dark:[--mark-ground:var(--canvas)]"
            >
              <AnemoneMark size={22} />
              מקום לזכור · ניהול
            </a>
            <div className="flex items-center">
              <Button
                variant="ghost"
                size="icon-lg"
                className="pressable text-ink-2"
                aria-label="סקירה"
                onClick={() => {
                  select(null)
                  if (!wide) document.getElementById("overview")?.scrollIntoView({ block: "start" })
                }}
              >
                <House />
              </Button>
              <Button
                variant="ghost"
                size="icon-lg"
                className="pressable text-ink-2 max-lg:hidden"
                aria-label="קיצורי מקלדת"
                onClick={() => setKeysOpen(true)}
              >
                <Keyboard />
              </Button>
              <Button
                variant="ghost"
                size="icon-lg"
                className="pressable text-ink-2"
                aria-label={dark ? "מצב בהיר" : "מצב כהה"}
                onClick={() => {
                  toggleTheme()
                  setDark(isDark())
                }}
              >
                {dark ? <Sun /> : <MoonStar />}
              </Button>
            </div>
          </div>
          <p className="mt-3 flex items-baseline gap-2 text-title-2 text-ink-1">
            {loaded ? `נשארו ${remaining}` : "טוען…"}
            {loaded && done > 0 && <span className="text-label font-normal text-ink-2">טופלו {done}</span>}
          </p>
          {/* Fills as the session's decisions add up. */}
          <div aria-hidden className="mt-3 h-0.5 overflow-hidden rounded-full bg-line">
            <div
              className="h-full origin-right bg-hope transition-transform duration-500 ease-(--ease-out-soft) motion-reduce:transition-none"
              style={{ transform: `scaleX(${progress})` }}
            />
          </div>
          <div role="group" aria-label="סינון הרשימה" className="mt-4 mb-2 grid grid-cols-3 gap-1 rounded-xl bg-line p-1">
            {filters.map(([f, label, n]) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={cn(
                  "pressable min-h-10 rounded-lg text-label outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
                  filter === f ? "bg-surface text-ink-1 shadow-chip" : "text-ink-2 hover:text-ink-1",
                )}
              >
                {label} {loaded && <span className="tabular-nums opacity-60">{n}</span>}
              </button>
            ))}
          </div>
        </div>

        <nav aria-label="מה ממתין" className="px-2 pb-4 sm:px-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain">
          <div className="flex flex-col gap-2 px-2 pt-2 empty:hidden">
            {queueError && <Alert>{queueError}</Alert>}
            {attention.error && (
              // Whatever was already shown stays: a moment without the server is not an empty list.
              <Alert>הפעולות שדורשות תשומת לב לא נטענו. {attention.error}</Alert>
            )}
            {attention.failed === "refresh" && (
              <Button
                variant="ghost"
                className="pressable -ms-3 self-start"
                disabled={attention.busy}
                onClick={() => void attention.refresh()}
              >
                <RotateCcw aria-hidden />
                לנסות שוב לטעון את הפעולות
              </Button>
            )}
            {reports.error && <Alert>הבקשות לא נטענו. {reports.error}</Alert>}
            {reports.failed === "refresh" && (
              <Button variant="ghost" className="pressable -ms-3 self-start" disabled={reports.busy} onClick={() => void reports.refresh()}>
                <RotateCcw aria-hidden />
                לנסות שוב לטעון את הבקשות
              </Button>
            )}
          </div>

          {!loaded && !queueError && !reports.error && (
            <div aria-hidden className="flex flex-col gap-2 px-3 pt-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="py-2">
                  <Skeleton className="h-4 w-48 rounded-full bg-surface-3" />
                  <Skeleton className="mt-2 h-3.5 w-32 rounded-full bg-surface-3" />
                </div>
              ))}
            </div>
          )}

          {showReports && (hot.length > 0 || ops.length > 0) && (
            <Group title="דחוף" n={hot.length + ops.length} hot>
              {hot.map((r) => (
                <Row
                  key={r.id}
                  sel={{ kind: "report", id: r.id }}
                  current={same(shown, { kind: "report", id: r.id })}
                  title={
                    <>
                      <span className="sr-only">בקשה על </span>
                      {reportName(r)}
                    </>
                  }
                  meta={reportMeta(r)}
                  age={receivedAt(r)}
                  hot
                  onSelect={() => select({ kind: "report", id: r.id })}
                />
              ))}
            </Group>
          )}
          {showReports && ops.length > 0 && (
            <ul aria-label="דורש תשומת לב" className="mx-1 mt-1 flex flex-col">
              {ops.map((a) => (
                <li key={a.id} className="grid grid-cols-[0.5rem_minmax(0,1fr)] gap-x-3 rounded-xl px-3 py-2.5 text-caption text-ink-1">
                  <span aria-hidden className="mt-1.5 size-2 rounded-full bg-dawn" />
                  <span>
                    {PROBLEM[a.problem]}
                    <span className="block text-ink-3" dir="ltr">
                      {a.place_id}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {showReports && attention.next && (
            <Button variant="ghost" className="pressable ms-1" disabled={attention.busy} onClick={() => void attention.more()}>
              פעולות נוספות שדורשות תשומת לב
            </Button>
          )}
          {showReports && rest.length > 0 && (
            <Group title="בקשות" n={rest.length}>
              {rest.map((r) => (
                <Row
                  key={r.id}
                  sel={{ kind: "report", id: r.id }}
                  current={same(shown, { kind: "report", id: r.id })}
                  title={
                    <>
                      <span className="sr-only">בקשה על </span>
                      {reportName(r)}
                    </>
                  }
                  meta={reportMeta(r)}
                  age={receivedAt(r)}
                  onSelect={() => select({ kind: "report", id: r.id })}
                />
              ))}
            </Group>
          )}
          {showReports && reports.next && (
            <Button variant="ghost" className="pressable ms-1" disabled={reports.busy} onClick={() => void reports.more()}>
              בקשות ישנות יותר
            </Button>
          )}
          {showProposals && proposals.length > 0 && (
            <Group title="הצעות" n={proposals.length}>
              {proposals.map((i) => (
                <Row
                  key={i.id}
                  sel={{ kind: "proposal", id: i.id }}
                  current={same(shown, { kind: "proposal", id: i.id })}
                  title={i.name_he}
                  meta={
                    <>
                      {proposalMeta(i)}
                      {overdue(i) && <span className="text-brand"> · ממתינה יותר משבועיים</span>}
                    </>
                  }
                  age={waited(i)}
                  onSelect={() => select({ kind: "proposal", id: i.id })}
                />
              ))}
            </Group>
          )}
          {loaded && !order.length && !ops.length && (
            <p className="px-3 pt-6 text-body text-ink-2">
              {filter === "proposals" ? "אין הצעות ממתינות." : filter === "reports" ? "אין בקשות פתוחות." : "אין כלום בתור."}
            </p>
          )}
        </nav>

        {!wide && (
          <div id="overview" className="border-t border-line bg-surface">
            {overview}
          </div>
        )}

        <p className="hidden border-t border-line px-5 py-3 text-caption text-ink-3 pointer-fine:block">
          <kbd className="inline-grid h-5 min-w-5 place-items-center rounded-md border border-current px-1 font-sans">?</kbd> לקיצורי מקלדת
        </p>
      </div>

      {/* The chosen item. On a phone it slides in over the list from the reading side's end. */}
      <div
        ref={detail}
        className={cn(
          "min-w-0 overflow-y-auto bg-surface lg:h-full",
          "motion-reduce:transition-none max-lg:fixed max-lg:inset-0 max-lg:z-30 max-lg:transition-[transform,visibility] max-lg:duration-300 max-lg:ease-(--ease-out-soft)",
          layer ? "max-lg:translate-x-0" : "max-lg:invisible max-lg:-translate-x-full",
        )}
      >
        <div className="sticky top-0 z-20 flex min-h-14 items-center border-b border-line bg-glass px-2 pt-[env(safe-area-inset-top)] lg:hidden">
          <Button variant="ghost" className="pressable" onClick={() => setLayer(false)}>
            <ArrowRight aria-hidden />
            לרשימה
          </Button>
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={shown ? `${shown.kind}-${shown.id}` : "overview"}
            className="flex min-h-full flex-col"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.22, ease } }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
          >
            {report ? (
              <ReportDetail report={report} reload={loadReports} fail={setReportError} error={reportError} />
            ) : proposal ? (
              <ProposalDetail item={proposal} busy={busy === proposal.id} decide={decide} />
            ) : (
              wide && overview
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* What a decision did, said once: polite, so it never interrupts, and not a status role (the import has the one). */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4 lg:start-96">
        <AnimatePresence>
          {said && (
            <motion.p
              key={said.n}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.24, ease } }}
              exit={{ opacity: 0, transition: { duration: 0.18 } }}
              className="flex items-center gap-2.5 rounded-xl bg-ink-1 px-4 py-2.5 text-body text-surface shadow-float"
            >
              <CircleCheck aria-hidden className="size-4 text-hope" />
              {said.text}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <Shortcuts open={keysOpen} onOpenChange={setKeysOpen} />
    </div>
  )
}
