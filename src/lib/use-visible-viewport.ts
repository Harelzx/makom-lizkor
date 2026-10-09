import { useEffect, useState } from "react"

/** iOS can keep the layout viewport tall when its keyboard opens. Center the form in the area still visible. */
const measure = () => ({ height: window.visualViewport?.height ?? window.innerHeight, top: window.visualViewport?.offsetTop ?? 0 })

export function useVisibleViewport(active: boolean) {
  const [visible, setVisible] = useState(measure)
  useEffect(() => {
    if (!active) return
    const viewport = window.visualViewport
    const update = () => setVisible(measure())
    const frame = requestAnimationFrame(update)
    viewport?.addEventListener("resize", update)
    viewport?.addEventListener("scroll", update)
    window.addEventListener("resize", update)
    return () => {
      cancelAnimationFrame(frame)
      viewport?.removeEventListener("resize", update)
      viewport?.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
    }
  }, [active])
  return visible
}
