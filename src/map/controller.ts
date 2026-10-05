import * as maplibregl from "maplibre-gl"
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"
import { FIRST_LIGHT, MORNING, NIGHT, type Palette } from "./palette"
import { applyPalette, buildStyle } from "./style"

// MapLibre's own relative worker lookup doesn't survive a production build.
maplibregl.setWorkerUrl(workerUrl)

let map: maplibregl.Map | null = null
let current: Palette = NIGHT
let orbitRaf = 0

export const getMap = () => map
export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
export const isMobile = () => window.matchMedia("(max-width: 767px)").matches

/** The Gaza envelope, seen from the north-west at first light. */
export const ENVELOPE = { center: [34.47, 31.41] as [number, number], zoom: 10.4, pitch: 55, bearing: 0 }
/** Where the morning begins: low over Be'eri, looking east toward the sunrise. */
export const DAWN = { center: [34.66, 31.41] as [number, number], zoom: 11.2, pitch: 70, bearing: 92 }
/** On a phone the opening stands further back, so the envelope's places are in frame for the headlines to fall onto. */
const dawnZoom = () => (isMobile() ? DAWN.zoom - 0.9 : DAWN.zoom)
export const ISRAEL: [[number, number], [number, number]] = [
  [34.2, 29.45],
  [35.95, 33.35],
]

export function createMap(container: HTMLElement, light: "night" | "morning", labels = true) {
  current = light === "night" ? NIGHT : MORNING
  map = new maplibregl.Map({
    container,
    style: buildStyle(current, labels),
    center: DAWN.center,
    zoom: dawnZoom(),
    pitch: DAWN.pitch,
    bearing: DAWN.bearing - 14,
    maxPitch: 80,
    // Israel only: the camera can't leave the country, so tiles beyond it are never requested.
    minZoom: 6.6,
    maxZoom: 18,
    maxBounds: [
      [33.6, 29.2],
      [36.4, 33.6],
    ],
    // Phones with 3x screens don't need 3x map tiles; 2x looks the same and renders far faster.
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    maxTileCacheSize: 120,
    fadeDuration: 200,
    attributionControl: false,
    locale: {
      "Map.Title": "מפת אתרי ההנצחה לזכר 7 באוקטובר. כל המקומות זמינים גם ברשימה שבצד",
      "NavigationControl.ZoomIn": "התקרבות",
      "NavigationControl.ZoomOut": "התרחקות",
      "NavigationControl.ResetBearing": "איפוס כיוון",
      "AttributionControl.ToggleAttribution": "קרדיטים למפה",
    },
  })
  if (import.meta.env.DEV) (window as unknown as { __map: maplibregl.Map }).__map = map
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-left")
  map.addControl(new maplibregl.AttributionControl({ compact: false }), "bottom-left")
  return map
}

export function destroyMap() {
  cancelAnimationFrame(orbitRaf)
  map?.remove()
  map = null
}

const LABEL_LAYERS = ["road-label", "place-small", "place-town"]

/** The opening is wordless on the map: labels stay hidden until the sun is up. */
export function setLabels(visible: boolean) {
  if (!map) return
  map.getContainer().classList.toggle("is-named", visible)
  for (const id of LABEL_LAYERS) {
    if (!map.getLayer(id)) continue
    map.setPaintProperty(id, "text-opacity-transition", { duration: 0, delay: 0 })
    map.setPaintProperty(id, "text-opacity", 1)
    map.setLayoutProperty(id, "visibility", visible ? "visible" : "none")
  }
}

/** The place names come in with the morning: faded in over `duration` ms, never popping on all at once. */
export function fadeInLabels(duration: number) {
  if (!map) return
  const m = map
  // the communities' own names come in with them (index.css, .is-named)
  m.getContainer().classList.add("is-named")
  for (const id of LABEL_LAYERS) {
    if (!m.getLayer(id)) continue
    m.setPaintProperty(id, "text-opacity-transition", { duration: 0, delay: 0 })
    m.setPaintProperty(id, "text-opacity", 0)
    m.setLayoutProperty(id, "visibility", "visible")
  }
  // the transparent start has to be drawn once before the fade has something to fade from
  requestAnimationFrame(() => {
    for (const id of LABEL_LAYERS) {
      if (!m.getLayer(id)) continue
      m.setPaintProperty(id, "text-opacity-transition", { duration, delay: 0 })
      m.setPaintProperty(id, "text-opacity", 1)
    }
  })
}

