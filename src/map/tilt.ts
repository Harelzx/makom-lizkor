// By day the tilt follows the zoom, as in the map apps: flat over the whole country, tilted only close to the places. A
// camera tilted 50° over the whole country looked past the map's far edge, and a flat band of fog sat under the header.
export const FLAT = { zoom: 8, pitch: 15 }
export const TILTED = { zoom: 10, pitch: 70 }

/** The most tilt a zoom allows: flat at zoom 8 and out, rising evenly to 70° at zoom 10 and in. */
export function tiltFor(zoom: number) {
  const t = Math.min(1, Math.max(0, (zoom - FLAT.zoom) / (TILTED.zoom - FLAT.zoom)))
  return FLAT.pitch + t * (TILTED.pitch - FLAT.pitch)
}
