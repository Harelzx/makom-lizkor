import { useEffect, useMemo } from "react"
import { AnimatePresence, motion } from "motion/react"
import { ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon, RouteIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { KINDS } from "@/data/taxonomy"
import { journeyStops, useStore } from "@/store"
import { flyToEnvelope, getMap, isMobile, reducedMotion } from "@/map/controller"
import { Img, SafetyNote } from "@/components/kit"

const DWELL = 9000

/** A quiet passage north to south along Route 232, from Zikim to Kerem Shalom. */
export function Journey() {
  // The site's own places come with the feed; until it has come, the journey has no stops yet.
  const remote = useStore((s) => s.remote)
  const stops = useMemo(() => journeyStops(remote), [remote])
  const index = useStore((s) => s.journeyIndex)
  const playing = useStore((s) => s.journeyPlaying)
  const setJourney = useStore((s) => s.setJourney)
  const stop = index >= 0 ? stops[index] : null

  // Camera: a low, slow approach to each stop, turning a little each time.
  useEffect(() => {
    if (!stop) return
    useStore.setState({ selectedId: stop.id })
    getMap()?.flyTo({
      center: [stop.lng, stop.lat],
      zoom: stop.kind === "community" ? 14 : 15.6,
      pitch: 66,
      bearing: -30 + index * 9,
      padding: isMobile()
        ? { top: 60, bottom: window.innerHeight * 0.45, left: 0, right: 0 }
        : { top: 40, bottom: 40, left: 40, right: 460 },
      duration: reducedMotion() ? 0 : 5200,
      curve: 1.25,
      essential: false,
    })
  }, [stop, index])

  useEffect(() => {
    if (!playing || index < 0) return
    const t = setTimeout(() => {
      if (index < stops.length - 1) setJourney(index + 1)
      else setJourney(index, false)
    }, DWELL)
    return () => clearTimeout(t)
  }, [playing, index, stops.length, setJourney])

  // Leaving the tab ends the journey.
  useEffect(
    () => () => {
      useStore.getState().setJourney(-1, false)
    },
    [],
  )

  if (index < 0)
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3 px-1">
          <RouteIcon className="size-6 text-brand" />
          <h3 className="text-title-2 text-ink-1">לאורך כביש 232</h3>
          <p className="text-body text-pretty text-ink-2">
            {stops.length} עצירות, מצפון לדרום: מחוף זיקים, דרך שדרות והקיבוצים, עד כרם שלום. המצלמה נעה ממקום למקום, ואפשר לעצור בכל רגע.
          </p>
          <SafetyNote lead="המסע עובר לאורך גבול עזה." />
          <Button size="lg" variant="brand" className="mt-1 self-start rounded-full px-5" onClick={() => setJourney(0, !reducedMotion())}>
            <PlayIcon data-icon="inline-start" />
            יציאה למסע
          </Button>
        </div>
        <ol className="flex flex-col">
          {stops.map((s, i) => (
            <li key={s.id}>
              <button
                onClick={() => setJourney(i, false)}
                className="pressable flex w-full items-center gap-3 rounded-xl px-2 py-2 text-start hover:bg-surface-2"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-caption font-bold text-ink-2 tabular-nums">
                  {i + 1}
                </span>
                <span className="truncate text-body font-medium text-ink-1">{s.name_he}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    )

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-1" aria-hidden="true">
        {stops.map((s, i) => (
          <span key={s.id} className="relative h-1 flex-1 overflow-hidden rounded-full bg-line-strong">
            {i < index && <span className="absolute inset-0 bg-brand" />}
            {i === index && (
              <motion.span
                key={`${index}-${playing}`}
                className="absolute inset-0 origin-right bg-brand"
                initial={{ scaleX: playing ? 0 : 1 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: playing ? DWELL / 1000 : 0, ease: "linear" }}
              />
            )}
          </span>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {stop && (
          <motion.div
            key={stop.id}
            className="flex flex-col gap-3"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0, transition: { delay: 0.6, duration: 0.6 } }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.3 } }}
            aria-live="polite"
          >
            <p className="text-caption font-bold text-brand tabular-nums">
              עצירה {index + 1} מתוך {stops.length} · {KINDS[stop.kind].label}
            </p>
            <h3 className="text-title-2 text-balance text-ink-1">{stop.name_he}</h3>
            <p className="text-label font-normal text-ink-2">{stop.place_he}</p>
            {stop.photos?.[0] && (
              <Img src={stop.photos[0].url} alt={stop.photos[0].subject_he} className="aspect-[16/10] w-full rounded-3xl object-cover" />
            )}
            <p className="text-body-lg text-pretty text-ink-1">{stop.summary_he}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="icon-lg"
            className="rounded-full"
            aria-label="העצירה הקודמת"
            disabled={index === 0}
            onClick={() => setJourney(index - 1)}
          >
            <ChevronRightIcon />
          </Button>
          <Button
            size="icon-lg"
            variant="brand"
            className="rounded-full"
            aria-label={playing ? "השהיה" : "המשך"}
            onClick={() => setJourney(index, !playing)}
          >
            {playing ? <PauseIcon /> : <PlayIcon className="rtl:-scale-x-100" />}
          </Button>
          <Button
            variant="secondary"
            size="icon-lg"
            className="rounded-full"
            aria-label="העצירה הבאה"
            disabled={index === stops.length - 1}
            onClick={() => setJourney(index + 1)}
          >
            <ChevronLeftIcon />
          </Button>
        </div>
        <Button
          variant="ghost"
          className="text-label text-ink-2"
          onClick={() => {
            setJourney(-1, false)
            useStore.setState({ selectedId: null })
            flyToEnvelope(2400)
          }}
        >
          סיום המסע
        </Button>
      </div>
    </div>
  )
}
