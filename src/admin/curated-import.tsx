import { useRef, useState } from "react"
import { ChevronDown, CircleCheck, FileJson, LoaderCircle, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { Alert, Section, block, card } from "./ui"
import { importCurated } from "../../scripts/curated-import.mjs"
import { MAX_PACKET_BYTES, readImportPacket } from "./import-packet"

export function CuratedImport() {
  const [packet, setPacket] = useState<ReturnType<typeof readImportPacket> | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const selection = useRef(0)
  async function choose(file: File | undefined) {
    const id = ++selection.current
    setPacket(null)
    setMessage("")
    setError("")
    if (!file) return
    try {
      if (file.size > MAX_PACKET_BYTES) throw new Error("קובץ היבוא גדול מדי.")
      const next = readImportPacket(await file.text())
      if (id === selection.current) setPacket(next)
    } catch (e) {
      if (id === selection.current) setError(e instanceof Error ? e.message : "לא ניתן לקרוא את הקובץ.")
    }
  }
  async function publish() {
    if (!packet || busy) return
    setBusy(true)
    setError("")
    setMessage("מייבאים את המקומות. השאירו את העמוד פתוח.")
    try {
      const result = await importCurated({
        fetch: (url, init) => fetch(url, { ...init, credentials: "same-origin", redirect: "error" }),
        base: location.origin,
        records: packet.places,
        headers: {},
        readPhoto: async (file) => {
          const picture = packet.pictures.get(file)
          if (!picture) throw new Error("missing_picture")
          return picture
        },
      })
      setMessage(`היבוא הושלם: ${result.created.length} מקומות פורסמו, ${result.skipped.length} מקומות קיימים נשארו ללא שינוי.`)
    } catch {
      setMessage("")
      setError(
        "היבוא נעצר. מקומות שכבר פורסמו נשמרו. בדקו את החיבור ואת כניסת המנהל; לאחר מכן אפשר להמשיך עם אותו קובץ. מקומות קיימים לא ישתנו.",
      )
    } finally {
      setBusy(false)
    }
  }
  const done = !busy && message.startsWith("היבוא הושלם")
  return (
    <Section id="import" title="יבוא מקומות האתר" lead="מקומות שהאתר עצמו מביא, מקובץ שהוכן מראש עם המקורות, התמונות והרישיונות.">
      <div className={cn(card, "flex flex-col gap-4")}>
        <p className="reading-copy text-body text-ink-2">
          בחרו קובץ יבוא עם המקורות, התמונות והרישיונות. הפרסום משתמש במסלול האישור הרגיל. מקומות שכבר קיימים לא ייערכו.
        </p>
        <div className="flex flex-col gap-2">
          <label htmlFor="curated-import-file" className="text-label font-medium text-ink-1">
            קובץ יבוא JSON
          </label>
          <Input
            id="curated-import-file"
            type="file"
            accept="application/json,.json"
            disabled={busy}
            className="h-auto cursor-pointer py-2 file:me-3 file:h-8 file:cursor-pointer file:rounded-full file:bg-surface-2 file:px-4 file:text-label file:text-ink-1"
            onChange={(e) => void choose(e.target.files?.[0])}
          />
        </div>
        {packet && (
          <div className={cn(block, "mt-1 flex flex-col gap-4")}>
            <p className="flex items-center gap-2 text-body text-ink-1">
              <FileJson aria-hidden className="size-4 shrink-0 text-ink-2" />
              מוכנים לפרסום: {packet.places.length} מקומות ו־{packet.photoCount} תמונות.
            </p>
            <details className="group rounded-2xl border border-line">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-label text-ink-1 [&::-webkit-details-marker]:hidden">
                הצגת רשימת המקומות
                <ChevronDown
                  aria-hidden
                  className="size-4 text-ink-3 transition-transform duration-300 group-open:rotate-180 motion-reduce:transition-none"
                />
              </summary>
              <ul className="max-h-64 divide-y divide-line overflow-auto border-t border-line px-4 text-body">
                {packet.places.map((p) => (
                  <li key={p.id} className="py-2">
                    {p.name_he}
                  </li>
                ))}
              </ul>
            </details>
            <Button className="pressable self-start" disabled={busy} onClick={() => void publish()}>
              {busy ? <LoaderCircle aria-hidden className="animate-spin" /> : <Upload aria-hidden />}
              פרסום המקומות שנבחרו
            </Button>
          </div>
        )}
        {message && (
          <p role="status" className={cn("flex items-start gap-2.5 text-body", done ? "text-ink-1" : "text-ink-2")}>
            {done ? (
              <CircleCheck aria-hidden className="mt-1 size-4 shrink-0 text-hope" />
            ) : (
              <LoaderCircle aria-hidden className="mt-1 size-4 shrink-0 animate-spin" />
            )}
            {message}
          </p>
        )}
        {error && <Alert>{error}</Alert>}
      </div>
    </Section>
  )
}
