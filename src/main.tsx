import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { MotionConfig } from "motion/react"
import "./index.css"
import App from "./App.tsx"
import { Specimen } from "@/components/specimen"
import { DirectionProvider } from "@/components/ui/direction"
import { TooltipProvider } from "@/components/ui/tooltip"
import { watchErrors } from "@/lib/error-report"

// Before anything renders, so an error in the first paint is told too.
watchErrors()

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
