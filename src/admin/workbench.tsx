import { useRef, useState, type ReactNode } from "react"
import { AnimatePresence, motion } from "motion/react"
import { AnemoneMark } from "@/components/anemone"
import { ease } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { isDark, toggleTheme } from "./theme"
import type { GlyphName } from "./glyphs"
import { PROBLEM } from "./problems"
import { Btn } from "./controls"
import { ago, elementsOf, overdue, reportName, same, useInbox, type Filter, type Inbox, type Selection } from "./inbox-state"
import { Alert, Chip, Glyph, Guide, Kbd, kindGlyph, kindLabel, meta, Scene, Toast, today, useMinute } from "./parts"
import { Checks, Decision, ProposalBody, ProposalMap } from "./proposal"
import { ReportActions, ReportBody, useReportTools } from "./report"
import { CuratedImport, PlaceLookup, Shortcuts, SystemStatus, useKeys, useSummary } from "./tools"
import type { Report } from "./api"

/**
 * Direction A, the workbench: everything that waits in one list beside the item it opens, the day's numbers above
 * it, and the tools a rail away. Built for reading straight through at a desk; on a phone the item is a layer.
 */
type View = "queue" | "lookup" | "import" | "status"
const NAV: { view: View; glyph: GlyphName; label: string }[] = [
  { view: "queue", glyph: "queue", label: "לבדיקה" },
  { view: "lookup", glyph: "link", label: "חיפוש מקום" },
  { view: "import", glyph: "import", label: "יבוא מקומות" },
  { view: "status", glyph: "pulse", label: "תקינות האתר" },
]
const rowId = (s: Selection) => `row-${s.kind}-${s.id}`

