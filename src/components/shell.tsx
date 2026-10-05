import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { motion } from "motion/react"
import { Drawer } from "vaul"
import { ChevronUpIcon, InfoIcon, MoonIcon, PlusIcon, SearchIcon, SunIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Anemone } from "@/components/anemone"
import { Explorer } from "@/components/explorer"
import { useStore } from "@/store"
import { cn } from "@/lib/utils"
import { ease, spring } from "@/lib/motion"
import { daysHe, since, yearsHe } from "@/lib/since"

const { days, years } = since()

function useIsMobile() {
  const [m, setM] = useState(() => window.matchMedia("(max-width: 767px)").matches)
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)")
    const on = () => setM(mq.matches)
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [])
  return m
}

export function Wordmark({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <a href="#/" className={cn("group flex items-center gap-2.5", className)} aria-label="מקום לזכור, חזרה למפה">
      <span className="transition-transform duration-500 ease-[var(--ease-spring)] group-hover:rotate-[24deg]">
        <Anemone size={compact ? 24 : 30} />
      </span>
      <span className={cn("font-display leading-none font-black text-ink-1", compact ? "text-title-3" : "text-title-2")}>מקום לזכור</span>
    </a>
  )
}

/**
 * Night and morning trade places in a circle that opens from the button (View Transitions API).
 * The map then eases into its new light; browsers without the API simply switch.
 */
function switchLight(e: React.MouseEvent, next: "night" | "morning", setLight: (l: "night" | "morning") => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } }
  if (!doc.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return setLight(next)
  const x = e.clientX
  const y = e.clientY
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
  const vt = doc.startViewTransition(() => {
    flushSync(() => setLight(next))
    document.documentElement.classList.toggle("dark", next === "night")
  })
  vt.ready.then(() =>
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 700, easing: "cubic-bezier(0.22, 1, 0.36, 1)", pseudoElement: "::view-transition-new(root)" },
    ),
  )
}

function Actions({ compact }: { compact?: boolean }) {
  const light = useStore((s) => s.light)
  const setLight = useStore((s) => s.setLight)
  const setSearchOpen = useStore((s) => s.setSearchOpen)
  const setAboutOpen = useStore((s) => s.setAboutOpen)
  const setAddOpen = useStore((s) => s.setAddOpen)

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {!compact && (
        <Button variant="float" className="h-11 rounded-full ps-4 pe-2 text-label text-ink-2" onClick={() => setSearchOpen(true)}>
          <SearchIcon data-icon="inline-start" />
          חיפוש מקום או קהילה
          <Kbd className="ms-3" dir="ltr">
            ⌘K
          </Kbd>
        </Button>
      )}
      {compact && (
        <Button variant="float" size="icon-lg" className="size-11 rounded-full" aria-label="חיפוש" onClick={() => setSearchOpen(true)}>
          <SearchIcon />
        </Button>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="float"
            size="icon-lg"
            className="size-11 rounded-full"
            aria-label={light === "night" ? "מעבר לאור בוקר" : "מעבר למצב לילה"}
            onClick={(e) => switchLight(e, light === "night" ? "morning" : "night", setLight)}
          >
            <motion.span
              key={light}
              initial={{ rotate: -90, scale: 0.4, opacity: 0 }}
              animate={{ rotate: 0, scale: 1, opacity: 1 }}
              transition={spring.bouncy}
              className="grid place-items-center"
            >
              {light === "night" ? <SunIcon /> : <MoonIcon />}
            </motion.span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{light === "night" ? "אור בוקר" : "מצב לילה, לערב יום הזיכרון"}</TooltipContent>
      </Tooltip>
      <Button variant="float" size="icon-lg" className="size-11 rounded-full" aria-label="על הפרויקט" onClick={() => setAboutOpen(true)}>
        <InfoIcon />
      </Button>
      {!compact && (
        <Button variant="brand" className="h-11 rounded-full px-5" onClick={() => setAddOpen(true)}>
          <PlusIcon data-icon="inline-start" />
          הוספת מקום
        </Button>
      )}
    </div>
  )
}

/**
 * One scroll container shows both the list and a place, so it needs telling apart: a place always opens at its top,
 * and going back finds the list where the reader left it.
 */
function usePanelScroll() {
  // The containers also opt out of scroll anchoring: otherwise, when the leaving card is removed, the browser
  // "keeps its place" by jumping the list back to the top.
  const ref = useRef<HTMLDivElement>(null)
  const listTop = useRef(0)
  const detailId = useStore((s) => (s.tab === "journey" ? null : s.selectedId))
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = detailId ? 0 : listTop.current
  }, [detailId])
  const onScroll = (e: React.UIEvent<HTMLElement>) => {
    if (!detailId) listTop.current = e.currentTarget.scrollTop
  }
  return { ref, onScroll }
}

