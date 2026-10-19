import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { MotionConfig } from "motion/react"
import "./index.css"
import App from "./App.tsx"
import { Specimen } from "@/components/specimen"
import { DirectionProvider } from "@/components/ui/direction"
import { TooltipProvider } from "@/components/ui/tooltip"
import { watchErrors } from "@/lib/error-report"

// The site moved to its own domain on 18 October 2026, and the old workers.dev address still serves it. Anyone who
// lands there goes on to the same page (the hash keeps the place) before anything loads: the server takes anemones,
// contact and proposals only from the site's own address.
const moved = location.hostname === "makom-lizkor.makom-staging.workers.dev"
if (moved) location.replace("https://makomlizkor.org" + location.pathname + location.search + location.hash)

// A tab left open across a release still names the previous build's chunks, which are gone after a deploy: its next
// lazy load fails (Safari: "TypeError: Importing a module script failed"). Load the page again, now from the current
// build. At most once a minute, so a chunk that is truly missing can't turn into a reload loop.
addEventListener("vite:preloadError", (event) => {
  try {
    if (Date.now() - Number(sessionStorage.getItem("makom-lizkor:reloaded") ?? 0) < 60_000) return
    sessionStorage.setItem("makom-lizkor:reloaded", String(Date.now()))
  } catch {
    return
  }
  event.preventDefault()
  location.reload()
})

// Before anything renders, so an error in the first paint is told too.
watchErrors()

if (!moved)
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      {/* Anyone who asked their device for less motion gets fades instead of movement, everywhere at once. */}
      <MotionConfig reducedMotion="user">
        <DirectionProvider dir="rtl">
          <TooltipProvider delayDuration={250}>
            {import.meta.env.DEV && location.search.includes("specimen") ? <Specimen /> : <App />}
          </TooltipProvider>
        </DirectionProvider>
      </MotionConfig>
    </StrictMode>,
  )
