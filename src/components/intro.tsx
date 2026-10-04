import { Fragment, lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { INTRO_SEEN, useStore } from "@/store"
import { Button } from "@/components/ui/button"
import { Anemone } from "@/components/anemone"
import { Atmosphere } from "@/components/atmosphere"
import { cn } from "@/lib/utils"
import { ease } from "@/lib/motion"
import { since, wintersHe, yearsHe } from "@/lib/since"
import type { CountTiming, MontageMode } from "@/components/montage"
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

const { days, years } = since()

// The montage of headlines is fetched while the clock ticks, so the first paint stays light.
const loadMontage = () => import("@/components/montage")
const Montage = lazy(() => loadMontage().then((m) => ({ default: m.Montage })))

/**
 * The opening is a short film, and only one thing moves at a time.
 * moment: the clock reaches 06:29 and the world stops. A second of stillness, then the date and what happened.
 * time: the clock steps back, still stopped, and the days count up to today while the headlines of those days pile up.
 * since, remember: the words. As the last one says we won't forget, time comes back.
 * name: an anemone opens, and a band of morning light reveals the name.
 */
const MOMENT = 0
const TIME = 1
const SINCE = 2
const REMEMBER = 3
const NAME = 4

const WHAT_HAPPENED = "בבוקר שמחת תורה נשבר השקט בדרום."
const SINCE_LINE = `מאז עברו ${yearsHe(years)}, והבוקר ההוא עדיין לא נגמר.`
const REMEMBER_LINES = ["אנחנו זוכרים את מי שנרצחו ואת מי שיצאו להגן ולא חזרו.", "ולא נשכח, גם כשהזמן עובר."]
const SINCE_LINES = [SINCE_LINE]

const WORD_STEP = 0.055
const WORD_TIME = 0.95
const words = (text: string) => text.split(" ").length
/** When a revealed line has fully arrived, counted from its first word. */
const landed = (text: string, delay = 0) => delay + (words(text) - 1) * WORD_STEP + WORD_TIME
/** A scene's new content waits for the last one to leave, so the eye is never split between two. */
const ENTER = 0.5
/** The count waits for the clock to finish stepping back. */
const COUNT_ENTER = 0.6

/** The count starts after the clock has stepped back, and races to today in a few seconds (see montage.tsx). */
const COUNT: CountTiming = { enter: COUNT_ENTER, delay: COUNT_ENTER + 0.3, seconds: 7.5 }

const REMEMBER_SECOND = landed(REMEMBER_LINES[0], ENTER) + 0.15
const SINCE_DELAYS = [ENTER]
const REMEMBER_DELAYS = [ENTER, REMEMBER_SECOND]
/** How long each scene holds before the next one, when nobody presses Enter. */
const HOLD_MS = [
  6800,
  // after the count lands, a moment of stillness
  (COUNT.delay + COUNT.seconds + 1.4) * 1000,
  (landed(SINCE_LINE, ENTER) + 1.4) * 1000,
  // the headlines begin to fall; the name comes in while their lights are still landing
  (landed(REMEMBER_LINES[1], REMEMBER_SECOND) + 1.7) * 1000,
]

const seen = () => {
  try {
    return localStorage.getItem(INTRO_SEEN) === "1"
  } catch {
    return false
  }
}

/** Words rise from behind an unseen baseline and come into focus, one after another. */
function Reveal({ text, delay = 0 }: { text: string; delay?: number }) {
  return text.split(" ").map((w, i) => (
    <Fragment key={i}>
      {/* the mask is padded so the blur and the low letters (ק ן ף ץ) aren't cut */}
      <span className="-mx-[0.12em] -my-[0.14em] inline-block overflow-hidden px-[0.12em] py-[0.14em] align-bottom">
        <motion.span
          className="inline-block"
          initial={{ y: "105%", opacity: 0, filter: "blur(10px)" }}
          animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
          transition={{ delay: delay + i * WORD_STEP, duration: WORD_TIME, ease }}
        >
          {w}
        </motion.span>
      </span>{" "}
    </Fragment>
  ))
}

/** One digit rolling upward to its next value. */
function RollingDigit({ value, delay = 0 }: { value: string; delay?: number }) {
  return (
    // An invisible zero holds the width (the digits are tabular) without becoming part of the text.
    <span className="relative inline-block overflow-hidden align-bottom before:invisible before:content-['0']">
      <AnimatePresence initial={false}>
        <motion.span
          key={value}
          className="absolute inset-0"
          initial={{ y: "70%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "-70%", opacity: 0 }}
          transition={{ duration: 0.35, delay, ease }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

/**
 * 06:28:57, and the seconds run out. At 06:29:00 it stops for good and takes the color of first light.
 * It stays through the count, stepped back and dimmed, because it never moves again.
 */
function Clock({ stepBack, onStop }: { stepBack: boolean; onStop: () => void }) {
  const [second, setSecond] = useState(57)
  useEffect(() => {
    const ticks = [1, 2, 3].map((k) => setTimeout(() => setSecond(57 + k), 200 + k * 700))
    return () => ticks.forEach(clearTimeout)
  }, [])
  const stopped = second >= 60
  useEffect(() => {
    if (stopped) onStop()
  }, [stopped, onStop])
  const text = `06:2${stopped ? 9 : 8}:${String(second % 60).padStart(2, "0")}`
  return (
    <motion.div
      // anchored above the middle of the screen; stepping back shrinks it toward its own baseline and lifts it clear of the count
      className="pointer-events-none absolute inset-x-0 bottom-1/2 mb-[2vh] flex justify-center"
      style={{ transformOrigin: "50% 100%" }}
      initial={{ opacity: 0, scale: 0.97, filter: "blur(12px)" }}
      animate={
        stepBack ? { opacity: 0.4, scale: 0.4, y: "-80%", filter: "blur(0px)" } : { opacity: 1, scale: 1, y: "0%", filter: "blur(0px)" }
      }
      exit={{ opacity: 0, transition: { duration: 0.6, ease } }}
      transition={stepBack ? { duration: 1.1, ease } : { delay: 0.2, duration: 1.1, ease }}
    >
      <time
        dateTime="2023-10-07T06:29:00+03:00"
        dir="ltr"
        className={cn("text-display tabular-nums transition-colors duration-[1400ms]", stopped ? "text-dawn" : "text-white")}
      >
        {text
          .split("")
          .map((ch, i) =>
            i >= 4 && ch !== ":" ? <RollingDigit key={i} value={ch} delay={{ 4: 0.12, 6: 0.06 }[i] ?? 0} /> : <span key={i}>{ch}</span>,
          )}
      </time>
    </motion.div>
  )
}

/** Under the stopped clock, after a second of stillness: the date, then what happened. */
function Moment() {
  return (
    <motion.div
      className="pointer-events-none absolute inset-x-0 top-1/2 mt-[2vh] flex flex-col items-center gap-5 px-6"
      exit={{ opacity: 0, y: 8, transition: { duration: 0.6, ease } }}
    >
      <motion.p
        dir="ltr"
        className="text-title-2 font-bold text-white/85 tabular-nums"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 3.3, duration: 1.0, ease }}
      >
        07.10.2023
      </motion.p>
      <p className="max-w-2xl text-statement text-balance">
        <Reveal text={WHAT_HAPPENED} delay={3.9} />
      </p>
    </motion.div>
  )
}

/** A scene of words: sentences one after another, each on its own row. */
function Lines({ sentences, delays, onLanded }: { sentences: string[]; delays: number[]; onLanded?: () => void }) {
  useEffect(() => {
    if (!onLanded) return
    const last = sentences.length - 1
    const t = setTimeout(onLanded, landed(sentences[last], delays[last]) * 1000)
    return () => clearTimeout(t)
  }, [sentences, delays, onLanded])
  return (
    <motion.p
      className="pointer-events-none col-start-1 row-start-1 max-w-2xl text-statement text-balance"
      exit={{ opacity: 0, y: -8, transition: { duration: 0.6, ease } }}
    >
      {sentences.map((s, i) => (
        <span key={i} className={i > 0 ? "mt-4 block" : "block"}>
          <Reveal text={s} delay={delays[i]} />
        </span>
      ))}
    </motion.p>
  )
}

/**
 * The name. A bud opens into the anemone, then a band of morning light crosses the name and leaves it lit.
 * Returning visitors get it all at once.
 */
function Name({
  quick,
  count,
  cta,
  onMorning,
}: {
  quick: boolean
  count: number
  cta: React.Ref<HTMLButtonElement>
  onMorning: () => void
}) {
  const [open, setOpen] = useState(quick)
  // Once the light has crossed, the mask and the band of light are taken away: a mask left on would cut the name's glow at its edges.
  const [lit, setLit] = useState(quick)
  const [shone, setShone] = useState(quick)
  useEffect(() => {
    if (quick) return
    const t = setTimeout(() => setOpen(true), 700)
    return () => clearTimeout(t)
  }, [quick])
  // the beats after the light has crossed the name
  const after = (k: number) => (quick ? 0.15 + k * 0.15 : 2.9 + k * 0.4)
  return (
    <motion.div
      className="pointer-events-auto col-start-1 row-start-1 flex flex-col items-center gap-5"
      exit={{ opacity: 0, y: -10, transition: { duration: 0.9 } }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: quick ? 0 : 0.2, type: "spring", stiffness: 180, damping: 18 }}
      >
        <Anemone state={open ? "open" : "bud"} size={60} />
      </motion.div>
      <motion.p
        className="-mb-3 text-headline font-medium text-dawn"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: after(0), duration: 0.8, ease }}
      >
        {yearsHe(years)}
      </motion.p>
      <motion.h1
        id="intro-title"
        className="relative text-display [text-shadow:0_0_60px_color-mix(in_oklab,var(--dawn)_35%,transparent)]"
        initial={quick ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        {/* while the light crosses, the mask is padded wide enough to hold the glow */}
        <span
          className={lit ? "inline-block" : "title-sweep -m-[64px] inline-block p-[64px]"}
          style={lit ? undefined : { animationDelay: "1.1s" }}
          onAnimationEnd={() => setLit(true)}
        >
          מקום לזכור
        </span>
        {!shone && (
          <span
            className="title-shine pointer-events-none absolute inset-0 [text-shadow:none]"
            style={{ animationDelay: "1.1s, 2.8s" }}
            onAnimationEnd={(e) => e.animationName === "title-shine-out" && setShone(true)}
            aria-hidden="true"
          >
            מקום לזכור
          </span>
        )}
      </motion.h1>
      <motion.p
        className="max-w-xl text-body-lg text-pretty text-white/80 md:text-[1.2rem]"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: after(1), duration: 0.8, ease }}
      >
        מפה של {count} מקומות שהוקמו לזכרם של נרצחי ונופלי 7 באוקטובר, ושל הקהילות בדרום שחוזרות לפרוח.
      </motion.p>
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: after(2), type: "spring", stiffness: 260, damping: 18 }}
      >
        <Button
          ref={cta}
          size="lg"
          onClick={onMorning}
          className="pressable group relative mt-2 h-13 rounded-full bg-white px-8 text-headline font-bold text-[var(--p-ink-900)] shadow-[0_0_0_6px_color-mix(in_oklab,var(--dawn)_18%,transparent),0_14px_44px_-10px_color-mix(in_oklab,var(--dawn)_75%,transparent)] hover:bg-[var(--p-sun-50)] hover:shadow-[0_0_0_10px_color-mix(in_oklab,var(--dawn)_22%,transparent),0_18px_54px_-10px_color-mix(in_oklab,var(--dawn)_85%,transparent)]"
        >
          <span className="relative">אל הבוקר</span>
          <span className="cta-breath pointer-events-none absolute inset-0 rounded-full" aria-hidden="true" />
        </Button>
      </motion.div>
      {/* a keyboard hint means nothing on a touch screen */}
      <motion.p
        className="text-caption text-white/45 [@media(hover:none)]:hidden"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: after(3), duration: 0.8 }}
      >
        או Enter
      </motion.p>
    </motion.div>
  )
}

