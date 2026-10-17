import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { MotionConfig } from "motion/react"
import "@/index.css"
// The moderators' page has its own face: a working tool read for long stretches, set apart from the memorial itself.
import "@fontsource/ibm-plex-sans-hebrew/400.css"
import "@fontsource/ibm-plex-sans-hebrew/500.css"
import "@fontsource/ibm-plex-sans-hebrew/600.css"
import "@fontsource/ibm-plex-sans-hebrew/700.css"
import { Inbox } from "./inbox"
import { applyTheme } from "./theme"

applyTheme()
// On <html>, so dialogs portaled outside the root take the face too.
document.documentElement.classList.add("font-admin")

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <Inbox />
    </MotionConfig>
  </StrictMode>,
)
