import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Toaster } from "@/components/ui/sonner"
import { useStore } from "@/store"
import { Intro } from "@/components/intro"
import { Celebration } from "@/components/celebration"

// The opening paints from the first, small bundle. The map engine and the panels stream in behind it,
// and the dialogs load the first time someone opens them.
const MapCanvas = lazy(() => import("@/map/map-canvas").then((m) => ({ default: m.MapCanvas })))
const Shell = lazy(() => import("@/components/shell").then((m) => ({ default: m.Shell })))
const Search = lazy(() => import("@/components/search").then((m) => ({ default: m.Search })))
const About = lazy(() => import("@/components/about").then((m) => ({ default: m.About })))
const AddPlace = lazy(() => import("@/components/add-place").then((m) => ({ default: m.AddPlace })))
const Tracking = lazy(() => import("@/components/tracking").then((m) => ({ default: m.Tracking })))
const VerifyEmail = lazy(() => import("@/components/verify-email").then((m) => ({ default: m.VerifyEmail })))

/** Keep the URL and the selection in step, so a place can be linked and shared. */
function useHashRoute() {
  const selectedId = useStore((s) => s.selectedId)
  const phase = useStore((s) => s.phase)
  useEffect(() => {
    // `entering`: the day has just begun. A place chosen during the sunrise isn't in the address yet; that is not the
    // visitor going Back, so it stays chosen (the effect below writes it into the address).
    const apply = (entering = false) => {
      const [, route, id] = location.hash.split("/")
      const s = useStore.getState()
      // A tracking link opens the submission's status. The token is a private capability, so it leaves the address at
      // once: out of this tab's history entry, a screen share and a copied address. The browser's own history list (and
      // the mail it came in) still keep the link as it was opened; only the browser can clear those.
      // An email verification link opens a page that asks for a click (a mail scanner following the link confirms
      // nothing); its secret leaves the address the same way.
      if (route === "verify" && id) {
        s.setVerifying(decodeURIComponent(id))
        history.replaceState(null, "", "#/")
      } else if (route === "track" && id) {
        const token = location.hash.split("/")[3]
        if (token) s.setTracking({ id: decodeURIComponent(id), token: decodeURIComponent(token) })
        history.replaceState(null, "", "#/")
      } else if (route === "place" && id) {
        const pid = decodeURIComponent(id)
        // A link to a place that isn't here (a typo, an old link) opens the overview instead. Local places and approved
        // contributions (p_…) load later, so they're trusted.
        if (pid.startsWith("local-") || pid.startsWith("p_") || s.seed.some((p) => p.id === pid)) s.select(pid)
        else {
          history.replaceState(null, "", "#/")
          void import("@/map/controller").then((m) => m.flyToEnvelope(2400))
        }
      }
      // Back (the browser button, or the swipe on a phone) closes the card and returns to the list.
      else if (s.selectedId && !entering) {
        if (s.journeyIndex >= 0) s.setJourney(-1, false)
        s.select(null)
        void import("@/map/controller").then((m) => m.flyToEnvelope(2200))
      }
    }
    if (phase === "day") apply(true)
    const onHash = () => apply()
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [phase])
  // A contribution's link is trusted until the server's feed has come; if that feed doesn't have it (a typo, a rejected
  // or hidden place), the link falls back to the overview, as any unknown link does. The offline copy doesn't count:
  // a place approved since it was saved would fall back wrongly.
  const feedVersion = useStore((s) => s.feedVersion)
  const feedLive = useStore((s) => s.feedLive)
  // The contribution whose card was last shown with its place, so its disappearing can be told from a bad link. Only
  // recorded here: a selection is never checked against the feed already held, which may predate the place.
  const shown = useRef<string | null>(null)
  const remote = useStore((s) => s.remote)
  useEffect(() => {
    if (selectedId?.startsWith("p_") && remote.some((p) => p.id === selectedId)) shown.current = selectedId
  }, [selectedId, remote])
  useEffect(() => {
    const s = useStore.getState()
    const id = s.selectedId
    if (!feedVersion || !feedLive || !id?.startsWith("p_") || s.remote.some((p) => p.id === id)) return
    history.replaceState(null, "", "#/")
    s.select(null)
    // A place taken out of view while its card was open (hidden, or withdrawn by its sender) closes quietly, saying
    // only that it isn't shown now: never why, and never as if the visitor had done something wrong.
    if (shown.current === id) toast("המקום הזה אינו מוצג כרגע")
    shown.current = null
    void import("@/map/controller").then((m) => m.flyToEnvelope(2400))
  }, [feedVersion, feedLive])
  useEffect(() => {
    if (phase !== "day") return
    const next = selectedId ? `#/place/${encodeURIComponent(selectedId)}` : "#/"
    if (location.hash === next) return
    // Opening a card from the list adds a history entry, so Back closes it; moving between places replaces it.
    if (selectedId && !location.hash.startsWith("#/place/")) history.pushState({ card: true }, "", next)
    else if (!selectedId && history.state?.card) history.back()
    else history.replaceState(history.state, "", next)
  }, [selectedId, phase])
}

export default function App() {
  const init = useStore((s) => s.init)
  const light = useStore((s) => s.light)
  const phase = useStore((s) => s.phase)
  const aboutOpen = useStore((s) => s.aboutOpen)
  const addOpen = useStore((s) => s.addOpen)
  const searchOpen = useStore((s) => s.searchOpen)
  const introRun = useStore((s) => s.introRun)
  // Dialogs load on first open and then stay mounted, so they can animate closed.
  const [aboutLoaded, setAboutLoaded] = useState(false)
  const [addLoaded, setAddLoaded] = useState(false)
  const tracking = useStore((s) => s.tracking)
  const [trackingLoaded, setTrackingLoaded] = useState(false)
  if (tracking && !trackingLoaded) setTrackingLoaded(true)
  const verifying = useStore((s) => s.verifying)
  if (aboutOpen && !aboutLoaded) setAboutLoaded(true)
  if (addOpen && !addLoaded) setAddLoaded(true)
  useHashRoute()

  // When the opening ends, the button that ended it is gone and the focus with it. The focus goes to the skip button,
  // the page's first stop, so a keyboard carries on from the top rather than from where the opening was; it shows
  // only to a keyboard (focus-visible), and a page that opens straight at a place is left alone.
  const skipRef = useRef<HTMLButtonElement>(null)
  const prevPhase = useRef(phase)
  useEffect(() => {
    const at = document.activeElement
    // focus already lost, or still on the opening as it fades out
    const lost = !at || at === document.body || !!at.closest('[aria-labelledby="intro-title"]')
    if (prevPhase.current !== "day" && phase === "day" && lost) skipRef.current?.focus({ preventScroll: true })
    prevPhase.current = phase
  }, [phase])

  useEffect(() => {
    void init()
  }, [init])

  // While the opening plays, fetch the panel's code in the background so it's ready at sunrise.
  useEffect(() => {
    const t = setTimeout(() => void import("@/components/shell"), 2500)
    return () => clearTimeout(t)
  }, [])

  // Approved contributions come from the server once the day has begun. The sync loads on its own, so the opening's
  // bundle stays free of network code, and a server that is down changes nothing the visitor sees.
  useEffect(() => {
    if (phase !== "day") return
    let stop: (() => void) | undefined
    let cancelled = false
    let stopTributes: (() => void) | undefined
    void import("@/lib/feed").then((m) => {
      if (!cancelled) stop = m.startFeedSync()
    })
    void import("@/lib/tributes").then((m) => {
      if (!cancelled) stopTributes = m.startTributeSync()
    })
    return () => {
      cancelled = true
      stop?.()
      stopTributes?.()
    }
  }, [phase])

  // The interface wears the night palette during the opening and whenever night is chosen.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", phase === "intro" || light === "night")
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", phase === "intro" || light === "night" ? "#0b1120" : "#e5eedb")
  }, [light, phase])

  return (
    <main className="fixed inset-0">
      {/* The map's flowers come first in the tab order, about ninety of them; this lets a keyboard go straight to the list.
          A button rather than a link, because the address belongs to the router. */}
      {phase === "day" && (
        <button
          ref={skipRef}
          type="button"
          className="pressable fixed start-4 top-4 z-50 -translate-y-24 rounded-full bg-surface px-5 py-2.5 text-label text-ink-1 shadow-panel ring-1 ring-line outline-none focus-visible:translate-y-0 focus-visible:ring-3 focus-visible:ring-ring/30"
          onClick={() => document.getElementById("places")?.focus()}
        >
          דילוג לרשימת המקומות
        </button>
      )}
      <Suspense fallback={null}>
        <MapCanvas />
      </Suspense>
      <Suspense fallback={null}>{phase === "day" && <Shell />}</Suspense>
      <Intro key={introRun} />
      <Suspense fallback={null}>
        {(phase === "day" || searchOpen) && <Search />}
        {aboutLoaded && <About />}
        {addLoaded && <AddPlace />}
        {trackingLoaded && <Tracking />}
        {verifying && <VerifyEmail />}
      </Suspense>
      <Celebration />
      <Toaster position="top-center" />
    </main>
  )
}
