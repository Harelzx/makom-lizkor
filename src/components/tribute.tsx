import { useEffect, useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import { Anemone } from "@/components/anemone"
import { useStore } from "@/store"
import { jerusalemDay } from "@/lib/jerusalem-day"
import { spring } from "@/lib/motion"
import { canShare, queueTribute, shared } from "@/lib/tributes"

/** At most this many flowers stand beside the button; the words say how many there are. */
const ROW = 7

/**
 * Leaving an anemone: the quiet gesture a visitor can make at a place, once a day, like lighting a candle.
 * The flower is planted in a small row beside the button, where it opens and stays lit for the day. At a place
 * published on the server it also joins the shared count (spec 4), which counts one a day from each device; elsewhere,
 * or when the browser keeps nothing, it stays here.
 */
export function Tribute({ placeId }: { placeId: string }) {
  const reduce = useReducedMotion()
  const count = useStore((s) => s.tributes[placeId] ?? 0)
  const leftToday = useStore((s) => s.tributeDays[placeId] === jerusalemDay())
  const leave = useStore((s) => s.leaveAnemone)
  const total = useStore((s) => s.tributeTotals[placeId] ?? 0)
  // Set by a tap in this visit, so the flower opens in front of the visitor; reopened later, it is already open.
  const [planted, setPlanted] = useState(false)
  // Whether this browser keeps the device id the shared count needs; until known, the flowers count as local.
  const [sharing, setSharing] = useState(false)
  useEffect(() => {
    let live = true
    if (shared(placeId)) void canShare().then((v) => live && setSharing(v))
    return () => {
      live = false
    }
  }, [placeId])
  const counts = shared(placeId) && sharing
  // Everyone's flowers where they are counted, the visitor's own otherwise. Today's is in it even before the server's
  // answer comes back.
  const flowers = counts ? Math.max(total, leftToday ? 1 : 0) : count
  const others = Math.min(flowers - (leftToday ? 1 : 0), ROW - 1)

  return (
    // One line, as quiet as lighting a candle: the button, and beside it the flowers left here and how many.
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={leftToday}
        onClick={() => {
          if (!leave(placeId)) return
          void queueTribute(placeId)
          setPlanted(true)
          navigator.vibrate?.(12)
        }}
        className="pressable group relative flex h-12 shrink-0 items-center gap-2.5 rounded-full bg-fill ps-2 pe-5 text-label font-bold text-ink-1 disabled:pointer-events-none disabled:font-normal disabled:text-ink-2 [@media(hover:hover)]:hover:bg-fill-2"
      >
        <span className="relative grid size-9 place-items-center">
          <Anemone state="open" size={30} className={leftToday ? "opacity-40" : undefined} />
        </span>
        {leftToday ? "השארתם היום" : "השארת כלנית"}
      </button>
      <div className="min-w-0 flex-1 text-caption text-ink-2">
        {flowers > 0 && (
          <div className="flex h-9 items-center -space-x-2 rtl:space-x-reverse" aria-hidden="true">
            {leftToday && <Lit fresh={planted && !reduce} />}
            {Array.from({ length: Math.max(others, 0) }, (_, i) => (
              <span key={i} className="grid size-7 place-items-center">
                <Anemone state="open" size={24} detail="lite" />
              </span>
            ))}
          </div>
        )}
        <div aria-live="polite">
          {flowers === 0 ? (
            <p>כמו נר, לזכרם</p>
          ) : counts ? (
            <>
              <p className="text-label text-ink-1">
                {flowers === 1 ? "השאירו כאן כלנית אחת" : `השאירו כאן ${flowers.toLocaleString("he-IL")} כלניות`}
              </p>
              {leftToday && <p>{flowers === 1 ? "הכלנית שלכם, מהיום" : "אחת מהן שלכם, מהיום"}</p>}
            </>
          ) : (
            <>
              <p className="text-label text-ink-1">{count === 1 ? "השארתם כאן כלנית אחת" : `השארתם כאן ${count} כלניות`}</p>
              <p>נשמר רק במכשיר הזה</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Today's flower, first in the row, with a warm light behind it like a memorial candle's. Planted by a tap, it rises
 * into its place as a bud and opens there while the light comes up.
 */
function Lit({ fresh }: { fresh: boolean }) {
  const [open, setOpen] = useState(!fresh)
  useEffect(() => {
    if (open) return
    const t = window.setTimeout(() => setOpen(true), 180)
    return () => window.clearTimeout(t)
  }, [open])
  return (
    <motion.span
      className="relative z-10 grid size-9 place-items-center"
      initial={fresh ? { opacity: 0, y: 10, scale: 0.6 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring.bouncy}
    >
      <motion.span
        className="absolute -inset-2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--brand)_38%,transparent),transparent)]"
        initial={fresh ? { opacity: 0, scale: 0.5 } : false}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.4, ease: "easeOut", delay: fresh ? 0.3 : 0 }}
      />
      <Anemone state={open ? "open" : "bud"} size={32} className="relative" />
    </motion.span>
  )
}
