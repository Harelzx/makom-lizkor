import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Volume2, VolumeX } from "lucide-react"
import { INTRO_SEEN, useStore } from "@/store"
import { Button } from "@/components/ui/button"
import { Anemone } from "@/components/anemone"
import { Atmosphere } from "@/components/atmosphere"
import { cn } from "@/lib/utils"
import { ease, push, rush } from "@/lib/motion"
import { since, wintersHe, yearsHe } from "@/lib/since"
import {
  cue,
  disableSound,
  enableSound,
  isSoundOn,
  setBed,
  setScoreClock,
  soundPreference,
  stopScore,
  subscribeSound,
  syncScore,
} from "@/lib/sound"
import type { CountTiming, MontageMode } from "@/components/montage"
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

const { days, years } = since()

// The montage of headlines is fetched while the clock ticks, so the first paint stays light.
const loadMontage = () => import("@/components/montage")
const Montage = lazy(() => loadMontage().then((m) => ({ default: m.Montage })))

/**
 * The opening is a short film, and only one thing moves at a time.
 * before it: the clock waits at 06:28:57 while the visitor chooses to watch with sound or without.
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

/**
 * From the count to the name the words are typed, as on a typewriter: a key heard for every letter, each letter coming
 * into focus as it lands, a thin caret leading the way. The pace sets the scenes' lengths, and so the score's sections:
 * change it and the score has to be cut again (see CLAUDE.md).
 */
const TYPE_RATE = 16
/** A typed letter's own focus-in, after its key. */
const LETTER_TIME = 0.15
/** When a typed line is complete, counted from its first key. */
const typed = (text: string, delay = 0) => delay + text.length / TYPE_RATE + LETTER_TIME
/** A scene's new content waits for the last one to leave, so the eye is never split between two. */
const ENTER = 0.5
/** The count waits for the clock to finish stepping back. */
const COUNT_ENTER = 0.6

/** The count starts after the clock has stepped back, and races to today in a few seconds (see montage.tsx). */
const COUNT: CountTiming = { enter: COUNT_ENTER, delay: COUNT_ENTER + 0.3, seconds: 8.0 }
/** Today, held: long enough to read the number before the camera moves (and the score's arrival lands on it). */
const LANDED_HOLD = 1.9
/** When the last typed line is complete: the words leave first, then the papers fall, so one thing moves at a time. */
const WORDS_LEAVE = 0.3
const FALL_AFTER = 0.9
/** After the fall, a breath: only the lights glow on the sites, before the name. The score waits with it. */
const BREATH = 1.2
/** The camera drifts again only once the lights of the fall have faded into the sites' own glow (montage.tsx). */
const ORBIT_AFTER = 5.4
/** The sunrise, as one move: its length, its first-light step, when the place names fade in, and its line. */
const SUNRISE = { seconds: 7, first: 2.2, labels: 5.5, line: { delay: 1.0, seconds: 5.6 } }

/** The second line waits a beat after the first, like a carriage return. */
const REMEMBER_SECOND = typed(REMEMBER_LINES[0], ENTER) + 0.3
const SINCE_DELAYS = [ENTER]
const REMEMBER_DELAYS = [ENTER, REMEMBER_SECOND]
/** The clock's last seconds are a little longer than real ones, so each tick lands. */
const TICK = 1.1
/** When the clock reaches 06:29:00 and stops, counted from the click that starts the film. */
const FREEZE = 0.2 + 3 * TICK
/** How long each scene holds before the next one, when nobody presses Enter. */
const HOLD_MS = [
  // after the freeze, a second of stillness, the date and what happened
  (FREEZE + 4.5) * 1000,
  // after the count lands, a moment of stillness
  (COUNT.delay + COUNT.seconds + LANDED_HOLD) * 1000,
  (typed(SINCE_LINE, ENTER) + 1.4) * 1000,
  // the words leave, the headlines fall, and after a breath with only their lights on the sites, the name comes in
  (typed(REMEMBER_LINES[1], REMEMBER_SECOND) + 1.7 + BREATH) * 1000,
]

