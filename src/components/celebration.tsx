import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useEffect, useState } from "react"
import { Anemone } from "@/components/anemone"
import { useStore } from "@/store"

/** One quiet acknowledgement, only after the server accepted a submission. */
export function Celebration() {
  const n = useStore((s) => s.celebration)
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (!n || reduce) return
    const start = setTimeout(() => setShown(n), 150)
    const stop = setTimeout(() => setShown(0), 1100)
    return () => {
      clearTimeout(start)
      clearTimeout(stop)
    }
  }, [n, reduce])
  return (
    <AnimatePresence>
      {shown > 0 && !reduce && (
        <motion.div
          key={shown}
          className="pointer-events-none fixed inset-0 z-40 grid place-items-center"
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
          transition={{ duration: 0.22 }}
          aria-hidden="true"
        >
          <span className="grid size-20 place-items-center rounded-full bg-surface/95 shadow-chip">
            <Anemone size={48} state="open" />
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
