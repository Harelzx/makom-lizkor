import { animate, motion, useInView, useReducedMotion } from "motion/react"
import { useEffect, useRef, useState } from "react"
import { ExternalLinkIcon } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { RETURN_LABEL } from "@/data/taxonomy"
import context from "@/data/context.json"
import { useStore } from "@/store"
import { cn } from "@/lib/utils"
import { spring } from "@/lib/motion"

const ORDER = { full: 0, partial: 1, "not-yet": 2, unknown: 3 } as const

/**
 * The state of the return, in one line of dots: one per community, filled as people come home.
 * Sourced from the Tkuma Authority's September 2026 figures.
 */
/**
 * The strip plays its entrance once per visit. The tab and the phone sheet remount it often (switching tabs,
 * closing the add dialog), and counting up from zero every time would turn a moment into a tic.
 */
let played = false

/** A number that counts up once, the first time it scrolls into view. */
function CountUp({ to, still }: { to: number; still: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  const [v, setV] = useState(0)
  useEffect(() => {
    if (!inView || still) return
    const c = animate(0, to, { duration: 1.4, ease: [0.16, 1, 0.3, 1], onUpdate: (x) => setV(Math.round(x)) })
    return () => c.stop()
  }, [inView, to, still])
  return (
    <span ref={ref} className="tabular-nums">
      {still ? to : v}
    </span>
  )
}

export function RevivalStrip() {
  const select = useStore((s) => s.select)
  const reduce = useReducedMotion()
  const [replay] = useState(() => played)
  const still = replay || !!reduce
  useEffect(() => {
    played = true
  }, [])
  const communities = useStore((s) => s.remote)
    .filter((p) => p.kind === "community" && p.revival)
    .sort((a, b) => ORDER[a.revival!.status] - ORDER[b.revival!.status] || b.lat - a.lat)
  const home = communities.filter((c) => c.revival!.status === "full").length
  const tkuma = (context as { tkuma?: { sources: { label_he: string; url: string }[] } }).tkuma

  return (
    <section className="flex flex-col gap-3 px-3 pt-2 pb-3" aria-labelledby="revival-strip">
      <h3 id="revival-strip" className="text-title-3 text-balance text-ink-1">
        יותר מ־
        <CountUp to={90} still={still} />% מהמפונים כבר חזרו הביתה.
      </h3>
      <div className="flex flex-wrap gap-1.5" role="list" aria-label={`${home} מתוך ${communities.length} קהילות חזרו הביתה`}>
        {communities.map((c, i) => (
          <Tooltip key={c.id}>
            <TooltipTrigger asChild>
              <motion.button
                role="listitem"
                onClick={() => select(c.id)}
                initial={still ? false : { scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                whileHover={{ scale: 1.3 }}
                whileTap={{ scale: 0.9 }}
                transition={{ delay: 0.12 + i * 0.035, ...spring.bouncy }}
                aria-label={`${c.name_he}: ${RETURN_LABEL[c.revival!.status]}`}
                className={cn(
                  "relative size-5 rounded-full border-2 border-hope outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  c.revival!.status === "full" && "bg-hope",
                  c.revival!.status === "partial" && "bg-[linear-gradient(90deg,transparent_50%,var(--hope)_50%)]",
                  c.revival!.status === "not-yet" && "border-dashed",
                )}
              />
            </TooltipTrigger>
            <TooltipContent>
              {c.name_he}: {RETURN_LABEL[c.revival!.status]}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <p className="text-caption text-pretty text-ink-2">
        עיגול מלא: הקהילה חזרה הביתה. חצי: החזרה בעיצומה. ריק: עדיין בדרך הביתה. בעוטף חיים היום כ־66 אלף תושבים, כ־5,000 יותר מערב המתקפה.{" "}
        {tkuma?.sources?.[2] && (
          <a
            href={tkuma.sources[2].url}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-0.5 underline underline-offset-2"
          >
            מקור: מנהלת תקומה, ספטמבר 2026
            <ExternalLinkIcon className="size-3" />
          </a>
        )}
      </p>
    </section>
  )
}
