import { useId, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { parseManualPoint, type ManualPointResult } from "@/lib/manual-point"
import { Disclosure } from "@/components/kit"

export function PointCoordinates({
  point,
  onSelect,
}: {
  point: { lat: number; lng: number } | null
  onSelect: (point: { lat: number; lng: number }) => void
}) {
  const id = useId()
  const details = useRef<HTMLDetailsElement>(null)
  const latitude = useRef<HTMLInputElement>(null)
  const longitude = useRef<HTMLInputElement>(null)
  const [lat, setLat] = useState(point ? String(point.lat) : "")
  const [lng, setLng] = useState(point ? String(point.lng) : "")
  const [error, setError] = useState<Extract<ManualPointResult, { ok: false }> | null>(null)
  const pointKey = point ? `${point.lat}:${point.lng}` : ""
  const [seenPoint, setSeenPoint] = useState(pointKey)
  if (seenPoint !== pointKey) {
    setSeenPoint(pointKey)
    setLat(point ? String(point.lat) : "")
    setLng(point ? String(point.lng) : "")
    setError(null)
  }

  const select = () => {
    const result = parseManualPoint(lat, lng)
    if (!result.ok) {
      setError(result)
      ;(result.field === "lat" ? latitude : longitude).current?.focus()
      return
    }
    setError(null)
    onSelect(result.point)
    if (details.current) {
      details.current.open = false
      details.current.querySelector("summary")?.focus()
    }
  }

  return (
    <Disclosure ref={details} summary="הזנת נקודה במקלדת" bodyClassName="text-ink-1">
      <div
        className="flex flex-col gap-4"
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing || !(event.target instanceof HTMLInputElement)) return
          event.preventDefault()
          event.stopPropagation()
          select()
        }}
      >
        <p id={`${id}-help`} className="text-body text-ink-2">
          אפשר להקליד נקודה ידועה, למשל קואורדינטות שהעתקתם ממפת ניווט. קודם קו הרוחב ואחריו קו האורך. נקודת המקום תיכלל בהצעה רק כשתשלחו
          אותה.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${id}-lat`}>קו רוחב</FieldLabel>
            <Input
              id={`${id}-lat`}
              ref={latitude}
              dir="ltr"
              inputMode="decimal"
              maxLength={24}
              placeholder="31.46415"
              value={lat}
              onChange={(event) => {
                setLat(event.target.value)
                setError(null)
              }}
              aria-invalid={error?.field === "lat"}
              aria-describedby={`${id}-help${error?.field === "lat" ? ` ${id}-error` : ""}`}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-lng`}>קו אורך</FieldLabel>
            <Input
              id={`${id}-lng`}
              ref={longitude}
              dir="ltr"
              inputMode="decimal"
              maxLength={24}
              placeholder="34.52439"
              value={lng}
              onChange={(event) => {
                setLng(event.target.value)
                setError(null)
              }}
              aria-invalid={error?.field === "lng"}
              aria-describedby={`${id}-help${error?.field === "lng" ? ` ${id}-error` : ""}`}
            />
          </Field>
        </div>
        {error && (
          <p id={`${id}-error`} role="alert" className="text-body text-destructive">
            {error.message}
          </p>
        )}
        <Button type="button" variant="outline" onClick={select}>
          שמירת הנקודה
        </Button>
      </div>
    </Disclosure>
  )
}
