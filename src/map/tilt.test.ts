import { expect, it } from "vitest"
import { tiltFor } from "./tilt"

it("lies flat over the whole country, so no band of fog shows under the header", () => {
  for (const zoom of [6.6, 7.6, 8]) expect(tiltFor(zoom)).toBe(15)
  expect(tiltFor(9)).toBeCloseTo(42.5)
  for (const zoom of [10, 12, 18]) expect(tiltFor(zoom)).toBe(70)
})

it("lets every flight land at its own tilt, so the camera only ever eases down after a zoom out by hand", () => {
  // Kept in step with the flights in controller.ts and journey.tsx: [zoom, pitch] where each lands.
  const flights = {
    "the envelope on a phone": [9.6, 50],
    "the envelope on a desktop": [10.4, 55],
    "a place": [15, 58],
    "a community on the tour": [14, 66],
    "a site on the tour": [15.6, 66],
  }
  for (const [name, [zoom, pitch]] of Object.entries(flights)) expect(tiltFor(zoom), name).toBeGreaterThanOrEqual(pitch)
})
