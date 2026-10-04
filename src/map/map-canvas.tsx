import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import * as maplibregl from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import { allPlaces, useStore } from "@/store"
import { FlowerSprite } from "./flower-sprite"
import { createMap, destroyMap, flyToPlace, getMap, returnToDawn, setLabels, shiftLight, startOrbit } from "./controller"
import type { Place } from "@/types"
import { cn } from "@/lib/utils"

/** Marker scale follows zoom, so a field of flowers at country scale becomes single blooms up close. */
function scaleFor(zoom: number) {
  return Math.max(0.42, Math.min(1.25, 0.42 + (zoom - 8) * 0.14))
}

export function MapCanvas() {
  const container = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const draftMarker = useRef<maplibregl.Marker | null>(null)

  const seed = useStore((s) => s.seed)
  const local = useStore((s) => s.local)
  const phase = useStore((s) => s.phase)
  const light = useStore((s) => s.light)
  const selectedId = useStore((s) => s.selectedId)
  const picking = useStore((s) => s.picking)
  const draft = useStore((s) => s.draft)
  const places = useMemo(() => allPlaces({ seed, local }), [seed, local])

  // Create the map once, at 06:29.
  useEffect(() => {
    const { phase, light } = useStore.getState()
    const map = createMap(container.current!, phase === "day" ? light : "night", phase !== "intro")
    // The marker scale lives in a CSS variable on the container. Writing it restyles every marker,
    // so it moves in coarse steps and is written only when the step changes, not on every zoom frame.
    let lastScale = ""
    const setScale = () => {
      const next = (Math.round(scaleFor(map.getZoom()) * 10) / 10).toFixed(1)
      if (next === lastScale) return
      lastScale = next
      container.current?.style.setProperty("--mk", next)
    }
    setScale()
    map.on("zoom", setScale)
    map.on("load", () => {
      setReady(true)
      if (useStore.getState().phase === "intro") {
        setLabels(false)
        startOrbit()
      }
    })
    map.on("click", (e) => {
      const s = useStore.getState()
      if (s.picking) s.setDraft({ lat: e.lngLat.lat, lng: e.lngLat.lng })
    })
    return () => destroyMap()
  }, [])

  // MapLibre owns this element's classes, so the opening flag is toggled rather than rendered.
  useEffect(() => {
    container.current?.classList.toggle("is-opening", phase !== "day")
  }, [phase])

  // The opening played again: the morning turns back into the blue hour.
  const lastPhase = useRef(phase)
  useEffect(() => {
    if (lastPhase.current === "day" && phase === "intro" && ready) returnToDawn()
    lastPhase.current = phase
  }, [phase, ready])

  // Light follows the user's choice once the day has begun.
  useEffect(() => {
    if (phase === "day" && ready) void shiftLight(light, 1800)
  }, [light, phase, ready])

  // Camera follows the selection.
  useEffect(() => {
    const p = places.find((x) => x.id === selectedId)
    if (!p || useStore.getState().tab === "journey") return
    flyToPlace(p.lng, p.lat, { zoom: p.kind === "community" ? 13.6 : p.precision === "exact" ? 16 : 14 })
  }, [selectedId, places])

  // Draft pin while a visitor is adding a place.
  useEffect(() => {
    const map = getMap()
    if (!map) return
    map.getCanvas().style.cursor = picking ? "crosshair" : ""
    if (!draft) {
      draftMarker.current?.remove()
      draftMarker.current = null
      return
    }
    if (!draftMarker.current) {
      const el = document.createElement("div")
      el.className = "draft-pin"
      draftMarker.current = new maplibregl.Marker({ element: el, anchor: "bottom", draggable: true })
        .setLngLat([draft.lng, draft.lat])
        .addTo(map)
      draftMarker.current.on("dragend", () => {
        const ll = draftMarker.current!.getLngLat()
        useStore.getState().setDraft({ lat: ll.lat, lng: ll.lng })
      })
    } else draftMarker.current.setLngLat([draft.lng, draft.lat])
  }, [draft, picking])

  // Bloom order: the flowers open outward from the heart of the envelope.
  const order = useMemo(() => {
    const sorted = [...places].sort((a, b) => Math.hypot(a.lat - 31.42, a.lng - 34.46) - Math.hypot(b.lat - 31.42, b.lng - 34.46))
    return new Map(sorted.map((p, i) => [p.id, i]))
  }, [places])

  return (
    <div className="absolute inset-0">
      <FlowerSprite />
      {/* inline style: maplibre-gl.css is unlayered and would beat a Tailwind utility here */}
      <div ref={container} style={{ position: "absolute", inset: 0 }} />
      {ready &&
        places.map((p) => (
          <MarkerHost key={p.id} place={p}>
            <PlaceMarker place={p} bloomDelay={0.6 + (order.get(p.id) ?? 0) * 0.035} selected={p.id === selectedId} />
          </MarkerHost>
        ))}
    </div>
  )
}

