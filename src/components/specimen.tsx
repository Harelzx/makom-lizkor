import { useEffect, useState } from "react"
import { Anemone } from "@/components/anemone"

/** Dev-only sheet for judging the flower at every size and state: open /?specimen */
export function Specimen() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setOpen(true), 600)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="flex min-h-svh flex-col gap-10 overflow-auto bg-[#ece6da] p-10">
      {[false, true].map((dark) => (
        <div key={String(dark)} className={`flex flex-wrap items-end gap-10 rounded-3xl p-8 ${dark ? "bg-[#18202f]" : "bg-[#ece6da]"}`}>
          {[18, 26, 34, 56, 120, 260].map((s) => (
            <Anemone key={s} size={s} state={open ? "open" : "bud"} />
          ))}
          <Anemone size={120} state="selected" />
          <Anemone size={120} variant="pale" />
          <Anemone size={120} state="bud" />
        </div>
      ))}
    </div>
  )
}
