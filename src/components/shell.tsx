import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { motion } from "motion/react"
import { Drawer } from "vaul"
import { ChevronUpIcon, InfoIcon, MoonIcon, PlusIcon, SearchIcon, SunIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { AnemoneMark } from "@/components/anemone"
import { Explorer } from "@/components/explorer"
import { allPlaces, useStore } from "@/store"
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
    <a href="#/" className={cn("group flex items-center gap-2.5 whitespace-nowrap", className)} aria-label="מקום לזכור, חזרה למפה">
      <span className="transition-transform duration-500 ease-[var(--ease-spring)] group-hover:rotate-[24deg]">
        <AnemoneMark size={compact ? 24 : 32} />
      </span>
      <span
        className={cn("font-display leading-none font-black text-ink-1", compact ? "text-[16px] min-[360px]:text-[18px]" : "text-title-2")}
      >
        מקום לזכור
      </span>
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
    <div className={cn("flex items-center justify-end", compact ? "shrink-0 gap-1" : "flex-wrap gap-2")}>
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
        <TooltipContent>{light === "night" ? "אור בוקר" : "מצב לילה"}</TooltipContent>
      </Tooltip>
      <Button variant="float" size="icon-lg" className="size-11 rounded-full" aria-label="על הפרויקט" onClick={() => setAboutOpen(true)}>
        <InfoIcon />
      </Button>
      {!compact && (
        <Button variant="action" className="h-11 rounded-full px-5" onClick={() => setAddOpen(true)}>
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

const SNAPS = ["84px", 0.6, 0.88]

export function Shell() {
  const mobile = useIsMobile()
  const phase = useStore((s) => s.phase)
  const selectedId = useStore((s) => s.selectedId)
  const tab = useStore((s) => s.tab)
  const setAddOpen = useStore((s) => s.setAddOpen)
  const picking = useStore((s) => s.picking)
  const addOpen = useStore((s) => s.addOpen)
  const [snap, setSnap] = useState<number | string | null>(() => (mobile && (selectedId || tab === "journey") ? SNAPS[2] : SNAPS[0]))
  const [peek, setPeek] = useState(SNAPS[0] as string)
  const folded = typeof snap !== "number"
  // Folded, the sheet still says what it holds: the places, or the one chosen on the map.
  const placeCount = useStore((s) => allPlaces(s).filter((p) => p.kind !== "community").length)
  const chosenName = useStore((s) => (s.selectedId ? (allPlaces(s).find((p) => p.id === s.selectedId)?.name_he ?? null) : null))
  const foldedNow = useRef(folded)
  useEffect(() => {
    foldedNow.current = folded
  }, [folded])
  const gripFrom = useRef(0)
  const [collapsed, setCollapsed] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const headerRef = useRef<HTMLDivElement>(null)
  const { ref: scrollRef, onScroll: onPanelScroll } = usePanelScroll()
  // Whether the visitor is reading down the raised sheet (see the actions below).
  const [calm, setCalm] = useState(false)
  const lastTop = useRef(0)
  // A keyboard moving through the sheet keeps its actions: Tab scrolls the list too, and they'd step out of its reach.
  const byKey = useRef(false)
  useEffect(() => {
    const key = () => (byKey.current = true)
    const pointer = () => (byKey.current = false)
    window.addEventListener("keydown", key, true)
    window.addEventListener("pointerdown", pointer, true)
    window.addEventListener("wheel", pointer, { capture: true, passive: true })
    window.addEventListener("touchstart", pointer, { capture: true, passive: true })
    return () => {
      window.removeEventListener("keydown", key, true)
      window.removeEventListener("pointerdown", pointer, true)
      window.removeEventListener("wheel", pointer, true)
      window.removeEventListener("touchstart", pointer, true)
    }
  }, [])
  const reading = calm && !folded
  const [heights, setHeights] = useState({ open: window.innerHeight - 32, closed: 0 })

  // Measure the actions, including the phone's safe area. A percentage peek wastes space on tall phones.
  const measureMobileBar = useCallback((bar: HTMLDivElement | null) => {
    if (!bar) return
    const measure = () => {
      const height = Math.ceil(bar.getBoundingClientRect().height)
      // Presence briefly measures zero while a dialog removes the sheet. Never turn that into an offscreen snap. Raised,
      // the bar drops its folded line, so only a folded bar is the peek.
      if (height <= 0 || !foldedNow.current) return
      const next = `${height}px`
      document.documentElement.style.setProperty("--map-peek", next)
      setPeek(next)
      setSnap((current) => (typeof current === "number" ? current : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(bar)
    return () => observer.disconnect()
  }, [])

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
  // Taken from the store as the choice is made, in the same event, so the panel never paints a frame in its old state.
  // Adjusted while rendering, the lift was sometimes lost on a phone: a tap on a flower chose the place and left the sheet
  // folded, as React threw that render away and its update with it.
  useEffect(
    () =>
      useStore.subscribe((s, was) => {
        if (s.selectedId === was.selectedId && s.tab === was.tab) return
        if (s.selectedId && s.selectedId !== was.selectedId) setCollapsed(false)
        if (!window.matchMedia("(max-width: 767px)").matches || !(s.selectedId || s.tab === "journey")) return
        // A flower tapped on the map: the camera flies to it first, and the story rises once it has landed, so the
        // place is seen arriving before the sheet covers half of it. From the list the sheet is already up.
        if (foldedNow.current && s.selectedId && s.selectedId !== was.selectedId) {
          const id = s.selectedId
          const chosen = performance.now()
          void import("@/map/controller")
            .then((m) => m.landed(chosen))
            .then(() => useStore.getState().selectedId === id && setSnap(SNAPS[2]))
        } else setSnap(SNAPS[2])
      }),
    [],
  )

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
          data-panel-collapsed={collapsed}
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
        className="fixed inset-x-[12px] top-[max(12px,env(safe-area-inset-top))] z-40 flex flex-wrap items-center justify-between gap-2"
      >
        {/* The flower is round, so it sits concentric in the pill's cap ((48 - 24) / 2 = 12px). The last letter is
            square against a curve that turns away from it, so that end needs more room to look as far from the edge. */}
        <div className="rounded-full bg-surface py-3 ps-3 pe-5 shadow-chip ring-1 ring-line">
          <Wordmark compact />
        </div>
        <Actions compact />
      </motion.header>

      <Drawer.Root
        // The sheet steps aside for the add flow; reopening it under the dialog would hide the dialog from screen readers.
        open={!picking && !addOpen}
        modal={false}
        dismissible={false}
        snapPoints={[peek, SNAPS[1], SNAPS[2]]}
        activeSnapPoint={snap}
        setActiveSnapPoint={setSnap}
        direction="bottom"
      >
        <Drawer.Portal>
          <Drawer.Content
            id="places"
            tabIndex={-1}
            onFocus={(e) => {
              // Reveal keyboard skip focus. Safari also focuses this container on pointer-down;
              // opening then would make the button's following click immediately close it again.
              if (e.target === e.currentTarget && e.currentTarget.matches(":focus-visible")) setSnap(SNAPS[2])
            }}
            dir="rtl"
            aria-describedby={undefined}
            // Vaul offsets numeric snap points against the whole viewport, not the drawer's CSS height.
            // Keep that height, but reserve its offscreen part so every scroll position remains reachable.
            style={{ paddingBottom: typeof snap === "number" ? `${(1 - snap) * 100}dvh` : `calc(100dvh - ${peek})` }}
            // One surface from the screen's edge, folded or raised: a sheet that comes out of the edge reads as one to
            // pull, where a floating card read as a toolbar. Safari's bar then floats over the sheet, not over a strip of map.
            // The map shows through it, blurred, as under the system's own map sheets, so the map reads as going on below.
            className="fixed inset-x-0 bottom-0 z-30 flex h-dvh flex-col rounded-t-[28px] bg-material shadow-panel ring-1 ring-line backdrop-blur-2xl backdrop-saturate-150 outline-none"
          >
            <Drawer.Title className="sr-only">מקומות וקהילות</Drawer.Title>
            {/* Folded, the sheet is a grabber, a line of what it holds and one row of actions, as in the system's own sheets:
                the surface rising out of the screen's edge, with its grabber, is what says it can be pulled, so it needs no
                written instruction. */}
            <div ref={measureMobileBar} className="flow-root shrink-0 pb-[max(12px,env(safe-area-inset-bottom))]">
              <div className="flow-root" data-sheet-surface>
                {/* A tap on the grabber steps through the heights, as in the system's sheets; a pull is Vaul's and never
                    counts as a tap. It is a shortcut for touch: keyboards and screen readers have the button below. */}
                <div
                  data-sheet-grip
                  aria-hidden="true"
                  className="flex h-7 shrink-0 cursor-grab items-center justify-center select-none"
                  onPointerDown={(e) => (gripFrom.current = e.clientY)}
                  onClick={(e) => {
                    if (Math.abs(e.clientY - gripFrom.current) > 6) return
                    setSnap(folded ? SNAPS[1] : snap === SNAPS[1] ? SNAPS[2] : peek)
                  }}
                >
                  <span className="h-[5px] w-9 rounded-full bg-ink-3/60" />
                </div>
                {/* What the sheet holds, in one line: as in the system's map sheets, a folded sheet shows content, not only
                    actions. Raised, the list has its own heading. */}
                {folded && (
                  <div data-sheet-summary className="flex items-baseline justify-between gap-3 px-5 pb-2.5">
                    <p className="truncate text-headline text-ink-1">{chosenName ?? "מקומות לזכור"}</p>
                    {!chosenName && placeCount > 0 && <p className="shrink-0 text-caption text-ink-2">{placeCount} מקומות</p>}
                  </div>
                )}
                {/* Reading, the actions step aside: scrolled down into a story they fold away and give the text their row,
                    and they come back with a scroll up, near the top, or when the keyboard reaches them. The grabber stays,
                    so the sheet can still be pulled. */}
                <div
                  data-sheet-actions
                  onFocusCapture={() => setCalm(false)}
                  className={cn(
                    "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
                    reading ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
                  )}
                >
                  <div className={cn("min-h-0", reading && "overflow-hidden")} inert={reading}>
                    <div className="flex flex-wrap items-center gap-2 px-4">
                      <Button
                        variant="fill"
                        className="h-11 min-w-fit flex-1 rounded-full px-4 py-1 leading-tight whitespace-normal"
                        aria-expanded={!folded}
                        onClick={() => setSnap(folded ? SNAPS[2] : peek)}
                      >
                        {!folded ? "חזרה למפה" : selectedId ? "לסיפור ולפרטי הביקור" : "הצגת המקומות"}
                      </Button>
                      <Button
                        variant="action"
                        className="h-11 min-w-fit flex-1 rounded-full px-4 py-1 leading-tight whitespace-normal"
                        onClick={() => setAddOpen(true)}
                      >
                        <PlusIcon className="size-4" />
                        הוספת מקום
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {/* The sheet moves only by its top: the grabber, the line of what it holds and the actions. Pulled from the list,
                a scroll that reached the top went on to fold the sheet, or close it, under a finger that meant to read. */}
            <div
              ref={scrollRef}
              onScroll={(e) => {
                onPanelScroll(e)
                const top = e.currentTarget.scrollTop
                const step = top - lastTop.current
                lastTop.current = top
                if (top < 56 || byKey.current) setCalm(false)
                else if (step > 6) setCalm(true)
                else if (step < -6) setCalm(false)
              }}
              data-vaul-no-drag
              inert={folded}
              aria-hidden={folded}
              className={cn(
                "min-h-0 flex-1 px-4 pb-[max(24px,env(safe-area-inset-bottom))] [overflow-anchor:none]",
                "overflow-y-auto overscroll-contain",
              )}
            >
              <Explorer />
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  )
}
