import { useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Anemone } from "@/components/anemone"
import { useStore } from "@/store"
import { spring } from "@/lib/motion"

/**
 * Leaving an anemone: the quiet gesture a visitor can make at a place.
 * Each one blooms into a small row of flowers kept on this device.
 */
// where each petal drifts: [x, y, rotation]
const PETALS: [number, number, number][] = [
  [-26, -38, -80],
  [-10, -52, 40],
  [12, -46, 120],
  [28, -30, -30],
  [-32, -14, 160],
  [22, -60, -140],
]

export function Tribute({ placeId }: { placeId: string }) {
  const count = useStore((s) => s.tributes[placeId] ?? 0)
  const leave = useStore((s) => s.leaveAnemone)
  const [burst, setBurst] = useState(0)
  const shown = Math.min(count, 9)

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => {
          leave(placeId)
          setBurst((b) => b + 1)
          navigator.vibrate?.(12)
        }}
        className="pressable group relative flex h-12 shrink-0 items-center gap-2.5 rounded-full bg-surface ps-2 pe-5 text-label font-bold text-ink-1 ring-1 ring-line-strong hover:ring-brand/50"
      >
        <span className="relative grid size-9 place-items-center">
          <Anemone state="open" size={30} />
          {/* a handful of petals let go from the flower and drift up */}
          <AnimatePresence>
            {burst > 0 && (
              <motion.span
                key={burst}
                className="pointer-events-none absolute inset-0"
                initial={{ opacity: 1 }}
                animate={{ opacity: 0 }}
                transition={{ delay: 0.9, duration: 0.4 }}
              >
                {PETALS.map(([dx, dy, rot], i) => (
                  <motion.svg
                    key={i}
                    viewBox="-10 -16 20 18"
                    className="absolute top-1/2 left-1/2 size-3 -translate-x-1/2 -translate-y-1/2"
                    initial={{ x: 0, y: 0, rotate: 0, scale: 0.4, opacity: 0 }}
                    animate={{ x: dx, y: dy, rotate: rot, scale: 1, opacity: [0, 1, 1, 0] }}
                    transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: i * 0.02 }}
                  >
                    <path d="M0 0 C -6 -3 -9 -9 -6 -14 C -3 -17 3 -17 6 -14 C 9 -9 6 -3 0 0 Z" fill="var(--brand)" />
                  </motion.svg>
                ))}
              </motion.span>
            )}
          </AnimatePresence>
        </span>
        השארת כלנית
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex h-6 items-center -space-x-1.5 rtl:space-x-reverse" aria-hidden="true">
          <AnimatePresence initial={false}>
            {Array.from({ length: shown }, (_, i) => (
              <motion.span key={i} initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={spring.bouncy}>
                <Anemone state="open" size={20} />
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
        <p className="text-caption text-ink-2" aria-live="polite">
          {count === 0 ? "נשמר רק במכשיר הזה" : count === 1 ? "השארתם כאן כלנית אחת" : `השארתם כאן ${count} כלניות`}
        </p>
      </div>
    </div>
  )
}