const SNAPS = [0.24, 0.6, 0.94]

export function Shell() {
  const mobile = useIsMobile()
  const phase = useStore((s) => s.phase)
  const selectedId = useStore((s) => s.selectedId)
  const tab = useStore((s) => s.tab)
  const setAddOpen = useStore((s) => s.setAddOpen)
  const picking = useStore((s) => s.picking)
  const addOpen = useStore((s) => s.addOpen)
  const [snap, setSnap] = useState<number | string | null>(() => (mobile && (selectedId || tab === "journey") ? SNAPS[1] : SNAPS[0]))
  const [collapsed, setCollapsed] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const headerRef = useRef<HTMLDivElement>(null)
  const { ref: scrollRef, onScroll: onPanelScroll } = usePanelScroll()
  const [heights, setHeights] = useState({ open: window.innerHeight - 32, closed: 0 })

  // The panel's height is animated between two measured numbers. A layout animation used to do this, but while the
  // list faded out the panel briefly measured thousands of pixels tall, which squared its corners and made it snap.
  useLayoutEffect(() => {
    if (mobile || phase !== "day") return
    const measure = () => setHeights({ open: window.innerHeight - 32, closed: headerRef.current?.offsetHeight ?? 0 })
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [mobile, phase])

  // Choosing a place opens the panel again if it was folded away; on phones it lifts the sheet so the story is readable.
  // Adjusted while rendering, so the panel never paints a frame in its old state first.
  const [seen, setSeen] = useState({ selectedId, tab, mobile })
  if (seen.selectedId !== selectedId || seen.tab !== tab || seen.mobile !== mobile) {
    setSeen({ selectedId, tab, mobile })
    if (selectedId && selectedId !== seen.selectedId) setCollapsed(false)
    if (mobile && (selectedId || tab === "journey")) setSnap(SNAPS[1])
  }

  if (phase !== "day") return null

  if (!mobile)
    return (
      <>
        <motion.aside
          initial={{ opacity: 0, x: 40, height: heights.open }}
          animate={{ opacity: picking ? 0 : 1, x: picking ? 40 : 0, height: collapsed && heights.closed ? heights.closed : heights.open }}
          transition={{ default: { duration: 0.7, ease }, height: spring.soft }}
          className={cn(
            "fixed start-4 top-4 z-20 flex w-[424px] flex-col overflow-hidden rounded-[28px] bg-surface shadow-panel ring-1 ring-line outline-none",
            picking && "pointer-events-none",
          )}
          aria-label="מקומות וקהילות"
          // where the skip button lands; the panel's own controls are the next stops
          id="places"
          tabIndex={-1}
        >
          <div
            ref={headerRef}
            className={cn(
              "flex shrink-0 items-start justify-between gap-3 px-6 pt-6 pb-3 transition-shadow duration-300",
              scrolled && !collapsed && "shadow-[0_1px_0_var(--line)]",
            )}
          >
            <div className="flex flex-col gap-1">
              <Wordmark />
              <p className="ps-10 text-caption text-ink-2">
                {yearsHe(years)} · {daysHe(days)} · לא נשכח
              </p>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="-me-2 rounded-full text-ink-2"
                  aria-label={collapsed ? "פתיחת הרשימה" : "כיווץ הרשימה, כדי לראות יותר מהמפה"}
                  aria-expanded={!collapsed}
                  onClick={() => setCollapsed((c) => !c)}
                >
                  <motion.span animate={{ rotate: collapsed ? 180 : 0 }} transition={spring.snappy} className="grid place-items-center">
                    <ChevronUpIcon />
                  </motion.span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{collapsed ? "פתיחת הרשימה" : "כיווץ, כדי לראות יותר מהמפה"}</TooltipContent>
            </Tooltip>
          </div>
          {/* The list stays mounted while folded, so it opens again where the reader left it. */}
          <motion.div
            layoutScroll
            initial={false}
            animate={{ opacity: collapsed ? 0 : 1, transition: { duration: collapsed ? 0.12 : 0.3 } }}
            inert={collapsed}
            ref={scrollRef}
            onScroll={(e) => {
              onPanelScroll(e)
              setScrolled(e.currentTarget.scrollTop > 4)
            }}
            className="min-h-0 flex-1 scroll-fade overflow-y-auto overscroll-contain px-4 pt-1 pb-8 [overflow-anchor:none]"
          >
            <Explorer />
          </motion.div>
        </motion.aside>
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.25, ease }}
          // Never wider than the room beside the panel: with large text the buttons wrap onto a second row instead of
          // running over the panel's top (WCAG 1.4.4, text alone at 200%).
          className="fixed end-4 top-4 z-20 max-w-[calc(100vw-424px-3rem)]"
        >
          <Actions />
        </motion.div>
      </>
    )

  return (
    <>
      <motion.header
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="fixed inset-x-3 top-[max(12px,env(safe-area-inset-top))] z-20 flex items-center justify-between gap-2"
      >
        <div className="rounded-full bg-surface px-4 py-2 shadow-chip ring-1 ring-line">
          <Wordmark compact />
        </div>
        <Actions compact />
      </motion.header>

      <Drawer.Root
        // The sheet steps aside for the add flow; reopening it under the dialog would hide the dialog from screen readers.
        open={!picking && !addOpen}
        modal={false}
        dismissible={false}
        snapPoints={SNAPS}
        activeSnapPoint={snap}
        setActiveSnapPoint={setSnap}
        direction="bottom"
      >
        <Drawer.Portal>
          <Drawer.Content
            id="places"
            tabIndex={-1}
            dir="rtl"
            aria-describedby={undefined}
            className="fixed inset-x-0 bottom-0 z-30 flex h-[96dvh] flex-col rounded-t-[28px] bg-surface shadow-panel ring-1 ring-line outline-none"
          >
            <Drawer.Title className="sr-only">מקומות וקהילות</Drawer.Title>
            <div className="mx-auto mt-2.5 mb-2 h-1.5 w-10 shrink-0 rounded-full bg-line-strong" aria-hidden="true" />
            <div
              ref={scrollRef}
              onScroll={onPanelScroll}
              className={cn(
                "min-h-0 flex-1 px-4 pb-[max(24px,env(safe-area-inset-bottom))] [overflow-anchor:none]",
                snap === SNAPS[2] ? "overflow-y-auto" : "overflow-hidden",
              )}
            >
              <Explorer />
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      <Button
        onClick={() => setAddOpen(true)}
        aria-label="הוספת מקום"
        variant="brand"
        className="fixed end-4 z-20 size-14 rounded-full"
        style={{
          bottom: `calc(${(typeof snap === "number" ? snap : SNAPS[0]) * 100}dvh + 62px)`,
          transition: "bottom 0.4s cubic-bezier(.22,1,.36,1)",
        }}
      >
        <PlusIcon className="size-6" />
      </Button>
    </>
  )
}
