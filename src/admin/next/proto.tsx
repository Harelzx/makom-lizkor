import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import { MotionConfig } from "motion/react"
import "@/index.css"
import "./admin.css"
import "@fontsource/ibm-plex-sans-hebrew/400.css"
import "@fontsource/ibm-plex-sans-hebrew/500.css"
import "@fontsource/ibm-plex-sans-hebrew/600.css"
import "@fontsource/ibm-plex-sans-hebrew/700.css"
import { cn } from "@/lib/utils"
import { applyTheme } from "../theme"
import { useFetcher } from "./api"
import { getScenario, mockFetch, resetMock, setScenario, type Scenario } from "./mock-server"
import { Workbench } from "./workbench"
import { Focus } from "./focus"

/**
 * The two directions as a prototype: synthetic data answered from memory (mock-server.ts), nothing sent anywhere.
 * A small switch at the corner moves between them and turns on the states that are hard to meet on purpose.
 */
useFetcher(mockFetch)
const asked = new URLSearchParams(location.search).get("s") as Scenario | null
if (asked && ["normal", "slow", "offline", "conflict", "empty"].includes(asked)) setScenario(asked)
applyTheme()
document.documentElement.classList.add("font-admin", "admin-next")
// Published as a bare page too (where the host writes the document), so the page sets its own language and direction.
document.documentElement.lang = "he"
document.documentElement.dir = "rtl"

type Design = "a" | "b"
const SCENARIOS: [Scenario, string][] = [
  ["normal", "רגיל"],
  ["slow", "חיבור איטי"],
  ["offline", "בלי חיבור"],
  ["conflict", "מישהו קדם לי"],
  ["empty", "תור ריק"],
]

function Prototype() {
  const params = new URLSearchParams(location.search)
  const [design, setDesign] = useState<Design>(params.get("d") === "b" ? "b" : "a")
  const [scenario, setLocal] = useState<Scenario>(getScenario())
  const [run, setRun] = useState(0)
  const [open, setOpen] = useState(false)
  const restart = (next: Partial<{ design: Design; scenario: Scenario }>) => {
    if (next.design) {
      setDesign(next.design)
      const url = new URL(location.href)
      url.searchParams.set("d", next.design)
      history.replaceState(null, "", url)
    }
    if (next.scenario) {
      setScenario(next.scenario)
      setLocal(next.scenario)
    }
    setRun((n) => n + 1)
  }
  return (
    <>
      {design === "a" ? <Workbench key={run} sample /> : <Focus key={run} sample />}
      <div className="fixed top-[4.25rem] left-2 z-[60] flex flex-col-reverse items-start gap-2 lg:top-auto lg:bottom-24 lg:left-3 lg:flex-col">
        {open && (
          <div className="w-64 rounded-2xl border border-(--a-line) bg-(--a-panel) p-3 text-[0.8125rem] shadow-(--a-shadow-lg)">
            <p className="mb-2 font-bold text-(--a-ink-1)">אב־טיפוס · נתוני דמה בלבד</p>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-(--a-sunk) p-1">
              {(["a", "b"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={design === d}
                  onClick={() => restart({ design: d })}
                  className={cn(
                    "a-focus-ring h-9 rounded-lg font-semibold",
                    design === d ? "bg-(--a-panel) text-(--a-ink-1) shadow-(--a-shadow)" : "text-(--a-ink-2)",
                  )}
                >
                  {d === "a" ? "א · שולחן עבודה" : "ב · מיקוד"}
                </button>
              ))}
            </div>
            <p className="mt-3 mb-1.5 font-semibold text-(--a-ink-2)">מצב לבדיקה</p>
            <div className="flex flex-wrap gap-1">
              {SCENARIOS.map(([s, label]) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={scenario === s}
                  onClick={() => restart({ scenario: s })}
                  className={cn(
                    "a-focus-ring h-8 rounded-lg border px-2.5 font-medium",
                    scenario === s ? "border-(--a-ink-1) bg-(--a-ink-1) text-(--a-panel)" : "border-(--a-line-2) text-(--a-ink-1)",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="a-focus-ring mt-3 h-8 rounded-lg px-1 font-semibold text-(--a-ink-2) underline underline-offset-4"
              onClick={() => {
                resetMock()
                restart({})
              }}
            >
              איפוס נתוני הדמה
            </button>
          </div>
        )}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="a-focus-ring h-8 rounded-full bg-(--a-ink-1) px-3 text-[0.75rem] font-bold text-(--a-panel) shadow-(--a-shadow-lg) lg:h-10 lg:px-4 lg:text-[0.8125rem]"
        >
          {design === "a" ? "כיוון א" : "כיוון ב"}
          <span className="max-lg:hidden"> · {SCENARIOS.find(([s]) => s === scenario)![1]}</span>
        </button>
      </div>
    </>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <Prototype />
    </MotionConfig>
  </StrictMode>,
)