/**
 * Change the light. MapLibre interpolates every color and the sky over `duration`. Asked for before the map has its
 * style (a visitor skipping the film the moment the page opens), MapLibre refuses: the change then waits for the style
 * and runs in full.
 */
export async function shiftLight(target: "night" | "first" | "morning", duration = 1600): Promise<void> {
  const to = target === "night" ? NIGHT : target === "first" ? FIRST_LIGHT : MORNING
  const m = map
  if (!m) return
  const d = reducedMotion() ? 0 : duration
  try {
    applyPalette(m, to, d)
  } catch (error) {
    if (!String(error).includes("Style is not done loading")) throw error
    await new Promise((done) => m.once("style.load", done))
    if (map !== m) return
    applyPalette(m, to, d)
  }
  current = to
  m.triggerRepaint()
  await new Promise((resolve) => setTimeout(resolve, d))
}

let timeHeld = false

/**
 * At 06:29 the opening stops the world, and the camera with it, until the words say we won't forget.
 * While time is held, no drift starts, not even one the map asks for when it finishes loading.
 */
export function setTimeHeld(held: boolean) {
  timeHeld = held
  if (held) stopOrbit()
}

/** A slow drift around the current center: the camera breathes while the opening words play. */
export function startOrbit(degPerSec = 2.2) {
  cancelAnimationFrame(orbitRaf)
  if (!map || reducedMotion() || timeHeld) return
  let last = performance.now()
  const tick = (now: number) => {
    if (!map) return
    const dt = (now - last) / 1000
    last = now
    if (!map.isMoving() || map.isRotating()) map.setBearing(map.getBearing() + degPerSec * dt)
    orbitRaf = requestAnimationFrame(tick)
  }
  orbitRaf = requestAnimationFrame(tick)
  const stop = () => stopOrbit()
  map.once("mousedown", stop)
  map.once("touchstart", stop)
  map.once("wheel", stop)
}

export function stopOrbit() {
  cancelAnimationFrame(orbitRaf)
}

/** Fly to a place, leaving room for the panel (start side on desktop, bottom sheet on phones). */
export function flyToPlace(lng: number, lat: number, opts: { zoom?: number; pitch?: number; bearing?: number; duration?: number } = {}) {
  if (!map) return
  const mobile = isMobile()
  map.flyTo({
    center: [lng, lat],
    zoom: opts.zoom ?? 15,
    pitch: opts.pitch ?? 58,
    bearing: opts.bearing ?? map.getBearing(),
    padding: mobile ? { top: 70, bottom: window.innerHeight * 0.5, left: 0, right: 0 } : { top: 40, bottom: 40, left: 40, right: 460 },
    duration: reducedMotion() ? 0 : (opts.duration ?? 2800),
    curve: 1.5,
    essential: false,
  })
}

/** Back to 06:29 for the opening played again: night, no names, low over Be'eri, drifting. */
export function returnToDawn() {
  if (!map) return
  stopOrbit()
  setLabels(false)
  void shiftLight("night", 1400)
  map.flyTo({
    center: DAWN.center,
    zoom: dawnZoom(),
    pitch: DAWN.pitch,
    bearing: DAWN.bearing - 14,
    padding: { top: 0, bottom: 0, left: 0, right: 0 },
    duration: reducedMotion() ? 0 : 2600,
    essential: false,
  })
  map.once("moveend", () => startOrbit())
}

/** Where places sit on the screen right now: the opening's headlines fall onto them. */
export function screenPoints(points: [number, number][]) {
  if (!map) return []
  return points.map((p) => map!.project(p))
}

export function flyToEnvelope(duration = 4200) {
  if (!map) return
  const mobile = isMobile()
  map.flyTo({
    center: ENVELOPE.center,
    zoom: mobile ? 9.6 : ENVELOPE.zoom,
    pitch: mobile ? 50 : 55,
    bearing: 0,
    padding: mobile ? { top: 60, bottom: window.innerHeight * 0.3, left: 0, right: 0 } : { top: 40, bottom: 40, left: 40, right: 460 },
    duration: reducedMotion() ? 0 : duration,
    curve: 1.2,
    essential: false,
  })
}
