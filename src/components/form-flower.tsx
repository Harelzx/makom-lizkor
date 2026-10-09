import { useState } from "react"
import { useReducedMotion } from "motion/react"

const ART = ["/art/bud.webp", "/art/anemone-watercolor.webp", "/art/bouquet.webp"]

/** Keep decoded bitmaps mounted. A slow next image must never remove the flower already on screen. */
export function FormFlower({ step }: { step: number }) {
  const lessMotion = useReducedMotion()
  const [ready, setReady] = useState<boolean[]>([false, false, false])
  const [shown, setShown] = useState(0)
  if (ready[step] && shown !== step) setShown(step)

  return (
    <div className="absolute inset-y-2 start-1/2 isolate w-28 -translate-x-1/2 sm:start-auto sm:end-8 sm:w-32 sm:translate-x-0 rtl:translate-x-1/2 rtl:sm:translate-x-0">
      {ART.map((src, i) => (
        <img
          key={src}
          src={src}
          alt=""
          decoding="async"
          onLoad={(e) => {
            const img = e.currentTarget
            // Decoding, not merely download completion, is the point at which a bitmap can be painted.
            void img
              .decode()
              .then(() => setReady((old) => old.map((v, n) => n === i || v)))
              .catch(() => undefined)
          }}
          data-add-art={i === shown ? "" : undefined}
          className="absolute inset-0 size-full object-contain transition-opacity ease-out will-change-[opacity]"
          style={{ opacity: i === shown ? 1 : 0, transitionDuration: lessMotion ? "0s" : "400ms", transform: "translateZ(0)" }}
        />
      ))}
    </div>
  )
}