export function Workbench() {
  const inbox = useInbox()
  const status = useSummary()
  const [view, setView] = useState<View>("queue")
  const [layer, setLayer] = useState(false)
  const [keysOpen, setKeysOpen] = useState(false)
  const [dark, setDark] = useState(isDark)
  // A place a stuck removal named, opened in the lookup so the moderator can hide it again.
  const [lookup, setLookup] = useState("")
  const detail = useRef<HTMLDivElement>(null)
  useMinute()

  const open = (s: Selection | null) => {
    inbox.select(s)
    setView("queue")
    setLayer(!!s)
    detail.current?.scrollTo({ top: 0 })
  }
  const move = (by: 1 | -1) => {
    const next = inbox.step(by)
    if (!next) return
    setView("queue")
    setLayer(true)
    detail.current?.scrollTo({ top: 0 })
    document.getElementById(rowId(next))?.scrollIntoView({ block: "nearest" })
  }
  const press = (action: string) => detail.current?.querySelector<HTMLButtonElement>(`[data-shortcut="${action}"]:not(:disabled)`)?.click()
  useKeys({
    next: () => move(1),
    prev: () => move(-1),
    approve: () => inbox.proposal && press("approve"),
    return: () => inbox.proposal && press("return"),
    reject: () => inbox.proposal && press("reject"),
    escape: () => setLayer(false),
    help: () => setKeysOpen(true),
  })

  const overdueCount = inbox.proposals.filter(overdue).length
  const go = (v: View) => {
    setView(v)
    if (v !== "queue") setLayer(true)
    else setLayer(!!inbox.shown)
  }

  return (
    <div className="grid h-dvh grid-cols-1 lg:grid-cols-[4.5rem_23.5rem_minmax(0,1fr)]">
      <h1 className="sr-only">ניהול · מקום לזכור</h1>
      {/* The rail */}
      <nav aria-label="אזורים" className="hidden flex-col items-center gap-1.5 border-e border-(--a-line) bg-(--a-panel-2) py-4 lg:flex">
        <a
          href="/"
          className="a-focus-ring mb-4 grid size-11 place-items-center rounded-2xl [--mark-ground:var(--a-panel-2)]"
          aria-label="מקום לזכור, לאתר"
        >
          <AnemoneMark size={30} />
        </a>
        {NAV.map((n) => (
          <RailButton
            key={n.view}
            on={view === n.view}
            label={n.label}
            glyph={n.glyph}
            onClick={() => go(n.view)}
            badge={n.view === "queue" && inbox.loaded ? inbox.remaining : 0}
          />
        ))}
        <span className="flex-1" />
        <RailButton label="קיצורי מקלדת" glyph="key" onClick={() => setKeysOpen(true)} />
        <RailButton
          label={dark ? "מצב בהיר" : "מצב כהה"}
          glyph={dark ? "sun" : "moon"}
          onClick={() => {
            toggleTheme()
            setDark(isDark())
          }}
        />
      </nav>

      {/* The list */}
      <aside className="flex min-h-0 flex-col border-e border-(--a-line) bg-(--a-panel-2) max-lg:pb-16">
        <ListHead inbox={inbox} overdue={overdueCount} dark={dark} setDark={setDark} />
        <QueueList
          inbox={inbox}
          current={view === "queue" ? inbox.shown : null}
          open={open}
          openPlace={(id) => {
            setLookup(id)
            go("lookup")
          }}
        />
        <p className="hidden items-center gap-3 border-t border-(--a-line) px-5 py-3 text-[0.8125rem] text-(--a-ink-3) pointer-fine:flex">
          <span className="flex items-center gap-1">
            <Kbd className="pointer-fine:inline-grid">J</Kbd>
            <Kbd className="pointer-fine:inline-grid">K</Kbd> מעבר בין פריטים
          </span>
          <span className="flex items-center gap-1">
            <Kbd className="pointer-fine:inline-grid">?</Kbd> כל קיצורי המקלדת
          </span>
        </p>
      </aside>

      {/* The item, or a tool. On a phone it slides in over the list from the reading side's end. */}
      <main
        ref={detail}
        className={cn(
          "min-w-0 overflow-y-auto bg-(--a-panel) lg:h-dvh",
          "motion-reduce:transition-none max-lg:fixed max-lg:inset-0 max-lg:z-30 max-lg:transition-[transform,visibility] max-lg:duration-300 max-lg:ease-[cubic-bezier(0.22,1,0.36,1)]",
          layer ? "max-lg:translate-x-0" : "max-lg:invisible max-lg:-translate-x-full",
        )}
      >
        <div className="sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b border-(--a-line) bg-(--a-panel)/92 px-3 pt-[env(safe-area-inset-top)] backdrop-blur-md lg:px-8">
          <Btn variant="ghost" size="sm" className="lg:hidden" onClick={() => setLayer(false)}>
            <Glyph name="arrow" />
            לרשימה
          </Btn>
          {view === "queue" && inbox.shown && (
            <>
              <p className="text-[0.875rem] text-(--a-ink-3) max-lg:hidden">
                {inbox.shown.kind === "report" ? "בקשת הסרה" : "הצעת מקום"} ·{" "}
                <b className="font-semibold text-(--a-ink-1) tabular-nums">{inbox.position + 1}</b> מתוך{" "}
                <span className="tabular-nums">{inbox.order.length}</span>
              </p>
              <span className="flex-1" />
              <Btn variant="ghost" size="sm" aria-label="הפריט הקודם" onClick={() => move(-1)} disabled={inbox.position <= 0}>
                <Glyph name="arrow" className="size-3.5" />
                <Kbd>K</Kbd>
              </Btn>
              <Btn
                variant="ghost"
                size="sm"
                aria-label="הפריט הבא"
                onClick={() => move(1)}
                disabled={inbox.position >= inbox.order.length - 1}
              >
                <Kbd>J</Kbd>
                <Glyph name="arrow" flip className="size-3.5" />
              </Btn>
            </>
          )}
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view === "queue" ? (inbox.shown ? `${inbox.shown.kind}-${inbox.shown.id}` : "overview") : view}
            className="flex min-h-[calc(100%-3.5rem)] flex-col"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.24, ease } }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
          >
            {view === "lookup" ? (
              <ToolPage guide="lookup">
                <PlaceLookup key={lookup} initial={lookup} />
              </ToolPage>
            ) : view === "import" ? (
              <ToolPage guide="import">
                <CuratedImport />
              </ToolPage>
            ) : view === "status" ? (
              <ToolPage guide="status">
                <SystemStatus status={status} />
              </ToolPage>
            ) : inbox.report ? (
              <ReportPane report={inbox.report} inbox={inbox} />
            ) : inbox.proposal ? (
              <article aria-label={inbox.proposal.name_he} className="flex flex-1 flex-col">
                <ScreenGuide screen="proposal" className="mx-auto mt-6 w-[calc(100%-2rem)] max-w-[66rem] sm:w-[calc(100%-4rem)]" />
                <div className="mx-auto grid w-full max-w-[66rem] flex-1 gap-8 px-4 pt-7 pb-10 sm:px-8 xl:grid-cols-[minmax(0,1fr)_19.5rem]">
                  <ProposalBody item={inbox.proposal} />
                  <div className="flex flex-col gap-3">
                    <Checks item={inbox.proposal} />
                    <ProposalMap item={inbox.proposal} />
                  </div>
                </div>
                <Bar next={nextName(inbox)}>
                  <Decision key={inbox.proposal.id} item={inbox.proposal} busy={inbox.busy === inbox.proposal.id} decide={inbox.decide} />
                </Bar>
              </article>
            ) : (
              <Overview inbox={inbox} start={() => inbox.order[0] && open(inbox.order[0])} />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* A phone's way between the areas. */}
      <nav
        aria-label="אזורים"
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-(--a-line) bg-(--a-panel)/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md transition-transform duration-300 lg:hidden",
          layer && view === "queue" && "translate-y-full",
        )}
      >
        {NAV.map((n) => (
          <button
            key={n.view}
            type="button"
            aria-current={view === n.view || undefined}
            onClick={() => (n.view === "queue" ? (setView("queue"), setLayer(false)) : go(n.view))}
            className={cn(
              "a-focus-ring flex h-16 flex-col items-center justify-center gap-1 text-[0.75rem] font-medium",
              view === n.view ? "text-(--a-ink-1)" : "text-(--a-ink-3)",
            )}
          >
            <Glyph name={n.glyph} className="size-5" />
            {n.label}
          </button>
        ))}
      </nav>

      <Toast said={inbox.said} className="lg:start-[28rem]" />
      <Shortcuts open={keysOpen} onOpenChange={setKeysOpen} />
    </div>
  )
}

