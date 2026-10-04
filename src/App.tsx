import { lazy, Suspense, useEffect, useState } from "react"
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

/** Keep the URL and the selection in step, so a place can be linked and shared. */
function useHashRoute() {
  const selectedId = useStore((s) => s.selectedId)
  const phase = useStore((s) => s.phase)
  useEffect(() => {
    const apply = () => {
      const [, route, id] = location.hash.split("/")
      const s = useStore.getState()
      if (route === "place" && id) {
        const pid = decodeURIComponent(id)
        // A link to a place that isn't here (a typo, an old link) opens the overview instead. Local places load later, so they're trusted.
        if (pid.startsWith("local-") || s.seed.some((p) => p.id === pid)) s.select(pid)
        else {
          history.replaceState(null, "", "#/")
          void import("@/map/controller").then((m) => m.flyToEnvelope(2400))
        }
      }
      // Back (the browser button, or the swipe on a phone) closes the card and returns to the list.
      else if (s.selectedId) {
        if (s.journeyIndex >= 0) s.setJourney(-1, false)
        s.select(null)
        void import("@/map/controller").then((m) => m.flyToEnvelope(2200))
      }
    }
    if (phase === "day") apply()
    window.addEventListener("hashchange", apply)
    return () => window.removeEventListener("hashchange", apply)
  }, [phase])
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
  if (aboutOpen && !aboutLoaded) setAboutLoaded(true)
  if (addOpen && !addLoaded) setAddLoaded(true)
  useHashRoute()

  useEffect(() => {
    void init()
  }, [init])

  // While the opening plays, fetch the panel's code in the background so it's ready at sunrise.
  useEffect(() => {
    const t = setTimeout(() => void import("@/components/shell"), 2500)
    return () => clearTimeout(t)
  }, [])

  // The interface wears the night palette during the opening and whenever night is chosen.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", phase === "intro" || light === "night")
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", phase === "intro" || light === "night" ? "#0b1120" : "#e5eedb")
  }, [light, phase])

  return (
    <main className="fixed inset-0">
      <Suspense fallback={null}>
        <MapCanvas />
      </Suspense>
      <Suspense fallback={null}>{phase === "day" && <Shell />}</Suspense>
      <Intro key={introRun} />
      <Suspense fallback={null}>
        {(phase === "day" || searchOpen) && <Search />}
        {aboutLoaded && <About />}
        {addLoaded && <AddPlace />}
      </Suspense>
      <Celebration />
      <Toaster position="top-center" />
    </main>
  )
}
