import { useEffect, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { Anemone } from "@/components/anemone"
import { useStore } from "@/store"
import { canShare, queueTribute, shared } from "@/lib/tributes"

/**
 * Leaving an anemone: the quiet gesture a visitor can make at a place.
 * Each one is kept on this device and counted beside the button. At a place published on the server, one a day from
 * this device also joins the shared count (spec 4); elsewhere, or when the browser keeps nothing, they stay here.
 */
export function Tribute({ placeId }: { placeId: string }) {
  const reduce = useReducedMotion()
  const count = useStore((s) => s.tributes[placeId] ?? 0)
  const leave = useStore((s) => s.leaveAnemone)
  const total = useStore((s) => s.tributeTotals[placeId] ?? 0)
  const [burst, setBurst] = useState(0)
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

  return (
    // One line, as quiet as lighting a candle: the button, and beside it what it is, or how many have been left. A card
    // with a heading and an explanation said more than the gesture needs.
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => {
          leave(placeId)
          void queueTribute(placeId)
          setBurst((b) => b + 1)
          navigator.vibrate?.(12)
        }}
        className="pressable group relative flex h-12 shrink-0 items-center gap-2.5 rounded-full bg-fill ps-2 pe-5 text-label font-bold text-ink-1 [@media(hover:hover)]:hover:bg-fill-2"
      >
        <span className="relative grid size-9 place-items-center">
          <Anemone state="open" size={30} />
          <AnimatePresence>
            {burst > 0 && !reduce && (
              <motion.span
                key={burst}
                className="pointer-events-none absolute inset-0 rounded-full border border-brand/30"
                initial={{ scale: 0.8, opacity: 0.7 }}
                animate={{ scale: 1.5, opacity: 0 }}
                transition={{ duration: 0.6 }}
              />
            )}
          </AnimatePresence>
        </span>
        השארת כלנית
      </button>
      <div className="min-w-0 flex-1 text-caption text-ink-2" aria-live="polite">
        {/* everyone's flowers first: they are what gives one more its meaning */}
        {shared(placeId) && total > 0 ? (
          <p className="text-label text-ink-1">
            {total === 1 ? "השאירו כאן כלנית אחת" : `השאירו כאן ${total.toLocaleString("he-IL")} כלניות`}
          </p>
        ) : (
          count === 0 && <p>כמו נר, לזכרם</p>
        )}
        {count > 0 && <p>{count === 1 ? "השארתם כאן כלנית אחת" : `השארתם כאן ${count} כלניות`}</p>}
        {count > 0 && !counts && <p>נשמר רק במכשיר הזה</p>}
      </div>
    </div>
  )
}