const nextName = (inbox: Inbox) => {
  const n = inbox.order[inbox.position + 1]
  if (!n) return null
  return n.kind === "proposal"
    ? inbox.proposals.find((p) => p.id === n.id)?.name_he
    : reportName(inbox.hot.concat(inbox.rest).find((r) => r.id === n.id)!)
}

function RailButton({
  label,
  glyph,
  on,
  badge,
  onClick,
}: {
  label: string
  glyph: GlyphName
  on?: boolean
  badge?: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-current={on || undefined}
      onClick={onClick}
      className={cn(
        "a-focus-ring pressable relative grid size-11 place-items-center rounded-xl transition-colors",
        on ? "bg-(--a-panel) text-(--a-ink-1) shadow-(--a-shadow)" : "text-(--a-ink-3) hover:bg-(--a-sunk) hover:text-(--a-ink-1)",
      )}
    >
      <Glyph name={glyph} className="size-5" />
      {!!badge && (
        <span
          aria-hidden
          className="absolute -end-0.5 -top-0.5 grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full bg-(--a-red) px-1 text-[0.6875rem] font-bold text-(--a-on-solid) tabular-nums"
        >
          {badge}
        </span>
      )}
    </button>
  )
}

export function ListHead({
  inbox,
  overdue,
  dark,
  setDark,
}: {
  inbox: Inbox
  overdue: number
  dark: boolean
  setDark: (d: boolean) => void
}) {
  const filters: [Filter, string, number][] = [
    ["all", "הכול", inbox.remaining],
    ["reports", "בקשות הסרה", inbox.openReports + inbox.ops.length],
    ["proposals", "הצעות מקומות", inbox.proposals.length],
  ]
  const kpis: { n: number; label: string; tone?: string }[] = [
    { n: inbox.hot.length + inbox.ops.length, label: "דחוף", tone: "text-(--a-red)" },
    { n: inbox.remaining, label: "ממתינים" },
    { n: overdue, label: "ממתינים מעל שבועיים", tone: "text-(--a-sun)" },
  ]
  return (
    <div className="a-contours px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3 sm:px-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[0.8125rem] font-medium text-(--a-ink-3)">{today()}</p>
          <p className="mt-0.5 flex items-baseline gap-2.5 text-[1.5rem] leading-tight font-bold text-(--a-ink-1)">
            מה מחכה לבדיקה
            {inbox.done > 0 && (
              <span className="text-[0.8125rem] font-medium text-(--a-green-ink) tabular-nums">טיפלתם היום ב־{inbox.done}</span>
            )}
          </p>
        </div>
        <Btn
          variant="ghost"
          size="sm"
          className="lg:hidden"
          aria-label={dark ? "מצב בהיר" : "מצב כהה"}
          onClick={() => {
            toggleTheme()
            setDark(isDark())
          }}
        >
          <Glyph name={dark ? "sun" : "moon"} />
        </Btn>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-2xl border border-(--a-line) bg-(--a-panel) px-3 py-2.5">
            <dd className={cn("text-[1.375rem] leading-none font-bold tabular-nums", k.n ? k.tone : "text-(--a-ink-1)")}>
              {inbox.loaded ? k.n : "–"}
            </dd>
            <dt className="mt-1 text-[0.75rem] font-medium text-(--a-ink-3)">{k.label}</dt>
          </div>
        ))}
      </dl>
      <div role="group" aria-label="סינון הרשימה" className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-(--a-sunk) p-1">
        {filters.map(([f, label, n]) => (
          <button
            key={f}
            type="button"
            aria-pressed={inbox.filter === f}
            onClick={() => inbox.setFilter(f)}
            className={cn(
              "a-focus-ring pressable min-h-9 rounded-lg text-[0.875rem] font-semibold transition-colors",
              inbox.filter === f ? "bg-(--a-panel) text-(--a-ink-1) shadow-(--a-shadow)" : "text-(--a-ink-2) hover:text-(--a-ink-1)",
            )}
          >
            {label} {inbox.loaded && <span className="ms-0.5 font-medium tabular-nums opacity-55">{n}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

export function QueueList({
  inbox,
  current,
  open,
  openPlace,
}: {
  inbox: Inbox
  current: Selection | null
  open: (s: Selection) => void
  openPlace: (id: string) => void
}) {
  const { reports, attention, hot, rest, proposals, ops, filter, loaded } = inbox
  const showReports = filter !== "proposals"
  const showProposals = filter !== "reports"
  const reportRow = (r: Report, hotRow?: boolean) => (
    <Row
      key={r.id}
      sel={{ kind: "report", id: r.id }}
      current={same(current, { kind: "report", id: r.id })}
      glyph={hotRow ? "hide" : "mail"}
      hot={hotRow}
      title={
        <>
          <span className="sr-only">בקשה על </span>
          {reportName(r)}
        </>
      }
      age={ago(r.received_at)}
      meta={
        <>
          {elementsOf(r).join(", ")}
          {r.status === "in_review" && (
            <Chip tone="sun" className="h-5 px-2 text-[0.6875rem]">
              בטיפול
            </Chip>
          )}
        </>
      }
      onSelect={() => open({ kind: "report", id: r.id })}
    />
  )
  return (
    <nav aria-label="מה ממתין" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 pb-4">
      {/* On a phone the list is the first screen; at a desk the overview beside it carries these lines. */}
      <ScreenGuide screen="queue" className="mx-1.5 mt-1 mb-2 lg:hidden" />
      <div className="flex flex-col gap-2 px-1.5 pt-1 empty:hidden">
        {inbox.queueError && <Alert>{inbox.queueError}</Alert>}
        {attention.error && <Alert>רשימת הפעולות שלא הושלמו לא נטענה. {attention.error}</Alert>}
        {attention.failed === "refresh" && (
          <Btn variant="ghost" size="sm" className="self-start" disabled={attention.busy} onClick={() => void attention.refresh()}>
            <Glyph name="restore" className="size-3.5" />
            לנסות שוב לטעון את הרשימה
          </Btn>
        )}
        {reports.error && <Alert>בקשות ההסרה לא נטענו. {reports.error}</Alert>}
        {reports.failed === "refresh" && (
          <Btn variant="ghost" size="sm" className="self-start" disabled={reports.busy} onClick={() => void reports.refresh()}>
            <Glyph name="restore" className="size-3.5" />
            לנסות שוב לטעון את בקשות ההסרה
          </Btn>
        )}
      </div>

      {!loaded && !inbox.failed && (
        <div aria-hidden className="flex flex-col gap-1 pt-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-3 px-2.5 py-2.5">
              <div className="size-9 animate-pulse rounded-xl bg-(--a-sunk)" />
              <div className="flex-1">
                <div className="h-3.5 w-3/5 animate-pulse rounded-full bg-(--a-sunk)" />
                <div className="mt-2 h-3 w-2/5 animate-pulse rounded-full bg-(--a-sunk)" />
              </div>
            </div>
          ))}
        </div>
      )}

      {showReports && (hot.length > 0 || ops.length > 0) && (
        <Group title="דחוף: הוסתר מהאתר עד שתחליטו" n={hot.length + ops.length} hot>
          {hot.map((r) => reportRow(r, true))}
        </Group>
      )}
      {showReports && ops.length > 0 && (
        <ul aria-label="פעולות שלא הושלמו" className="mt-1 flex flex-col gap-1 px-1">
          {ops.map((a) => (
            <li
              key={a.id}
              className="flex gap-3 rounded-xl border border-dashed border-(--a-sun)/40 bg-(--a-sun-soft) px-3 py-2.5 text-[0.8125rem] text-(--a-ink-1)"
            >
              <Glyph name="clock" className="mt-0.5 size-4 text-(--a-sun)" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-semibold">{PROBLEM[a.problem].title}</span>
                <span className="text-(--a-ink-2)">{PROBLEM[a.problem].detail}</span>
                <span className="text-(--a-ink-3)">
                  מזהה המקום: <span dir="ltr">{a.place_id}</span>
                </span>
                {PROBLEM[a.problem].redo && (
                  <Btn size="sm" className="mt-1 self-start" onClick={() => openPlace(a.place_id)}>
                    <Glyph name="search" className="size-3.5" />
                    פתיחת המקום
                  </Btn>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {showReports && attention.next && (
        <Btn variant="ghost" size="sm" className="mt-1" disabled={attention.busy} onClick={() => void attention.more()}>
          להציג עוד פעולות שלא הושלמו
        </Btn>
      )}
      {showReports && rest.length > 0 && (
        <Group title="בקשות הסרה ותיקון" n={rest.length}>
          {rest.map((r) => reportRow(r))}
        </Group>
      )}
      {showReports && reports.next && (
        <Btn variant="ghost" size="sm" className="mt-1" disabled={reports.busy} onClick={() => void reports.more()}>
          להציג בקשות ישנות יותר
        </Btn>
      )}
      {showProposals && proposals.length > 0 && (
        <Group title="הצעות מקומות, מהוותיקה לחדשה" n={proposals.length}>
          {proposals.map((i) => (
            <Row
              key={i.id}
              sel={{ kind: "proposal", id: i.id }}
              current={same(current, { kind: "proposal", id: i.id })}
              glyph={kindGlyph(i.kind)}
              title={i.name_he}
              age={ago(i.created_at)}
              meta={
                <>
                  {meta([kindLabel(i.kind), i.place_he])}
                  {overdue(i) && (
                    <Chip tone="sun" className="h-5 px-2 text-[0.6875rem]">
                      ממתינה מעל שבועיים
                    </Chip>
                  )}
                  {!!i.correction && <Chip className="h-5 px-2 text-[0.6875rem]">תיקון למקום קיים</Chip>}
                  {!!i.on_private_property && <Chip className="h-5 px-2 text-[0.6875rem]">בשטח פרטי</Chip>}
                </>
              }
              onSelect={() => open({ kind: "proposal", id: i.id })}
            />
          ))}
        </Group>
      )}
      {loaded && !inbox.order.length && !ops.length && (
        <p className="px-3 pt-8 text-center text-[0.9375rem] text-(--a-ink-2)">
          {filter === "proposals"
            ? "אין הצעות מקומות שממתינות. הצעה חדשה תופיע כאן."
            : filter === "reports"
              ? "אין בקשות הסרה פתוחות. בקשה חדשה תופיע כאן."
              : "אין מה לבדוק כרגע. כל דבר חדש יופיע כאן."}
        </p>
      )}
    </nav>
  )
}

function Group({ title, n, hot, children }: { title: string; n: number; hot?: boolean; children: ReactNode }) {
  return (
    <section aria-label={title} className="mt-4">
      <h2 className={cn("mb-1.5 flex items-center gap-2 px-2.5 text-[0.75rem] font-bold", hot ? "text-(--a-red)" : "text-(--a-ink-3)")}>
        {title}
        <span className="font-medium tabular-nums opacity-70">{n}</span>
        <span aria-hidden className="h-px flex-1 bg-(--a-line)" />
      </h2>
      <ul className="flex flex-col gap-0.5">
        <AnimatePresence initial={false}>{children}</AnimatePresence>
      </ul>
    </section>
  )
}

function Row({
  sel,
  current,
  glyph,
  title,
  meta: line,
  age,
  hot,
  onSelect,
}: {
  sel: Selection
  current: boolean
  glyph: GlyphName
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
      exit={{ opacity: 0, x: -24, transition: { duration: 0.2, ease } }}
      transition={{ duration: 0.24, ease }}
    >
      <button
        id={id}
        type="button"
        aria-labelledby={`${id}-t`}
        aria-describedby={`${id}-m`}
        aria-current={current || undefined}
        onClick={onSelect}
        className={cn(
          "a-focus-ring pressable relative grid w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-xl px-2.5 py-2.5 text-start transition-colors",
          current ? "bg-(--a-panel) shadow-(--a-shadow)" : "hover:bg-(--a-sunk)/70",
        )}
      >
        {current && (
          <motion.span layoutId="row-mark" aria-hidden className="absolute inset-y-2.5 start-0 w-[3px] rounded-full bg-(--a-ink-1)" />
        )}
        <span
          aria-hidden
          className={cn(
            "row-span-2 grid size-9 place-items-center rounded-xl border",
            hot ? "border-transparent bg-(--a-red-soft) text-(--a-red)" : "border-(--a-line) bg-(--a-panel) text-(--a-ink-2)",
          )}
        >
          <Glyph name={glyph} className="size-[1.125rem]" />
        </span>
        <span id={`${id}-t`} className="truncate text-[0.9375rem] font-semibold text-(--a-ink-1)">
          {title}
        </span>
        <span className="text-[0.75rem] whitespace-nowrap text-(--a-ink-3) tabular-nums">{age}</span>
        <span id={`${id}-m`} className="col-span-2 col-start-2 flex items-center gap-1.5 truncate text-[0.8125rem] text-(--a-ink-2)">
          {line}
        </span>
      </button>
    </motion.li>
  )
}

function Bar({ children, next }: { children: ReactNode; next?: string | null }) {
  return (
    <div className="sticky bottom-0 z-10 mt-auto border-t border-(--a-line) bg-(--a-panel)/92 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md max-lg:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto flex w-full max-w-[66rem] items-center gap-4 px-4 pt-3 sm:px-8">
        <div className="min-w-0 flex-1">{children}</div>
        {next && (
          <p className="hidden max-w-56 truncate text-[0.8125rem] text-(--a-ink-3) xl:block">
            הבא: <b className="font-semibold text-(--a-ink-1)">{next}</b>
          </p>
        )}
      </div>
    </div>
  )
}

function ReportPane({ report, inbox }: { report: Report; inbox: Inbox }) {
  const tools = useReportTools(report, inbox.loadReports, inbox.say)
  return (
    <article aria-label={`בקשה על ${reportName(report)}`} className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-[46rem] flex-1 px-4 pt-6 pb-10 sm:px-8">
        <ScreenGuide screen="report" className="mb-7" />
        <ReportBody report={report} tools={tools} />
      </div>
      <Bar>
        <ReportActions report={report} tools={tools} />
      </Bar>
    </article>
  )
}

function ToolPage({ guide, children }: { guide: keyof typeof GUIDE; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[46rem] px-4 pt-6 pb-24 sm:px-8">
      <ScreenGuide screen={guide} className="mb-7" />
      {children}
    </div>
  )
}

/** Each screen's few lines: what it is for, what the moderator is expected to do, and in what order. */
const GUIDE = {
  queue: [
    "כאן כל מה שמחכה להחלטה שלכם.",
    "מתחילים מהדחופים (באדום): בקשות שבגללן הסתרנו משהו מהאתר. אחריהם בקשות הסרה אחרות, ובסוף הצעות מקומות, מהוותיקה לחדשה.",
  ],
  proposal: [
    "מישהו הציע מקום חדש או תיקון למקום קיים. קראו, עברו על «מה לבדוק לפני פרסום» ובדקו את המיקום במפה.",
    "הכול תקין: «פרסום באתר». צריך שינוי קטן: «החזרה לשולח לתיקון» עם הסבר. לא מתאים לאתר: «דחיית ההצעה». את התוכן עצמו לא עורכים כאן.",
  ],
  report: [
    "מישהו ביקש להסיר או לתקן משהו באתר. אם הבקשה הייתה מלאה, האתר כבר הסתיר את מה שביקשו עד שתחליטו.",
    "1. קראו מה ביקשו ולמה. 2. החליטו: להשאיר מוסתר, להחזיר לאתר, להסתיר עוד או למחוק. 3. כתבו למטה מה עשיתם ולחצו «רישום וסגירת הבקשה». עד שנרשם טיפול, נשלחת תזכורת במייל כל 6 שעות.",
  ],
  lookup: [
    "לבקשה שהגיעה במייל או בטלפון, לא דרך האתר.",
    "מדביקים את הקישור למקום, ואז מסתירים חלק ממנו (אפשר להחזיר אחר כך) או מוחקים אותו לצמיתות (אי אפשר לבטל).",
  ],
  import: [
    "רק למקומות שהאתר עצמו מוסיף, מקובץ שהוכן מראש עם מקורות ותמונות מורשות.",
    "בוחרים קובץ, עוברים על רשימת השמות ולוחצים פרסום. מקום שכבר קיים באתר לא ישתנה, אז מותר להריץ את אותו קובץ שוב.",
  ],
  status: [
    "תמונת מצב של האתר, רק מספרים: בלי תוכן, בלי מיילים ובלי שמות. כתום = כדאי לבדוק.",
    "אין כאן פעולות. אם משהו נשאר כתום יותר מיום, צריך בדיקה טכנית.",
  ],
}
const GUIDE_TITLE: Record<keyof typeof GUIDE, string> = {
  queue: "איך עובדים כאן",
  proposal: "איך מחליטים על הצעה",
  report: "איך מטפלים בבקשת הסרה",
  lookup: "מתי משתמשים בחיפוש מקום",
  import: "מתי משתמשים ביבוא",
  status: "מה רואים כאן",
}
function ScreenGuide({ screen, className }: { screen: keyof typeof GUIDE; className?: string }) {
  return (
    <Guide screen={screen} title={GUIDE_TITLE[screen]} className={className}>
      {GUIDE[screen].map((line) => (
        <p key={line}>{line}</p>
      ))}
    </Guide>
  )
}

function Overview({ inbox, start }: { inbox: Inbox; start: () => void }) {
  if (inbox.failed)
    return (
      <div className="grid flex-1 place-items-center px-6 py-16">
        <Scene kind="offline" title="לא הצלחנו להתחבר לאתר">
          <p>בדקו את החיבור לאינטרנט ולחצו «לנסות שוב». אם זה חוזר, רעננו את העמוד: ייתכן שצריך להתחבר מחדש.</p>
          <Btn variant="primary" className="mt-5" onClick={() => void inbox.reload()}>
            <Glyph name="restore" />
            לנסות שוב
          </Btn>
        </Scene>
      </div>
    )
  if (!inbox.loaded)
    return (
      <div aria-hidden className="mx-auto w-full max-w-[46rem] px-8 pt-16">
        <div className="h-4 w-40 animate-pulse rounded-full bg-(--a-sunk)" />
        <div className="mt-4 h-9 w-72 animate-pulse rounded-full bg-(--a-sunk)" />
      </div>
    )
  if (!inbox.remaining)
    return (
      <div className="a-contours grid flex-1 place-items-center px-6 py-16">
        <Scene kind="done" title="הכול טופל">
          <p>אין בקשות ואין הצעות שמחכות לכם. כל דבר חדש יופיע ברשימה{inbox.done ? `. היום טיפלתם ב־${inbox.done}.` : "."}</p>
        </Scene>
      </div>
    )
  const parts = [
    inbox.hot.length && (inbox.hot.length === 1 ? "בקשה דחופה אחת" : `${inbox.hot.length} בקשות דחופות`),
    inbox.openReports && (inbox.openReports === 1 ? "בקשת הסרה אחת" : `${inbox.openReports} בקשות הסרה`),
    inbox.proposals.length && (inbox.proposals.length === 1 ? "הצעת מקום אחת" : `${inbox.proposals.length} הצעות מקומות`),
  ].filter(Boolean)
  return (
    <div className="a-contours flex flex-1 items-center">
      <div className="mx-auto w-full max-w-[46rem] px-6 py-16 sm:px-8">
        <ScreenGuide screen="queue" className="mb-10" />
        <p className="text-[0.875rem] font-medium text-(--a-ink-3)">{today()}</p>
        <h2 className="mt-1 text-[2.5rem] leading-[1.1] font-bold tracking-[-0.02em] text-(--a-ink-1)">
          {inbox.remaining === 1 ? (
            "דבר אחד ממתין לבדיקה"
          ) : (
            <>
              <span className="tabular-nums">{inbox.remaining}</span> ממתינים לבדיקה
            </>
          )}
        </h2>
        <p className="mt-3 max-w-[52ch] text-[1.0625rem] leading-relaxed text-(--a-ink-2)">
          {parts.join(", ")}.{" "}
          {inbox.hot.length
            ? "מתחילים מהדחופות: שם משהו כבר מוסתר מהאתר עד שתחליטו."
            : "את התוכן לא עורכים כאן: מפרסמים, מחזירים לשולח לתיקון, או דוחים."}
        </p>
        <Btn variant="primary" size="lg" className="mt-7" onClick={start}>
          להתחיל לבדוק
          <Glyph name="arrow" flip />
        </Btn>
      </div>
    </div>
  )
}
