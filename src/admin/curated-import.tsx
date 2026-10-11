import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
  return (
    <section className="flex flex-col gap-4 rounded-3xl border border-line bg-surface p-5" aria-labelledby="curated-import-title">
      <h2 id="curated-import-title" className="text-title font-bold">
        יבוא מקומות האתר
      </h2>
      <p className="text-body text-ink-2">
        בחרו קובץ יבוא עם המקורות, התמונות והרישיונות. הפרסום משתמש במסלול האישור הרגיל. מקומות שכבר קיימים לא ייערכו.
      </p>
      <label htmlFor="curated-import-file" className="text-label font-medium">
        קובץ יבוא JSON
      </label>
      <Input
        id="curated-import-file"
        type="file"
        accept="application/json,.json"
        disabled={busy}
        onChange={(e) => void choose(e.target.files?.[0])}
      />
      {packet && (
        <>
          <p className="text-body">
            מוכנים לפרסום: {packet.places.length} מקומות ו־{packet.photoCount} תמונות.
          </p>
          <details className="rounded-2xl border border-line p-3">
            <summary className="cursor-pointer text-label">הצגת רשימת המקומות</summary>
            <ul className="mt-3 max-h-64 overflow-auto text-body">
              {packet.places.map((p) => (
                <li key={p.id}>{p.name_he}</li>
              ))}
            </ul>
          </details>
          <Button disabled={busy} onClick={() => void publish()}>
            פרסום המקומות שנבחרו
          </Button>
        </>
      )}
      {message && (
        <p role="status" className="text-body">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-body text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