/** The opening: 06:29 in the blue hour over the envelope, the days since, the words, the name, and an invitation to the morning. */
export function Intro() {
  const phase = useStore((s) => s.phase)
  const setPhase = useStore((s) => s.setPhase)
  const count = useStore((s) => s.seed.filter((p) => p.kind !== "community").length)
  const replay = useStore((s) => s.introRun > 0)
  // Returning visitors, and anyone who asked for less motion, go straight to the name.
  const [quick] = useState(() => reducedMotion() || seen())
  const [stage, setStage] = useState(quick ? NAME : MOMENT)
  // Time stops at 06:29 and comes back with "we won't forget", or with the name for anyone who skipped ahead.
  const [stopped, setStopped] = useState(false)
  const [resumed, setResumed] = useState(false)
  const held = stopped && !resumed && stage < NAME
  const back = stopped && !held
  const cta = useRef<HTMLButtonElement>(null)
  const stop = useCallback(() => setStopped(true), [])
  const resume = useCallback(() => setResumed(true), [])
  const montage: MontageMode = stage === TIME ? "count" : back ? "fall" : "float"

  // the headlines and their photos are fetched while the clock ticks, ready for the count
  useEffect(() => {
    if (quick) return
    void loadMontage().then((m) => m.preloadPhotos())
  }, [quick])

  // The camera holds still with the embers. When time comes back it waits for the headlines to land on their places, then drifts.
  useEffect(() => {
    if (!stopped) return
    let live = true
    let drift = 0
    void import("@/map/controller").then((m) => {
      if (!live) return
      m.setTimeHeld(held)
      if (!held) drift = window.setTimeout(() => m.startOrbit(), 2600)
    })
    return () => {
      live = false
      clearTimeout(drift)
    }
  }, [stopped, held])

  const toMorning = async () => {
    try {
      localStorage.setItem(INTRO_SEEN, "1")
    } catch {
      /* private mode */
    }
    const { flyToEnvelope, setLabels, setTimeHeld, shiftLight, stopOrbit } = await import("@/map/controller")
    setTimeHeld(false)
    stopOrbit()
    setPhase("dawn")
    flyToEnvelope(reducedMotion() ? 0 : 5600)
    setTimeout(() => setLabels(true), reducedMotion() ? 0 : 2600)
    await shiftLight("morning", reducedMotion() ? 0 : 5200)
    setPhase("day")
  }

  useEffect(() => {
    if (phase !== "intro") return
    if (stage >= NAME) {
      cta.current?.focus({ preventScroll: true })
      return
    }
    const t = setTimeout(() => setStage((s) => s + 1), HOLD_MS[stage])
    return () => clearTimeout(t)
  }, [stage, phase])

  useEffect(() => {
    if (phase !== "intro") return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void toMorning()
      if (e.key === "Enter" || (e.key === " " && document.activeElement === document.body)) {
        e.preventDefault()
        if (stage < NAME) setStage((x) => x + 1)
        else void toMorning()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const inIntro = phase === "intro"
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
          aria-modal={inIntro}
          aria-labelledby="intro-title"
          exit={{ opacity: 0, transition: { duration: 0.8 } }}
        >
          {/* a veil that lifts with the sun */}
          <motion.div
            className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_100%,color-mix(in_oklab,var(--p-ink-950)_15%,transparent),color-mix(in_oklab,var(--p-ink-950)_78%,transparent))]"
            animate={{ opacity: inIntro ? 1 : 0 }}
            transition={{ duration: 3.5, ease: "easeOut" }}
          />

          {/* First light on the horizon: a thin promise while time is stopped, growing once it comes back. */}
          <motion.div
            className="absolute inset-x-0 bottom-0 h-[60vh] bg-[radial-gradient(70%_100%_at_50%_100%,color-mix(in_oklab,var(--p-sun-300)_30%,transparent),transparent_70%)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: !inIntro ? 0 : stage >= NAME ? 0.9 : back ? 0.6 : 0.2 }}
            transition={{ duration: back ? 4 : 2, ease: "easeInOut" }}
            aria-hidden="true"
          />

          <Atmosphere mode={inIntro ? "embers" : "petals"} frozen={held} />

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

          {inIntro && (
            <button
              onClick={toMorning}
              className="pressable pointer-events-auto absolute top-5 left-5 rounded-full px-3 py-1.5 text-label text-white/70 hover:bg-white/10 hover:text-white"
            >
              דילוג
            </button>
          )}

          {/* On a phone the map credits wrap to two rows at the bottom, so the dots sit above them. */}
          {inIntro && !quick && (
            <div className="absolute bottom-20 flex gap-2 md:bottom-10" aria-hidden="true">
              {[MOMENT, TIME, SINCE, REMEMBER, NAME].map((i) => (
                <motion.span
                  key={i}
                  className="h-1 rounded-full bg-white"
                  animate={{ width: stage === i ? 22 : 6, opacity: stage >= i ? 0.85 : 0.25 }}
                  transition={{ duration: 0.5, ease }}
                />
              ))}
            </div>
          )}

          {/* Every scene shares one stage; each waits for the last to leave before it enters. */}
          <div className="absolute inset-0 grid place-items-center px-6 text-white">
            {inIntro && !quick && stage >= TIME && (
              <Suspense fallback={null}>
                <Montage mode={montage} days={days} count={COUNT} />
              </Suspense>
            )}
            <AnimatePresence>
              {inIntro && stage <= TIME && <Clock key="clock" stepBack={stage === TIME} onStop={stop} />}
              {inIntro && stage === MOMENT && <Moment key="moment" />}
              {inIntro && stage === SINCE && <Lines key="since" sentences={SINCE_LINES} delays={SINCE_DELAYS} />}
              {inIntro && stage === REMEMBER && (
                <Lines key="remember" sentences={REMEMBER_LINES} delays={REMEMBER_DELAYS} onLanded={resume} />
              )}
              {inIntro && stage === NAME && <Name key="name" quick={quick} count={count} cta={cta} onMorning={toMorning} />}
              {phase === "dawn" && (
                <motion.p
                  key="dawn"
                  className="col-start-1 row-start-1 max-w-2xl text-statement text-balance text-white [text-shadow:0_2px_28px_color-mix(in_oklab,var(--p-ink-950)_70%,transparent),0_1px_3px_color-mix(in_oklab,var(--p-ink-950)_55%,transparent)]"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: [0, 1, 1, 0], y: 0, transition: { duration: 5, times: [0, 0.25, 0.75, 1], delay: 0.6 } }}
                >
                  {/* a sentence to a row, so neither breaks in the middle */}
                  <span className="block">{wintersHe(years)} עברו מאז.</span>{" "}
                  <span className="block">ובכל אחד מהם, הכלניות חזרו לפרוח.</span>
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
