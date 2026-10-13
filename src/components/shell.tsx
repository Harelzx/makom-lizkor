import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { motion } from "motion/react"
import { Drawer } from "vaul"
import { ChevronUpIcon, InfoIcon, MoonIcon, PlusIcon, SearchIcon, SunIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Anemone } from "@/components/anemone"
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
        <Anemone size={compact ? 22 : 30} />
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
      {/* On a phone the search lives at the foot of the screen, in the sheet, where the thumb is. */}
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

const SNAPS = ["88px", 0.6, 0.88]

export function Shell() {
  const mobile = useIsMobile()
  const phase = useStore((s) => s.phase)
  const selectedId = useStore((s) => s.selectedId)
  const tab = useStore((s) => s.tab)
  const setAddOpen = useStore((s) => s.setAddOpen)
  const picking = useStore((s) => s.picking)
  const addOpen = useStore((s) => s.addOpen)
  const [snap, setSnap] = useState<number | string | null>(() => (mobile && (selectedId || tab === "journey") ? SNAPS[2] : SNAPS[0]))
  const [peek, setPeek] = useState("88px")
  const folded = typeof snap !== "number"
  const local = useStore((s) => s.local)
  const remote = useStore((s) => s.remote)
  const selected = selectedId && tab !== "journey" ? allPlaces({ remote, local }).find((p) => p.id === selectedId) : undefined
  // Raising the sheet and focusing its search field in the same tap: iOS opens the keyboard only for a focus made
  // inside the tap itself, so the sheet is committed first (the list stops being inert) and focused at once.
  const gripFrom = useRef(0)
  const openSearch = () => {
    flushSync(() => setSnap(SNAPS[2]))
    if (useStore.getState().tab === "journey") return
    document.querySelector<HTMLInputElement>('#places input[type="search"]')?.focus({ preventScroll: true })
  }
  const [collapsed, setCollapsed] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const headerRef = useRef<HTMLDivElement>(null)
  const { ref: scrollRef, onScroll: onPanelScroll } = usePanelScroll()
  const [heights, setHeights] = useState({ open: window.innerHeight - 32, closed: 0 })

  // Measure the actions, including the phone's safe area. A percentage peek wastes space on tall phones.
  const measureMobileBar = useCallback((bar: HTMLDivElement | null) => {
    if (!bar) return
    const measure = () => {
      // The peek is the folded bar; raised, the bar is the grabber alone and must not become the next fold.
      if (bar.dataset.folded !== "true") return
      const height = Math.ceil(bar.getBoundingClientRect().height)
      // Presence briefly measures zero while a dialog removes the sheet. Never turn that into an offscreen snap.
      if (height <= 0) return
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
  // Adjusted while rendering, so the panel never paints a frame in its old state first.
  const [seen, setSeen] = useState({ selectedId, tab, mobile })
  if (seen.selectedId !== selectedId || seen.tab !== tab || seen.mobile !== mobile) {
    setSeen({ selectedId, tab, mobile })
    if (selectedId && selectedId !== seen.selectedId) setCollapsed(false)
    if (mobile && (selectedId || tab === "journey")) setSnap(SNAPS[2])
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
        <div className="rounded-full bg-surface px-2.5 py-3 shadow-chip ring-1 ring-line">
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
            className="fixed inset-x-0 bottom-0 z-30 flex h-dvh flex-col rounded-t-[28px] bg-surface shadow-panel ring-1 ring-line outline-none"
          >
            <Drawer.Title className="sr-only">מקומות וקהילות</Drawer.Title>
            {/* Laid out as the map apps do (Apple Maps, Google Maps, Material 3's standard sheet): a grabber, then the one thing
                worth reaching for from the map, a search field into the places, and the add action beside it. Folded, it is
                all that shows; raised, the list takes over below the grabber alone. No instructions: a sheet that
                comes out of the edge with its grabber and its search field is read as one to pull. */}
            <div
              ref={measureMobileBar}
              data-folded={folded}
              className={cn("shrink-0", folded && "pb-[max(12px,env(safe-area-inset-bottom))]")}
            >
              {/* The grabber is also a button, as in iOS: a tap moves the sheet between the map and the list. A pull that
                  ends on it is a drag, not a tap, so it never toggles the sheet straight back. */}
              <button
                type="button"
                data-sheet-grip
                className="flex h-6 w-full items-center justify-center outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/30"
                aria-label={folded ? (selected ? "פתיחת הסיפור" : "הצגת המקומות") : "חזרה למפה"}
                aria-expanded={!folded}
                onPointerDown={(e) => (gripFrom.current = e.clientY)}
                onClick={(e) => {
                  if (e.detail > 0 && Math.abs(e.clientY - gripFrom.current) > 6) return
                  setSnap(folded ? SNAPS[2] : peek)
                }}
              >
                <span className="h-[5px] w-9 rounded-full bg-ink-3/45" />
              </button>
              {folded ? (
                <div className="flex items-center gap-2 px-3">
                  {selected ? (
                    <button
                      type="button"
                      className="pressable flex min-h-12 min-w-0 flex-1 flex-col items-start justify-center rounded-3xl bg-surface-2 px-4 py-1.5 text-start"
                      onClick={() => setSnap(SNAPS[2])}
                    >
                      <span className="w-full truncate text-label font-semibold text-ink-1">{selected.name_he}</span>
                      <span className="text-caption text-ink-2">לסיפור ולפרטי הביקור</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="pressable flex min-h-12 min-w-0 flex-1 items-center gap-2.5 rounded-full bg-surface-2 px-4 py-1.5 text-start text-body text-ink-2"
                      onClick={openSearch}
                    >
                      <SearchIcon className="size-5 shrink-0 text-ink-3" aria-hidden="true" />
                      חיפוש מקום, יישוב או שם
                    </button>
                  )}
                  <Button
                    variant="brand"
                    size="icon-lg"
                    className="size-12 shrink-0 rounded-full"
                    aria-label="הוספת מקום"
                    onClick={() => setAddOpen(true)}
                  >
                    <PlusIcon className="size-6" />
                  </Button>
                </div>
              ) : null}
            </div>
            <div
              ref={scrollRef}
              onScroll={onPanelScroll}
              inert={folded}
              aria-hidden={folded}
              className={cn(
                // The list ends clear of the floating add button.
                "min-h-0 flex-1 px-4 pb-[calc(88px+env(safe-area-inset-bottom))] [overflow-anchor:none]",
                "overflow-y-auto overscroll-contain",
              )}
            >
              <Explorer />
            </div>
          </Drawer.Content>
          {/* Raised, the list has the screen, and adding stays one tap away as the list's floating action (Material 3's
              FAB, as Google Maps keeps its own). Beside the sheet, not in it, so it holds the screen's corner while the
              sheet moves; it leaves at once, so a folded sheet never shows two of it. */}
          {!folded && !picking && !addOpen && (
            <motion.div
              key="add"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={spring.snappy}
              className="fixed end-4 bottom-[max(20px,calc(env(safe-area-inset-bottom)+12px))] z-40"
            >
              <Button
                variant="brand"
                size="icon-lg"
                className="size-14 rounded-full shadow-panel"
                aria-label="הוספת מקום"
                onClick={() => setAddOpen(true)}
              >
                <PlusIcon className="size-6" />
              </Button>
            </motion.div>
          )}
        </Drawer.Portal>
      </Drawer.Root>
    </>
  )
}