/**
 * The score (public/sound/score.mp3) is composed in sections cut to these timings: it begins with the line of what
 * happened, and each scene starts at a known point in it. A scene reached early (Enter) moves the music there.
 * Change the scene timings and the score has to be composed again to match (see CLAUDE.md).
 */
const SCORE_START = FREEZE + 1.5
const SCORE_AT = HOLD_MS.reduce((at, ms, i) => [...at, at[i] + ms / 1000], [-SCORE_START])

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
 * 06:28:57, waiting for the visitor; then the seconds run out. At 06:29:00 it stops for good and takes the color of
 * first light. It stays through the count, stepped back and dimmed, because it never moves again.
 */
function Clock({ running, stepBack, onStop }: { running: boolean; stepBack: boolean; onStop: () => void }) {
  const [second, setSecond] = useState(57)
  useEffect(() => {
    if (!running) return
    const ticks = [1, 2, 3].map((k) => setTimeout(() => setSecond(57 + k), (0.2 + k * TICK) * 1000))
    return () => ticks.forEach(clearTimeout)
  }, [running])
  // every second that passes is heard, the last one too: then nothing
  useEffect(() => {
    if (second > 57) cue("tick")
  }, [second])
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

/**
 * Before time runs: with sound or without. The browser plays nothing until the visitor clicks, and the first sounds
 * matter most (the last seconds, then the silence at 06:29), so the film waits for this one click.
 * The last choice is the one in focus, so Enter keeps it.
 */
function Choice({ onChoose }: { onChoose: (sound: boolean) => void }) {
  const withSound = useRef<HTMLButtonElement>(null)
  const without = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    ;(soundPreference() === "off" ? without : withSound).current?.focus({ preventScroll: true })
  }, [])
  return (
    <motion.div
      role="group"
      aria-label="איך לצפות"
      className="pointer-events-auto absolute inset-x-0 top-1/2 mt-[2vh] flex justify-center gap-3 px-6"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.9, duration: 0.8, ease }}
      exit={{ opacity: 0, transition: { duration: 0.35 } }}
    >
      <Button
        ref={withSound}
        size="lg"
        onClick={() => onChoose(true)}
        className="pressable h-12 gap-2 rounded-full bg-white px-6 text-headline font-bold text-[var(--p-ink-900)] hover:bg-[var(--p-sun-50)]"
      >
        <Volume2 aria-hidden="true" className="size-5" />
        עם צליל
      </Button>
      <Button
        ref={without}
        size="lg"
        variant="ghost"
        onClick={() => onChoose(false)}
        className="pressable h-12 gap-2 rounded-full px-6 text-headline text-white/75 hover:bg-white/10 hover:text-white"
      >
        <VolumeX aria-hidden="true" className="size-5" />
        בלי צליל
      </Button>
    </motion.div>
  )
}

/** Sound on or off during the film, for anyone who changes their mind. */
function SoundToggle() {
  const on = useSyncExternalStore(subscribeSound, isSoundOn)
  return (
    <button
      aria-label="צליל"
      aria-pressed={on}
      onClick={() => (on ? disableSound() : void enableSound())}
      className="pressable pointer-events-auto absolute top-5 right-5 z-10 grid size-9 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
    >
      {on ? <Volume2 aria-hidden="true" className="size-5" /> : <VolumeX aria-hidden="true" className="size-5" />}
    </button>
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
        transition={{ delay: FREEZE + 1, duration: 1.0, ease }}
      >
        07.10.2023
      </motion.p>
      <p className="max-w-2xl text-statement text-balance">
        <Reveal text={WHAT_HAPPENED} delay={FREEZE + 1.6} />
      </p>
    </motion.div>
  )
}

/**
 * How the words meet the camera. When the count lands, the camera rushes through the pile toward them, so they come from
 * far away, at half their size; after that it only drifts in. Either way they end at their own size, where text is sharp.
 */
type Approach = { from: number; seconds: number; ease: readonly [number, number, number, number] }
const SINCE_APPROACH: Approach = { from: 0.55, ...rush }
const REMEMBER_APPROACH: Approach = { from: 0.94, ...push }

