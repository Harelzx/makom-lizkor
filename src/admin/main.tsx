import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import { MotionConfig } from "motion/react"
import { ArrowUpLeft } from "lucide-react"
import "@/index.css"
import { AnemoneMark } from "@/components/anemone"
import { cn } from "@/lib/utils"
import { Queue } from "./queue"
import { Reports, type ReportCounts } from "./reports"
import { CuratedImport } from "./curated-import"
import { Operations } from "./operations"

// The site picks night or day by the hour; this page follows the moderator's own system setting instead, and keeps
// following it while open.
const dark = matchMedia("(prefers-color-scheme: dark)")
const applyScheme = () => {
  document.documentElement.classList.toggle("dark", dark.matches)
  // Native checkboxes, date pickers and scrollbars follow too.
  document.documentElement.style.colorScheme = dark.matches ? "dark" : "light"
}
applyScheme()
dark.addEventListener("change", applyScheme)

const today = new Date().toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Jerusalem" })
/** A count read so far: a dash while it loads, and a plus when there are more pages than the ones read. */
const shown = (n: number | null, more = false) => (n === null ? "–" : `${n}${more ? "+" : ""}`)

/** One number at the top of the page, which is also the way down to its list. */
function Stat({ href, value, label, urgent }: { href: string; value: string; label: string; urgent?: boolean }) {
  return (
    <a
      href={href}
      className="pressable group flex min-w-0 flex-col gap-1 rounded-2xl px-4 py-3 outline-none hover:bg-surface-2 focus-visible:ring-3 focus-visible:ring-ring/30"
    >
      <span className={cn("text-title-1 tabular-nums", urgent ? "text-brand" : "text-ink-1")}>{value}</span>
      <span className="flex items-center gap-1 text-label text-ink-2">
        {label}
        <ArrowUpLeft
          aria-hidden
          className="size-3.5 opacity-0 transition-[opacity,transform] duration-200 group-hover:-translate-x-0.5 group-hover:opacity-100 motion-reduce:transition-none"
        />
      </span>
    </a>
  )
}

function Admin() {
  const [queue, setQueue] = useState<number | null>(null)
  const [reports, setReports] = useState<ReportCounts | null>(null)
  return (
    <MotionConfig reducedMotion="user">
      {/* The site's body never scrolls (the map fills it), so the admin page scrolls on its own. */}
      <main className="h-full overflow-y-auto">
        <header className="sticky top-0 z-20 border-b border-line bg-glass">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
            <div className="flex items-center gap-2.5">
              <AnemoneMark size={28} />
              <span className="text-headline text-ink-1">מקום לזכור</span>
              <span className="text-label text-ink-3">ניהול</span>
            </div>
            <a href="/" className="pressable rounded-full px-3 py-2 text-label text-ink-2 hover:bg-surface-2 hover:text-ink-1">
              לאתר
            </a>
          </div>
        </header>

        <div className="mx-auto max-w-6xl px-4 pt-8 pb-20 sm:px-6 sm:pt-12">
          <div className="cascade grid items-end gap-x-12 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              <p className="text-label text-ink-3">{today}</p>
              <h1 className="mt-1 text-title-1 text-ink-1">תור המנהלים</h1>
              <p className="reading-copy mt-2 text-body-lg text-ink-2">
                בקשות להסרה קודם, כי כל אחת נבדקת בדחיפות. אחריהן ההצעות החדשות, כפי שנשלחו: מנהלים לא עורכים את מה שנכתב.
              </p>
            </div>
            {/* Requests first: each one is reviewed urgently (spec 6). */}
            <nav aria-label="מה ממתין" className="-mx-4 mt-6 grid grid-cols-3 gap-1 border-y border-line py-2 sm:mx-0 lg:mt-0 lg:min-w-xl">
              <Stat
                href="#reports"
                value={shown(reports?.reports ?? null, reports?.moreReports)}
                label="בקשות להסרה"
                urgent={!!reports?.reports}
              />
              <Stat href="#queue" value={shown(queue)} label="הצעות בתור" />
              <Stat
                href="#reports"
                value={shown(reports?.attention ?? null, reports?.moreAttention)}
                label="דורשות טיפול"
                urgent={!!reports?.attention}
              />
            </nav>
          </div>

          <div className="mt-10 grid items-start gap-10 lg:grid-cols-[20rem_minmax(0,1fr)] lg:gap-12">
            <aside className="lg:sticky lg:top-24">
              <Operations />
            </aside>
            <div className="flex min-w-0 flex-col gap-14">
              <Reports onCounts={setReports} />
              <Queue onCount={setQueue} />
              <CuratedImport />
            </div>
          </div>
        </div>
      </main>
    </MotionConfig>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Admin />
  </StrictMode>,
)
