import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { INTRO_SEEN, useStore } from "@/store"
import { Button } from "@/components/ui/button"
import { Atmosphere } from "@/components/atmosphere"
import { ease } from "@/lib/motion"
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

const LINES = ["בבוקר שמחת תורה נשבר השקט בדרום.", "אנחנו זוכרים את מי שנרצחו, ואת מי שיצאו להגן על הבית ולא חזרו."]

const seen = () => {
  try {
    return localStorage.getItem(INTRO_SEEN) === "1"
  } catch {
    return false
  }
}

/** A line that arrives word by word, each word rising out of the dark. */
function Words({ text, delay = 0 }: { text: string; delay?: number }) {
  return (
    <>
      {text.split(" ").map((w, i) => (
        <motion.span
          key={i}
          className="inline-block whitespace-pre"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: delay + i * 0.09, duration: 0.7, ease }}
        >
          {w}{" "}
        </motion.span>
      ))}
    </>
  )
}

/** The date, one character at a time, and a clock that turns from 06:28 to 06:29. */
function DateStamp() {
  const [minute, setMinute] = useState(28)
  useEffect(() => {
    const t = setTimeout(() => setMinute(29), 1500)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="flex flex-col items-center gap-3">
      <span className="text-display tabular-nums" dir="ltr" aria-label="7 באוקטובר 2023">
        {"07.10.2023".split("").map((ch, i) => (
          <motion.span
            key={i}
            className="inline-block"
            initial={{ opacity: 0, y: 24, rotateX: -70 }}
            animate={{ opacity: 1, y: 0, rotateX: 0 }}
            transition={{ delay: 0.15 + i * 0.06, duration: 0.8, ease }}
          >
            {ch}
          </motion.span>
        ))}
      </span>
      <span className="flex text-headline font-medium text-dawn tabular-nums" dir="ltr" aria-label="שש עשרים ותשע">
        06:2
        <span className="relative inline-block h-[1.35em] w-[0.62em] overflow-hidden">
          <AnimatePresence initial={false}>
            <motion.span
              key={minute}
              className="absolute inset-0"
              initial={{ y: 22, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -22, opacity: 0 }}
              transition={{ duration: 0.5, ease }}
            >
              {minute % 10}
            </motion.span>
          </AnimatePresence>
        </span>
      </span>
    </div>
  )
}

/**
 * The opening: 06:29, the blue hour over the envelope. Two lines, the name, and an invitation to the morning.
 * Choosing it plays the sunrise; the flowers open as the light reaches them.
 */
export function Intro() {
  const phase = useStore((s) => s.phase)
  const setPhase = useStore((s) => s.setPhase)
  const count = useStore((s) => s.seed.filter((p) => p.kind !== "community").length)
  const replay = useStore((s) => s.introRun > 0)
  // Returning visitors, and anyone who asked for less motion, go straight to the name.
  const [quick] = useState(() => reducedMotion() || seen())
  // -1 shows the date, 0..LINES.length-1 the lines, LINES.length the name
  const [stage, setStage] = useState(quick ? LINES.length : -1)
  const cta = useRef<HTMLButtonElement>(null)

  const toMorning = async () => {
    try {
      localStorage.setItem(INTRO_SEEN, "1")
    } catch {
      /* private mode */
    }
    const { flyToEnvelope, setLabels, shiftLight, stopOrbit } = await import("@/map/controller")
    stopOrbit()
    setPhase("dawn")
    flyToEnvelope(reducedMotion() ? 0 : 5600)
    setTimeout(() => setLabels(true), reducedMotion() ? 0 : 2600)
    await shiftLight("morning", reducedMotion() ? 0 : 5200)
    setPhase("day")
  }

  useEffect(() => {
    if (phase !== "intro") return
    if (stage >= LINES.length) {
      cta.current?.focus({ preventScroll: true })
      return
    }
    const t = setTimeout(() => setStage((s) => s + 1), stage === -1 ? 3000 : 3600)
    return () => clearTimeout(t)
  }, [stage, phase])

  useEffect(() => {
    if (phase !== "intro") return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void toMorning()
      if (e.key === "Enter" || (e.key === " " && document.activeElement === document.body)) {
        e.preventDefault()
        if (stage < LINES.length) setStage((x) => x + 1)
        else void toMorning()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  return (
    <AnimatePresence>
      {phase !== "day" && (
        <motion.div
          key="intro"
          // On first load the night is already there; when the opening is played again, the dark comes back gently.
          initial={replay ? { opacity: 0 } : false}
          animate={{ opacity: 1, transition: { duration: 1.2 } }}
          className="pointer-events-none fixed inset-0 z-40 flex flex-col items-center justify-center px-6 text-center"
          role="dialog"
          aria-modal={phase === "intro"}
          aria-labelledby="intro-title"
          exit={{ opacity: 0, transition: { duration: 0.8 } }}
        >
          {/* a veil that lifts with the sun */}
          <motion.div
            className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_100%,color-mix(in_oklab,var(--p-ink-950)_15%,transparent),color-mix(in_oklab,var(--p-ink-950)_78%,transparent))]"
            animate={{ opacity: phase === "intro" ? 1 : 0 }}
            transition={{ duration: 3.5, ease: "easeOut" }}
          />

          <Atmosphere mode={phase === "intro" ? "embers" : "petals"} />

          {/* Sunrise: a warm light rises from the horizon and spreads, then gives way to the day. */}
          {phase === "dawn" && !reducedMotion() && (
            <motion.div
              className="absolute inset-x-[-20%] top-[8%] h-[90%] rounded-[50%] bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--p-sun-200)_70%,transparent),color-mix(in_oklab,var(--p-sun-300)_30%,transparent)_45%,transparent_75%)] will-change-[transform,opacity]"
              initial={{ y: 320, scale: 0.55, opacity: 0 }}
              animate={{ y: -40, scale: 1.25, opacity: [0, 0.95, 0.75, 0] }}
              transition={{ duration: 5.2, ease: [0.3, 0, 0.2, 1], times: [0, 0.35, 0.7, 1] }}
              aria-hidden="true"
            />
          )}

          {phase === "intro" && (
            <button
              onClick={toMorning}
              className="pressable pointer-events-auto absolute top-5 left-5 rounded-full px-3 py-1.5 text-label text-white/70 hover:bg-white/10 hover:text-white"
            >
              דילוג
            </button>
          )}

          {phase === "intro" && !quick && (
            <div className="absolute bottom-10 flex gap-2" aria-hidden="true">
              {[-1, 0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="h-1 rounded-full bg-white"
                  animate={{ width: stage === i ? 22 : 6, opacity: stage >= i ? 0.85 : 0.25 }}
                  transition={{ duration: 0.5, ease }}
                />
              ))}
            </div>
          )}

          <div className="relative grid min-h-[22rem] w-full max-w-3xl place-items-center text-white">
            <AnimatePresence mode="wait">
              {phase === "intro" && stage === -1 && (
                <motion.div
                  key="date"
                  className="col-start-1 row-start-1 flex flex-col items-center gap-3"
                  style={{ perspective: 600 }}
                  exit={{ opacity: 0, y: -12, transition: { duration: 0.8, ease } }}
                >
                  <DateStamp />
                </motion.div>
              )}

              {phase === "intro" && stage >= 0 && stage < LINES.length && (
                <motion.p
                  key={stage}
                  className="col-start-1 row-start-1 max-w-2xl text-statement text-balance"
                  exit={{ opacity: 0, y: -10, transition: { duration: 0.7, ease } }}
                >
                  <Words text={LINES[stage]} />
                </motion.p>
              )}

              {phase === "intro" && stage >= LINES.length && (
                <motion.div
                  key="title"
                  className="pointer-events-auto col-start-1 row-start-1 flex flex-col items-center gap-6"
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0, transition: { duration: quick ? 0.4 : 1.5, ease: "easeOut" } }}
                  exit={{ opacity: 0, y: -10, transition: { duration: 0.9 } }}
                >
                  <motion.h1
                    id="intro-title"
                    className="text-display [text-shadow:0_0_60px_color-mix(in_oklab,var(--dawn)_35%,transparent)]"
                    initial={{ clipPath: "inset(-30% -10% -30% 110%)" }}
                    animate={{ clipPath: "inset(-30% -10% -30% -10%)" }}
                    transition={{ duration: quick ? 0.6 : 1.4, ease: [0.65, 0, 0.35, 1] }}
                  >
                    מקום לזכור
                  </motion.h1>
                  <motion.p
                    className="max-w-xl text-body-lg text-pretty text-white/80 md:text-[1.2rem]"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: quick ? 0.3 : 0.9, duration: 0.8, ease }}
                  >
                    מפה של {count} מקומות שהוקמו לזכרם של נרצחי ונופלי 7 באוקטובר, ושל הקהילות בדרום שחוזרות לפרוח.
                  </motion.p>
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: quick ? 0.5 : 1.3, type: "spring", stiffness: 260, damping: 18 }}
                  >
                    <Button
                      ref={cta}
                      size="lg"
                      onClick={toMorning}
                      className="pressable group relative mt-2 h-13 rounded-full bg-white px-8 text-headline font-bold text-[var(--p-ink-900)] shadow-[0_0_0_6px_color-mix(in_oklab,var(--dawn)_18%,transparent),0_14px_44px_-10px_color-mix(in_oklab,var(--dawn)_75%,transparent)] hover:bg-[var(--p-sun-50)] hover:shadow-[0_0_0_10px_color-mix(in_oklab,var(--dawn)_22%,transparent),0_18px_54px_-10px_color-mix(in_oklab,var(--dawn)_85%,transparent)]"
                    >
                      <span className="relative">אל הבוקר</span>
                      <span className="cta-breath pointer-events-none absolute inset-0 rounded-full" aria-hidden="true" />
                    </Button>
                  </motion.div>
                  <p className="text-caption text-white/45">או Enter</p>
                </motion.div>
              )}

              {phase === "dawn" && (
                <motion.p
                  key="dawn"
                  className="col-start-1 row-start-1 max-w-2xl rounded-[2rem] bg-white/80 px-8 py-5 text-statement text-balance text-[var(--p-ink-900)] shadow-panel"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: [0, 1, 1, 0], y: 0, transition: { duration: 5, times: [0, 0.25, 0.75, 1], delay: 0.6 } }}
                >
                  ובכל חורף, הכלניות חוזרות לפרוח.
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