/**
 * A line typed letter by letter. Words are kept whole, so a line never breaks inside a word. The caret sits before the
 * next letter (after the last one at a word's end), and when the line is done it blinks twice and goes. The letters are
 * hidden from screen readers, which get the line whole.
 */
function Typed({ text, delay }: { text: string; delay: number }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    let frame = 0
    let shown = 0
    const from = performance.now() + delay * 1000
    const tick = (now: number) => {
      const due = Math.min(text.length, Math.max(0, Math.floor(((now - from) / 1000) * TYPE_RATE)))
      if (due > shown) {
        // one key per frame is heard, even if a slow frame brings two letters: keys piled up would be noise
        cue(text[due - 1] === " " ? "space" : "key")
        shown = due
        setN(due)
      }
      if (shown < text.length) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [text, delay])

  const caretBefore = n > 0 && n < text.length && text[n] !== " " ? n : -1
  const caretAfter = n > 0 && (n === text.length || text[n] === " ") ? n - 1 : -1
  const caret = <span className={cn("type-caret", n === text.length && "type-caret-done")} aria-hidden="true" />
  // each word with the index of its first letter in the line
  const words = useMemo(
    () =>
      text
        .split(" ")
        .reduce<{ word: string; start: number }[]>(
          (all, word, w) => [...all, { word, start: w ? all[w - 1].start + all[w - 1].word.length + 1 : 0 }],
          [],
        ),
    [text],
  )
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {words.map(({ word, start }, w) => {
          return (
            <Fragment key={w}>
              <span className="whitespace-nowrap">
                {[...word].map((ch, k) => (
                  <Fragment key={k}>
                    {caretBefore === start + k && caret}
                    <span className={cn("type-letter", start + k < n && "type-on")}>{ch}</span>
                    {caretAfter === start + k && caret}
                  </Fragment>
                ))}
              </span>
              {w < words.length - 1 && " "}
            </Fragment>
          )
        })}
      </span>
    </>
  )
}

