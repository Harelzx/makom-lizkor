export type ManualPointResult = { ok: true; point: { lat: number; lng: number } } | { ok: false; field: "lat" | "lng"; message: string }

/** A typed point stays on the device until the visitor deliberately submits the proposal. */
export function parseManualPoint(latitude: string, longitude: string): ManualPointResult {
  const decimal = (value: string) => {
    const trimmed = value.trim()
    if (trimmed.length > 24 || !/^\d{1,2}(?:[.,]\d{1,10})?$/.test(trimmed)) return NaN
    return Number(trimmed.replace(",", "."))
  }
  const lat = decimal(latitude)
  if (!Number.isFinite(lat) || lat < 29.4 || lat > 33.45)
    return { ok: false, field: "lat", message: "כתבו קו רוחב בין 29.4 ל-33.45, למשל 31.46415." }
  const lng = decimal(longitude)
  if (!Number.isFinite(lng) || lng < 34.2 || lng > 35.95)
    return { ok: false, field: "lng", message: "כתבו קו אורך בין 34.2 ל-35.95, למשל 34.52439." }
  return { ok: true, point: { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) } }
}
