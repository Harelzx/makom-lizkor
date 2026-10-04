import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useEffect, useState } from "react"
import { useStore } from "@/store"

const PETAL = "M0 0 C -6 -3 -9 -9 -6 -14 C -3 -17 3 -17 6 -14 C 9 -9 6 -3 0 0 Z"
const COLORS = ["#d71a33", "#b70f28", "#f04a5c", "#8e0c21"]

/** When a family adds a place, petals open outward from where the new flower lands. */
export function Celebration() {
  const n = useStore((s) => s.celebration)
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(0)

  useEffect(() => {
    if (!n || reduce) return
    // wait for the camera to begin its flight to the new flower
    const t1 = setTimeout(() => setShown(n), 900)
    const t2 = setTimeout(() => setShown(0), 3200)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [n, reduce])

  return (
    <AnimatePresence>
      {shown > 0 && (
        <motion.div
          key={shown}
          className="pointer-events-none fixed inset-0 z-30 grid place-items-center"
          exit={{ opacity: 0, transition: { duration: 0.6 } }}
          aria-hidden="true"
        >
          {Array.from({ length: 22 }, (_, i) => {
            const a = (i / 22) * Math.PI * 2 + (i % 2) * 0.2
            const dist = 110 + (i % 5) * 34
            return (
              <motion.svg
                key={i}
                viewBox="-10 -18 20 20"
                className="absolute size-5"
                initial={{ x: 0, y: 0, scale: 0.2, rotate: 0, opacity: 0 }}
                animate={{
                  x: Math.cos(a) * dist,
                  y: Math.sin(a) * dist + 40,
                  scale: 1 + (i % 3) * 0.25,
                  rotate: (i % 2 ? 1 : -1) * 200,
                  opacity: [0, 1, 1, 0],
                }}
                transition={{ duration: 1.9, ease: [0.16, 1, 0.3, 1], times: [0, 0.15, 0.7, 1] }}
              >
                <path d={PETAL} fill={COLORS[i % COLORS.length]} />
              </motion.svg>
            )
          })}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
