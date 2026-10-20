import { useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "motion/react"
import { AnemoneMark } from "@/components/anemone"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { ease, spring } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { isDark, toggleTheme } from "../theme"
import type { GlyphName } from "../glyphs"
import type { Action, Item, Report } from "./api"
import { Btn } from "./controls"
import { reportName, urgent, useInbox, type Inbox, type Selection } from "./inbox-state"
import { Chip, Glyph, Kbd, KindArt, Scene, Toast, today, useMinute } from "./parts"
import { Checks, Decision, ProposalBody, ProposalMap } from "./proposal"
import { ReportActions, ReportBody, useReportTools } from "./report"
import { CuratedImport, PlaceLookup, Shortcuts, SystemStatus, useKeys, useSummary } from "./tools"
import { QueueList } from "./workbench"
import { samplePacket } from "./sample-packet"

/**
 * Direction B, focus: one item at a time, large, as it would appear on the site, and three decisions at the bottom
 * of the screen. The list and the tools wait in drawers. Built for clearing the queue, at a desk or on a phone.
 */
type Tool = "list" | "lookup" | "import" | "status" | null
const TOOLS: { tool: Exclude<Tool, null>; glyph: GlyphName; label: string; key?: string }[] = [
  { tool: "list", glyph: "menu", label: "הרשימה", key: "L" },
  { tool: "lookup", glyph: "link", label: "לפי קישור" },
  { tool: "import", glyph: "import", label: "יבוא" },
  { tool: "status", glyph: "pulse", label: "מצב המערכת" },
]
const greeting = () => {
  const h = Number(new Date().toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Jerusalem" }))
  return h < 5 ? "לילה טוב" : h < 12 ? "בוקר טוב" : h < 17 ? "צהריים טובים" : h < 21 ? "ערב טוב" : "לילה טוב"
}

// How a card leaves says what was done to it: approved rises away, returned slides back toward its sender, rejected sinks.
const LEAVE: Record<Action | "move", object> = {
  approve: { opacity: 0, y: -60, rotate: -1.5, scale: 0.97 },
  return: { opacity: 0, x: 90, rotate: 1.5 },
  reject: { opacity: 0, y: 50, scale: 0.94 },
  move: { opacity: 0, scale: 0.98 },
}

export function Focus({ sample }: { sample?: boolean }) {
  const inbox = useInbox()
  const status = useSummary()
  const [tool, setTool] = useState<Tool>(null)
  const [keysOpen, setKeysOpen] = useState(false)
  const [dark, setDark] = useState(isDark)
  const [leaving, setLeaving] = useState<Action | "move">("move")
  const stage = useRef<HTMLDivElement>(null)
  useMinute()

  const open = (s: Selection | null) => {
    setLeaving("move")
    inbox.select(s)
    setTool(null)
    window.scrollTo({ top: 0 })
  }
  const move = (by: 1 | -1) => {
    setLeaving("move")
    if (inbox.step(by)) window.scrollTo({ top: 0 })
  }
  const decide = async (item: Item, action: Action, note?: string) => {
    setLeaving(action)
    await inbox.decide(item, action, note)
    window.scrollTo({ top: 0 })
  }
  const press = (action: string) => stage.current?.querySelector<HTMLButtonElement>(`[data-shortcut="${action}"]:not(:disabled)`)?.click()
  useKeys({
    next: () => (inbox.shown ? move(1) : inbox.order[0] && open(inbox.order[0])),
    prev: () => move(-1),
    approve: () => inbox.proposal && press("approve"),
    return: () => inbox.proposal && press("return"),
    reject: () => inbox.proposal && press("reject"),
    list: () => setTool("list"),
    escape: () => inbox.shown && open(null),
    help: () => setKeysOpen(true),
  })

  const key = inbox.shown
    ? `${inbox.shown.kind}-${inbox.shown.id}`
    : inbox.failed
      ? "offline"
      : !inbox.loaded
        ? "loading"
        : inbox.remaining
          ? "start"
          : "done"

  return (
    <div className="a-contours min-h-dvh">
      <h1 className="sr-only">ניהול · מקום לזכור</h1>
      <header className="sticky top-0 z-30 border-b border-transparent bg-(--a-bg)/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[76rem] items-center gap-3 px-3 sm:gap-5 sm:px-6">
          <button
            type="button"
            onClick={() => open(null)}
            className="a-focus-ring flex items-center gap-2.5 rounded-xl py-1 [--mark-ground:var(--a-bg)]"
          >
            <AnemoneMark size={28} />
            <span className="text-[1rem] font-bold text-(--a-ink-1) max-sm:sr-only">תור המנהלים</span>
          </button>
          <Progress inbox={inbox} />
          <nav aria-label="כלים" className="flex items-center gap-1">
            {TOOLS.map((t) => (
              <Btn
                key={t.tool}
                variant={t.tool === "list" ? "outline" : "ghost"}
                size="sm"
                aria-label={t.label}
                title={t.label}
                onClick={() => setTool(t.tool)}
                className={cn(t.tool !== "list" && "w-9 px-0", t.tool === "list" && "max-sm:w-9 max-sm:px-0")}
              >
                <Glyph name={t.glyph} />
                {t.tool === "list" && (
                  <>
                    <span className="max-sm:sr-only">הרשימה</span>
                    <Kbd>L</Kbd>
                  </>
                )}
              </Btn>
            ))}
            <Btn variant="ghost" size="sm" className="w-9 px-0 max-sm:hidden" aria-label="קיצורי מקלדת" onClick={() => setKeysOpen(true)}>
              <Glyph name="key" />
            </Btn>
            <Btn
              variant="ghost"
              size="sm"
              className="w-9 px-0"
              aria-label={dark ? "מצב בהיר" : "מצב כהה"}
              onClick={() => {
                toggleTheme()
                setDark(isDark())
              }}
            >
              <Glyph name={dark ? "sun" : "moon"} />
            </Btn>
          </nav>
        </div>
      </header>

      <div ref={stage} className="mx-auto max-w-[76rem] px-3 pt-4 pb-40 sm:px-6 sm:pt-8">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={key}
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, x: 0, rotate: 0, scale: 1, transition: { ...spring.soft } }}
            exit={{ ...LEAVE[leaving], transition: { duration: 0.32, ease } }}
          >
            {inbox.report ? (
              <ReportStage report={inbox.report} inbox={inbox} />
            ) : inbox.proposal ? (
              <ProposalStage item={inbox.proposal} inbox={inbox} decide={decide} skip={() => move(1)} />
            ) : inbox.failed ? (
              <Center>
                <Scene kind="offline" title="אין חיבור לשרת">
                  <p>מה שכבר נטען נשמר. ננסה שוב כשתבקשו.</p>
                  <Btn variant="primary" className="mt-5" onClick={() => void inbox.reload()}>
                    <Glyph name="restore" />
                    לנסות שוב
                  </Btn>
                </Scene>
              </Center>
            ) : !inbox.loaded ? (
              <Center>
                <div aria-hidden className="h-[28rem] w-full max-w-[45rem] animate-pulse rounded-[1.75rem] bg-(--a-sunk)" />
              </Center>
            ) : inbox.remaining ? (
              <Start inbox={inbox} start={() => inbox.order[0] && open(inbox.order[0])} />
            ) : (
              <Center>
                <Scene kind="done" title="הכול טופל">
                  <p>אין בקשות ואין הצעות שמחכות{inbox.done ? `. טיפלתם היום ב־${inbox.done}, תודה.` : "."}</p>
                </Scene>
              </Center>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <Sheet open={!!tool} onOpenChange={(o) => !o && setTool(null)}>
        <SheetContent
          side="right"
          className="admin-next w-[min(26rem,100vw)] gap-0 border-(--a-line) bg-(--a-panel-2) p-0 font-admin sm:max-w-[26rem]"
        >
          <SheetHeader className="border-b border-(--a-line) px-5 pt-5 pb-3">
            <SheetTitle className="text-[1.125rem] font-bold text-(--a-ink-1)">{TOOLS.find((t) => t.tool === tool)?.label}</SheetTitle>
            <SheetDescription className="sr-only">
              {tool === "list" ? "כל מה שממתין, בסדר שבו עוברים עליו" : "כלי ניהול שאינם קשורים לפריט אחד"}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tool === "list" ? (
              <QueueList inbox={inbox} current={inbox.shown} open={open} />
            ) : (
              <div className="px-5 py-5 [&_h2]:sr-only">
                {tool === "lookup" && <PlaceLookup />}
                {tool === "import" && <CuratedImport sample={sample ? samplePacket : undefined} />}
                {tool === "status" && <SystemStatus status={status} />}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Toast said={inbox.said} className="top-20" />
      <Shortcuts open={keysOpen} onOpenChange={setKeysOpen} extra={[[["L"], "הרשימה המלאה"]]} />
    </div>
  )
}

/** The session at a glance: a segment per item in reading order, the urgent ones red, the ones done today green. */
function Progress({ inbox }: { inbox: Inbox }) {
  const reports = [...inbox.hot, ...inbox.rest]
  const segments = inbox.order.map((s) => ({
    s,
    hot: s.kind === "report" && urgent(reports.find((r) => r.id === s.id)!),
  }))
  const now = inbox.position
  return (
    <div className="min-w-0 flex-1 sm:mx-auto sm:max-w-[30rem]">
      <p className="mb-1.5 flex items-baseline justify-between gap-2 text-[0.75rem] text-(--a-ink-3) sm:text-[0.8125rem]">
        <span className="truncate">
          {inbox.shown ? (
            <>
              <span className="max-sm:hidden">{inbox.shown.kind === "report" ? "בקשה" : "הצעה"} </span>
              <b className="font-semibold text-(--a-ink-1) tabular-nums">{now + 1}</b>
              <span className="max-sm:hidden"> מתוך </span>
              <span className="sm:hidden">/</span>
              <span className="tabular-nums">{inbox.order.length}</span>
            </>
          ) : (
            <span className="max-sm:hidden">{today()}</span>
          )}
          {inbox.done > 0 && <span className="text-(--a-green-ink)"> · טופלו {inbox.done}</span>}
        </span>
        {inbox.loaded && <span className="whitespace-nowrap tabular-nums">נשארו {inbox.remaining}</span>}
      </p>
      <div aria-hidden className="flex h-1.5 gap-1">
        {Array.from({ length: Math.min(inbox.done, 12) }, (_, i) => (
          <span key={`d${i}`} className="flex-1 rounded-full bg-(--a-green)" />
        ))}
        {segments.map(({ s, hot }, i) => (
          <motion.span
            key={`${s.kind}-${s.id}`}
            layout
            className={cn("flex-1 rounded-full", i === now ? "bg-(--a-ink-1)" : hot ? "bg-(--a-red)" : "bg-(--a-line-2)")}
          />
        ))}
      </div>
    </div>
  )
}

function Center({ children }: { children: ReactNode }) {
  return <div className="grid min-h-[70dvh] place-items-center">{children}</div>
}

/** A card with two more under it, so the pile reads as a pile: what's left is felt, not only counted. */
function Deck({ children, depth }: { children: ReactNode; depth: number }) {
  return (
    <div className="relative">
      {depth > 1 && (
        <span
          aria-hidden
          className="absolute inset-x-10 -bottom-5 h-10 rounded-b-[1.75rem] border border-(--a-line) bg-(--a-panel) opacity-40"
        />
      )}
      {depth > 0 && (
        <span
          aria-hidden
          className="absolute inset-x-5 -bottom-2.5 h-10 rounded-b-[1.75rem] border border-(--a-line) bg-(--a-panel) opacity-70"
        />
      )}
      <div className="relative overflow-hidden rounded-[1.75rem] border border-(--a-line) bg-(--a-panel) shadow-(--a-shadow-lg)">
        {children}
      </div>
    </div>
  )
}

// Portaled to the body: inside the card's moving layer, a transform would turn "fixed" into "moves with the card".
function Dock({ children }: { children: ReactNode }) {
  return createPortal(
    <div data-dock className="fixed inset-x-0 bottom-0 z-20 flex justify-center px-0 pb-0 sm:bottom-5 sm:px-4">
      <div className="w-full max-w-[52rem] border-t border-(--a-line) bg-(--a-panel)/90 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-(--a-shadow-lg) backdrop-blur-xl sm:rounded-3xl sm:border sm:p-2.5">
        {children}
      </div>
    </div>,
    document.body,
  )
}

function ProposalStage({ item, inbox, decide, skip }: { item: Item; inbox: Inbox; decide: typeof inbox.decide; skip: () => void }) {
  const left = inbox.order.length - inbox.position - 1
  return (
    <article aria-label={item.name_he} className="grid items-start gap-6 lg:grid-cols-[minmax(0,45rem)_20rem] lg:justify-center">
      <Deck depth={left}>
        {item.photo_url ? (
          <div className="relative">
            <img src={item.photo_url} alt={item.photo_alt ?? ""} className="aspect-[16/8] w-full bg-(--a-sunk) object-cover" />
            <span className="absolute start-3 top-3 rounded-full bg-black/55 px-3 py-1 text-[0.75rem] font-semibold text-white backdrop-blur-sm">
              ככה זה ייראה באתר
            </span>
          </div>
        ) : (
          <div className="a-contours grid h-36 place-items-center border-b border-(--a-line) bg-(--a-panel-2) [--a-contour-opacity:0.18]">
            <KindArt kind={item.kind} className="size-28 text-(--a-ink-1)" />
          </div>
        )}
        <div className="px-5 pt-5 pb-7 sm:px-8">
          <ProposalBody item={{ ...item, photo_url: null }} compact art={!!item.photo_url} />
          {!item.story_he && item.photo_url && <p className="mt-4 text-[0.9375rem] text-(--a-ink-3)">בלי סיפור: רק השם, המיקום והתמונה.</p>}
        </div>
      </Deck>
      <aside className="flex flex-col gap-3">
        <Checks item={item} />
        <ProposalMap item={item} />
      </aside>
      <Dock>
        <Decision key={item.id} item={item} busy={inbox.busy === item.id} decide={decide} size="lg" skip={skip} />
      </Dock>
    </article>
  )
}

function ReportStage({ report, inbox }: { report: Report; inbox: Inbox }) {
  const tools = useReportTools(report, inbox.loadReports, inbox.say)
  const left = inbox.order.length - inbox.position - 1
  return (
    <article aria-label={`בקשה על ${reportName(report)}`} className="mx-auto max-w-[45rem]">
      {urgent(report) && (
        <p className="mb-3 flex items-center gap-2 text-[0.875rem] font-semibold text-(--a-red)">
          <Glyph name="hide" className="size-4" />
          דחוף: הוסתר באתר עד שתחליטו
        </p>
      )}
      <Deck depth={left}>
        <div className="px-5 pt-6 pb-7 sm:px-8">
          <ReportBody report={report} tools={tools} />
        </div>
      </Deck>
      <Dock>
        <ReportActions report={report} tools={tools} size="lg" />
      </Dock>
    </article>
  )
}

function Start({ inbox, start }: { inbox: Inbox; start: () => void }) {
  const rows: { n: number; label: string; glyph: GlyphName; tone?: "red" | "sun" }[] = [
    { n: inbox.hot.length, label: "בקשות דחופות, מוסתרות עד החלטה", glyph: "hide", tone: "red" },
    { n: inbox.rest.filter((r) => r.status !== "closed").length, label: "בקשות הסרה אחרות", glyph: "mail" },
    { n: inbox.proposals.length, label: "הצעות למקומות חדשים ותיקונים", glyph: "queue" },
    { n: inbox.ops.length, label: "פעולות שנעצרו באמצע", glyph: "clock", tone: "sun" },
  ]
  return (
    <div className="mx-auto grid min-h-[70dvh] max-w-[45rem] content-center">
      <p className="text-[0.9375rem] font-medium text-(--a-ink-3)">{today()}</p>
      <h2 className="mt-1 text-[clamp(2.25rem,5vw,3.25rem)] leading-[1.05] font-bold tracking-[-0.02em] text-(--a-ink-1)">
        {greeting()}. <span className="text-(--a-ink-3)">נשארו</span> <span className="tabular-nums">{inbox.remaining}</span>
      </h2>
      <ul className="mt-8 divide-y divide-(--a-line) overflow-hidden rounded-3xl border border-(--a-line) bg-(--a-panel) shadow-(--a-shadow)">
        {rows
          .filter((r) => r.n)
          .map((r) => (
            <li key={r.label} className="flex items-center gap-4 px-5 py-4">
              <span
                className={cn(
                  "grid size-10 place-items-center rounded-2xl",
                  r.tone === "red"
                    ? "bg-(--a-red-soft) text-(--a-red)"
                    : r.tone === "sun"
                      ? "bg-(--a-sun-soft) text-(--a-sun)"
                      : "bg-(--a-sunk) text-(--a-ink-2)",
                )}
              >
                <Glyph name={r.glyph} className="size-5" />
              </span>
              <span className="flex-1 text-[1rem] text-(--a-ink-1)">{r.label}</span>
              <span className="text-[1.375rem] font-bold text-(--a-ink-1) tabular-nums">{r.n}</span>
            </li>
          ))}
      </ul>
      <div className="mt-7 flex flex-wrap items-center gap-3">
        <Btn variant="primary" size="lg" onClick={start}>
          {inbox.hot.length ? "להתחיל מהדחופות" : "להתחיל"}
          <Glyph name="arrow" flip />
        </Btn>
        <span className="hidden items-center gap-1.5 text-[0.875rem] text-(--a-ink-3) pointer-fine:flex">
          או <Kbd className="pointer-fine:inline-grid">J</Kbd> בכל רגע
        </span>
        {inbox.ops.length > 0 && (
          <Chip tone="sun" glyph="clock">
            יש פעולות שנעצרו: ברשימה
          </Chip>
        )}
      </div>
    </div>
  )
}