/** A scene of words: sentences one after another, each on its own row, coming toward the camera as it moves in. */
function Lines({
  sentences,
  delays,
  approach,
  onLanded,
  leaving = false,
}: {
  sentences: string[]
  delays: number[]
  approach: Approach
  onLanded?: () => void
  /** the words fade before the scene ends, so what follows has the screen to itself */
  leaving?: boolean
}) {
  useEffect(() => {
    if (!onLanded) return
    const last = sentences.length - 1
    const t = setTimeout(onLanded, typed(sentences[last], delays[last]) * 1000)
    return () => clearTimeout(t)
  }, [sentences, delays, onLanded])
  return (
    <motion.p
      // no will-change: a promoted layer keeps the text rasterized at its starting size, and it would end blurred.
      // Above the montage on purpose: its dark pool is a positioned layer, and in-flow text would sit under it, dimmed.
      className="pointer-events-none relative z-10 col-start-1 row-start-1 max-w-2xl text-statement text-balance"
      initial={{ scale: approach.from }}
      animate={{ scale: 1, opacity: leaving ? 0 : 1 }}
      transition={{ duration: approach.seconds, ease: approach.ease, opacity: { duration: 0.5, ease } }}
      exit={{ opacity: 0, y: -8, transition: { duration: 0.6, ease } }}
    >
      {sentences.map((s, i) => (
        <span key={i} className={i > 0 ? "mt-4 block" : "block"}>
          <Typed text={s} delay={delays[i]} />
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
    // Light, flower and sound are one gesture: the band of light enters the letters 1.27 s into the name (index.css,
    // .title-shine), the anemone unfurls with it and is open as the light leaves, and the harp shimmer in the score's
    // key rings from its first note as the light comes in.
    const t = setTimeout(() => setOpen(true), 1200)
    const light = setTimeout(() => cue("sweep"), 1270)
    return () => {
      clearTimeout(t)
      clearTimeout(light)
    }
  }, [quick])
  // the beats after the light has crossed the name
  const after = (k: number) => (quick ? 0.15 + k * 0.15 : 2.9 + k * 0.4)
  return (
    <motion.div
      className="pointer-events-auto relative z-10 col-start-1 row-start-1 flex flex-col items-center gap-5"
      exit={{ opacity: 0, y: -10, transition: { duration: 0.9 } }}
    >
      <motion.div
        // the bud rises softly into its place, and waits for the light
        initial={{ opacity: 0, scale: 0.85, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ delay: quick ? 0 : 0.2, duration: quick ? 0.5 : 0.9, ease }}
      >
        <Anemone state={open ? "open" : "bud"} size={96} />
      </motion.div>
      <motion.p
        className="-mb-3 text-title-2 font-medium text-dawn"
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
        <span className={lit ? "inline-block" : "title-sweep -m-[64px] inline-block p-[64px]"} onAnimationEnd={() => setLit(true)}>
          מקום לזכור
        </span>
        {!shone && (
          <span
            className="title-shine pointer-events-none absolute inset-0 [text-shadow:none]"
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
  // the film runs once the visitor has chosen how to watch it
  const [started, setStarted] = useState(quick)
  const choosing = useRef(false)
  const choose = async (sound: boolean) => {
    if (choosing.current) return
    choosing.current = true
    if (sound) await enableSound()
    else disableSound()
    setStarted(true)
  }
  // Time stops at 06:29 and comes back with "we won't forget", or with the name for anyone who skipped ahead.
  const [stopped, setStopped] = useState(false)
  const [resumed, setResumed] = useState(false)
  const held = stopped && !resumed && stage < NAME
  const back = stopped && !held
  const cta = useRef<HTMLButtonElement>(null)
  const stop = useCallback(() => setStopped(true), [])
  const resume = useCallback(() => setResumed(true), [])
  // once the words are complete they leave, and only then do the papers fall
  const [leaving, setLeaving] = useState(false)
  const [falling, setFalling] = useState(false)
  useEffect(() => {
    if (!resumed) return
    const leave = setTimeout(() => setLeaving(true), WORDS_LEAVE * 1000)
    const fall = setTimeout(() => setFalling(true), FALL_AFTER * 1000)
    return () => {
      clearTimeout(leave)
      clearTimeout(fall)
    }
  }, [resumed])
  // The montage is there from the start of the film, resting, so the count starts on the scene's clock and not late
  // by whatever mounting it would cost.
  const montage: MontageMode = stage === MOMENT ? "rest" : stage === TIME ? "count" : back && (falling || stage >= NAME) ? "fall" : "float"

  // The real sound follows time: night air until 06:29, cut dead when the clock stops, birds when time comes back.
  useEffect(() => {
    if (!started) return
    if (held) setBed(null, 0.03)
    else setBed(back ? "dawn" : "night", back ? 3 : 1.5)
  }, [started, held, back])

  // The score follows the scenes: each scene knows where in the music it begins, so the music is wherever the film is,
  // even when someone moves ahead with Enter or turns sound on midway.
  const scene = useRef({ stage, since: 0 })
  useEffect(() => {
    if (!started) return
    scene.current = { stage, since: performance.now() }
    setScoreClock(() => SCORE_AT[scene.current.stage] + (performance.now() - scene.current.since) / 1000)
    syncScore()
  }, [stage, started])

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
      if (!held) drift = window.setTimeout(() => m.startOrbit(), ORBIT_AFTER * 1000)
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
    const { fadeInLabels, flyToEnvelope, setTimeHeld, shiftLight, stopOrbit } = await import("@/map/controller")
    // the morning is heard coming, then the day is quiet; the score plays on into the sunrise only from the name,
    // where it has reached its dawn, and leaves with anyone who skips the film
    setBed("dawn", 1.5)
    if (stage < NAME) {
      setScoreClock(null)
      stopScore(1.5)
    }
    setTimeHeld(false)
    stopOrbit()
    setPhase("dawn")
    // One move of SUNRISE seconds: night warms to first light, then opens into morning; the camera flies to the envelope
    // over the same span, and the place names fade in once the line has been read.
    const ms = reducedMotion() ? 0 : 1000
    flyToEnvelope((SUNRISE.seconds - 0.2) * ms)
    setTimeout(() => fadeInLabels(1.2 * ms), SUNRISE.labels * ms)
    await shiftLight("first", SUNRISE.first * ms)
    await shiftLight("morning", (SUNRISE.seconds - SUNRISE.first) * ms)
    setPhase("day")
    setBed(null, 14)
    stopScore(8)
  }

  useEffect(() => {
    if (phase !== "intro") return
    if (stage >= NAME) {
      cta.current?.focus({ preventScroll: true })
      return
    }
    if (!started) return
    const t = setTimeout(() => setStage((s) => s + 1), HOLD_MS[stage])
    return () => clearTimeout(t)
  }, [stage, phase, started])

  useEffect(() => {
    if (phase !== "intro") return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void toMorning()
      // before the film starts, Enter belongs to the choice in focus
      if (!started) return
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

          {/* Sunrise: a warm light rises from behind the horizon (near the top of the frame, the camera looking low across
              the land) as a wide, flat glow, and gives way to the day. */}
          {phase === "dawn" && !reducedMotion() && (
            <motion.div
              className="absolute inset-x-[-30%] top-[-4%] h-[48%] rounded-[50%] bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--p-sun-200)_70%,transparent),color-mix(in_oklab,var(--p-sun-300)_30%,transparent)_45%,transparent_75%)] will-change-[transform,opacity]"
              initial={{ y: 90, scaleY: 0.6, opacity: 0 }}
              animate={{ y: 0, scaleY: 1, opacity: [0, 0.9, 0.7, 0] }}
              transition={{ duration: SUNRISE.seconds, ease: [0.3, 0, 0.2, 1], times: [0, 0.35, 0.75, 1] }}
              aria-hidden="true"
            />
          )}

          {inIntro && started && <SoundToggle />}
          {inIntro && (
            <button
              onClick={toMorning}
              className="pressable pointer-events-auto absolute top-5 left-5 z-10 rounded-full px-3 py-1.5 text-label text-white/70 hover:bg-white/10 hover:text-white"
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
            {inIntro && !quick && started && (
              <Suspense fallback={null}>
                <Montage mode={montage} days={days} count={COUNT} />
              </Suspense>
            )}
            <AnimatePresence>
              {inIntro && stage <= TIME && <Clock key="clock" running={started} stepBack={stage === TIME} onStop={stop} />}
              {inIntro && !started && <Choice key="choice" onChoose={choose} />}
              {inIntro && started && stage === MOMENT && <Moment key="moment" />}
              {inIntro && stage === SINCE && <Lines key="since" sentences={SINCE_LINES} delays={SINCE_DELAYS} approach={SINCE_APPROACH} />}
              {inIntro && stage === REMEMBER && (
                <Lines
                  key="remember"
                  sentences={REMEMBER_LINES}
                  delays={REMEMBER_DELAYS}
                  approach={REMEMBER_APPROACH}
                  onLanded={resume}
                  leaving={leaving}
                />
              )}
              {inIntro && stage === NAME && <Name key="name" quick={quick} count={count} cta={cta} onMorning={toMorning} />}
              {phase === "dawn" && (
                <motion.p
                  key="dawn"
                  className="col-start-1 row-start-1 max-w-2xl text-statement text-balance text-white [text-shadow:0_2px_28px_color-mix(in_oklab,var(--p-ink-950)_70%,transparent),0_1px_3px_color-mix(in_oklab,var(--p-ink-950)_55%,transparent)]"
                  initial={{ opacity: 0, y: 8 }}
                  // after the name has gone (its exit takes 0.9 s), and long enough to be read: 3.9 s at full strength
                  animate={{
                    opacity: [0, 1, 1, 0],
                    y: 0,
                    transition: { duration: SUNRISE.line.seconds, times: [0, 0.15, 0.85, 1], delay: SUNRISE.line.delay },
                  }}
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
