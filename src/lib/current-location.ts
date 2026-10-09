export type LocationUpdate =
  { kind: "locating" } | { kind: "error"; message: string } | { kind: "found"; point: { lat: number; lng: number } }

export const LOCATION_WAIT_MS = 12000

const TIMEOUT = "איתור המיקום לוקח יותר מדי זמן. אפשר לנסות שוב או לסמן את המקום על המפה."
const UNAVAILABLE = "המכשיר לא הצליח לקבוע את המיקום. בדקו ששירותי המיקום פעילים, או סמנו את המקום על המפה."

/** The browser timeout may not cover a permission prompt. Bound the whole attempt and ignore late answers. */
export function requestCurrentLocation(
  environment: { secure: boolean; geolocation?: Pick<Geolocation, "getCurrentPosition"> },
  update: (result: LocationUpdate) => void,
): () => void {
  if (!environment.secure) {
    update({ kind: "error", message: "בקישור הזה הדפדפן חוסם איתור מיקום כי החיבור אינו מאובטח. אפשר לסמן את המקום על המפה." })
    return () => undefined
  }
  if (!environment.geolocation) {
    update({ kind: "error", message: "הדפדפן לא תומך באיתור מיקום. אפשר לסמן את המקום על המפה." })
    return () => undefined
  }

  let active = true
  const finish = (result: LocationUpdate) => {
    if (!active) return
    active = false
    clearTimeout(timer)
    update(result)
  }
  const timer = setTimeout(() => finish({ kind: "error", message: TIMEOUT }), LOCATION_WAIT_MS)
  update({ kind: "locating" })
  try {
    environment.geolocation.getCurrentPosition(
      ({ coords }) => {
        const { latitude: lat, longitude: lng } = coords
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
          return finish({ kind: "error", message: UNAVAILABLE })
        finish({ kind: "found", point: { lat, lng } })
      },
      ({ code }) =>
        finish({
          kind: "error",
          message:
            code === 1
              ? "הגישה למיקום חסומה. אפשר לאפשר מיקום בהגדרות הדפדפן והמכשיר, או לסמן את המקום על המפה."
              : code === 3
                ? TIMEOUT
                : UNAVAILABLE,
        }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    )
  } catch {
    finish({ kind: "error", message: UNAVAILABLE })
  }
  return () => {
    active = false
    clearTimeout(timer)
  }
}
