import { useEffect, useId, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { Anemone } from "@/components/anemone"
import { useStore } from "@/store"
import { spring } from "@/lib/motion"
import { canShare, queueTribute, shared } from "@/lib/tributes"
import { CARD } from "@/components/kit"
import { cn } from "@/lib/utils"

/**
 * Leaving an anemone: the quiet gesture a visitor can make at a place.
 * Each one blooms into a small row of flowers kept on this device. At a place published on the server, one a day from
 * this device also joins the shared count (spec 4); elsewhere, or when the browser keeps nothing, they stay here.
 */
export function Tribute({ placeId }: { placeId: string }) {
  const uid = useId()
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
  const shown = Math.min(count, 9)

  return (
    // A button alone said what to press, not what it means: a candle is understood at once, a flower is not. The site keeps
    // the anemone (its own sign, the flower that comes back to the south every winter, and no one's ritual), and says
    // what it stands for, with the count of everyone who left one here.
    <section aria-labelledby={`${uid}-title`} className={cn(CARD, "flex flex-col gap-3 p-4")}>
      <div className="flex flex-col gap-1">
        <h3 id={`${uid}-title`} className="text-headline text-ink-1">
          כלנית במקום נר
        </h3>
        <p className="text-body text-pretty text-ink-2">
          הכלנית חוזרת לפרוח בדרום בכל חורף. משאירים אחת לזכרם, וכל מי שמגיע לכאן רואה כמה הושארו.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={() => {
            leave(placeId)
            void queueTribute(placeId)
            setBurst((b) => b + 1)
            navigator.vibrate?.(12)
          }}
          className="pressable group relative flex h-12 shrink-0 items-center gap-2.5 rounded-full bg-raised ps-2 pe-5 text-label font-bold text-ink-1 ring-1 ring-line-strong hover:ring-brand/50"
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

        <div className="min-w-[8rem] flex-1">
          <div className="flex h-6 items-center -space-x-1.5 rtl:space-x-reverse" aria-hidden="true">
            <AnimatePresence initial={false}>
              {Array.from({ length: shown }, (_, i) => (
                <motion.span key={i} initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={spring.bouncy}>
                  <Anemone state="open" size={20} />
                </motion.span>
              ))}
            </AnimatePresence>
          </div>
          {/* everyone's flowers first: they are what gives one more its meaning */}
          {shared(placeId) && total > 0 && (
            <p className="text-label text-ink-1">
              {total === 1 ? "השאירו כאן כלנית אחת" : `השאירו כאן ${total.toLocaleString("he-IL")} כלניות`}
            </p>
          )}
          <p className="text-caption text-ink-2" aria-live="polite">
            {count === 0
              ? counts
                ? "כלנית אחת ביום מהמכשיר הזה נספרת לכולם"
                : "נשמר רק במכשיר הזה"
              : count === 1
                ? "השארתם כאן כלנית אחת"
                : `השארתם כאן ${count} כלניות`}
          </p>
          {count > 0 && !counts && <p className="text-caption text-ink-2">נשמר רק במכשיר הזה</p>}
        </div>
      </div>
    </section>
  )
}