/** One DOM marker per place: MapLibre places the element on the map, React renders the flower into it. */
function MarkerHost({ place, children }: { place: Place; children: React.ReactNode }) {
  const [el] = useState(() => Object.assign(document.createElement("div"), { className: "mk" }))
  useEffect(() => {
    const map = getMap()
    if (!map) return
    const marker = new maplibregl.Marker({ element: el, anchor: "center", subpixelPositioning: true })
      .setLngLat([place.lng, place.lat])
      .addTo(map)
    return () => {
      marker.remove()
    }
  }, [el, place.lng, place.lat])
  return createPortal(children, el)
}

function pickOrSelect(place: Place) {
  const st = useStore.getState()
  if (st.picking) st.setDraft({ lat: place.lat, lng: place.lng })
  else st.select(place.id)
}

function PlaceMarker({ place, bloomDelay, selected }: { place: Place; bloomDelay: number; selected: boolean }) {
  const phase = useStore((s) => s.phase)
  const hover = useStore((s) => s.hover)
  const hovered = useStore((s) => s.hoveredId === place.id)
  const isCommunity = place.kind === "community"
  const open = phase !== "intro"

  if (isCommunity) {
    return (
      <button
        type="button"
        className={cn(
          "mk-community",
          open && "is-open",
          selected && "is-selected",
          hovered && "is-hovered",
          place.revival && `rv-${place.revival.status}`,
        )}
        onMouseEnter={() => hover(place.id)}
        onMouseLeave={() => hover(null)}
        style={{ transitionDelay: open ? `${bloomDelay}s` : "0s" }}
        onClick={(e) => {
          e.stopPropagation()
          // While a visitor is placing a pin, a flower is just a spot on the map.
          pickOrSelect(place)
        }}
        aria-label={`${place.name_he}, קהילה`}
      >
        <span className="mk-community-dot" aria-hidden="true" />
        <span className="mk-community-name">{place.name_he.replace(/^קיבוץ |^מושב /, "")}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      className={cn("mk-flower", selected && "is-selected", hovered && "is-hovered")}
      onClick={(e) => {
        e.stopPropagation()
        // While a visitor is placing a pin, a flower is just a spot on the map.
        pickOrSelect(place)
      }}
      onMouseEnter={() => hover(place.id)}
      onMouseLeave={() => hover(null)}
      aria-label={place.name_he}
    >
      {selected && <span className="mk-ripple" aria-hidden="true" />}
      {/* bud and flower from the shared sprite; .is-open runs the bloom as a CSS transition */}
      <span className={cn("mk-bloom", open && "is-open")} style={{ transitionDelay: phase === "dawn" ? `${bloomDelay}s` : "0s" }}>
        <svg className="mk-bud" viewBox="-60 -60 120 120" aria-hidden="true">
          {/* the symbol has its own -60…60 box; without x/y/size it would start at this svg's center and draw the flower off its point */}
          <use href="#mk-bud" x={-60} y={-60} width={120} height={120} />
        </svg>
        <svg className="mk-petals" viewBox="-60 -60 120 120" aria-hidden="true">
          <use href={place.local ? "#mk-pale" : "#mk-crimson"} x={-60} y={-60} width={120} height={120} />
        </svg>
      </span>
      <span className="mk-label" aria-hidden="true">
        {/* on hover, a glimpse of the place itself, when there is a photo */}
        {hovered && !selected && place.photos?.[0] && <img className="mk-thumb" src={`/photos/thumb/${place.photos[0].file}`} alt="" />}
        {place.name_he}
      </span>
    </button>
  )
}
