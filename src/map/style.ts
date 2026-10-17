import type { Map as MLMap, StyleSpecification } from "maplibre-gl"
import { MAP_FONT_FILES } from "@/lib/fonts"
import { BASEMAP_ARCHIVE, BASEMAP_MAXZOOM, TERRAIN_MAXZOOM, TERRAIN_VERSION, TILE_BOUNDS, basemapTile, terrainTile } from "@/shared/tiles"

/**
 * Communities are drawn as our own markers; the basemap's label for the same place would double them. Their names
 * come with the feed, so the layers start with none and the controller sets them (setOwnLabels) as they arrive.
 */
export const ownLabelsFilter = (names: string[]) => ["!", ["in", ["get", "name:he"], ["literal", names]]]
export const OWN_LABEL_LAYERS = ["place-small", "place-town"]
import { type Palette } from "./palette"

/** Map labels are drawn with the site's own typeface through MapLibre's `font-faces`. */
export const MAP_FONT = "Makom Sans"
export const MAP_FONT_BOLD = "Makom Sans Bold"

// Hebrew names only: the map font has no Arabic, and a name it can't draw would leave an empty label.
const he = ["coalesce", ["get", "name:he"], ""] as const
const poly = ["match", ["geometry-type"], ["MultiPolygon", "Polygon"], true, false] as const
const line = ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false] as const
const pt = ["match", ["geometry-type"], ["MultiPoint", "Point"], true, false] as const

/** Which palette key paints which layer property. The sunrise tween walks this table every frame. */
export const BINDINGS: [layer: string, prop: string, key: keyof Palette][] = [
  ["background", "background-color", "land"],
  ["farmland", "fill-color", "farmland"],
  ["wood", "fill-color", "wood"],
  ["park", "fill-color", "park"],
  ["urban", "fill-color", "urban"],
  ["water", "fill-color", "water"],
  ["waterway", "line-color", "water"],
  ["hillshade", "hillshade-shadow-color", "hillShadow"],
  ["hillshade", "hillshade-highlight-color", "hillHighlight"],
  ["hillshade", "hillshade-accent-color", "hillAccent"],
  ["road-minor", "line-color", "roadMinor"],
  ["road-major-casing", "line-color", "roadCasing"],
  ["road-major", "line-color", "roadMajor"],
  ["boundary", "line-color", "border"],
  ["building-3d", "fill-extrusion-color", "building"],
  ["road-label", "text-color", "label"],
  ["road-label", "text-halo-color", "halo"],
  ["place-small", "text-color", "label"],
  ["place-small", "text-halo-color", "halo"],
  ["place-town", "text-color", "labelStrong"],
  ["place-town", "text-halo-color", "halo"],
]

export function buildStyle(p: Palette, labels = true): StyleSpecification {
  // During the opening the labels start hidden, so names never flash over the dark map.
  const visibility = labels ? "visible" : "none"
  // MapLibre fetches tiles from its own worker, where a relative address has nothing to resolve against.
  const origin = window.location.origin
  return {
    version: 8,
    name: "makom-lizkor-dawn",
    transition: { duration: 0, delay: 0 },
    // No glyphs URL: every label is drawn from the site's own font files (font-faces), and a character they lack falls
    // back to the device's fonts instead of a glyph server.
    "font-faces": {
      [MAP_FONT]: MAP_FONT_FILES.regular,
      [MAP_FONT_BOLD]: MAP_FONT_FILES.bold,
    },
    // Both from the site itself (src/shared/tiles.ts): the basemap through the Worker, the terrain as static files.
    sources: {
      openmaptiles: {
        type: "vector",
        tiles: [origin + basemapTile(BASEMAP_ARCHIVE, "{z}", "{x}", "{y}")],
        bounds: TILE_BOUNDS,
        minzoom: 0,
        maxzoom: BASEMAP_MAXZOOM,
        attribution:
          '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>',
      },
      dem: {
        type: "raster-dem",
        tiles: [origin + terrainTile(TERRAIN_VERSION, "{z}", "{x}", "{y}")],
        bounds: TILE_BOUNDS,
        tileSize: 256,
        encoding: "terrarium",
        // The western Negev is flat: relief shading from coarse tiles reads the same and costs a fraction.
        maxzoom: TERRAIN_MAXZOOM,
        attribution:
          '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Terrain: Mapzen</a>',
      },
    },
    sky: {
      "sky-color": p.sky,
      "horizon-color": p.horizon,
      "fog-color": p.fog,
      "sky-horizon-blend": 0.6,
      "horizon-fog-blend": 0.7,
      "fog-ground-blend": 0.35,
      "atmosphere-blend": 0,
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": p.land } },
      {
        id: "farmland",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landcover",
        filter: ["all", poly, ["match", ["get", "class"], ["farmland"], true, false]],
        paint: { "fill-color": p.farmland, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 13, 0.9] },
      },
      {
        id: "wood",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landcover",
        filter: ["all", poly, ["match", ["get", "class"], ["wood", "forest", "grass"], true, false]],
        paint: { "fill-color": p.wood, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 7, 0.5, 13, 0.85] },
      },
      {
        id: "park",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "park",
        filter: poly,
        paint: { "fill-color": p.park, "fill-opacity": 0.7 },
      },
      {
        id: "urban",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landuse",
        filter: [
          "all",
          poly,
          ["match", ["get", "class"], ["residential", "suburb", "neighbourhood", "commercial", "industrial", "farmyard"], true, false],
        ],
        paint: { "fill-color": p.urban, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0.4, 13, 0.85] },
      },
      {
        id: "water",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "water",
        filter: ["all", poly, ["!=", ["get", "brunnel"], "tunnel"]],
        paint: { "fill-color": p.water },
      },
      {
        id: "hillshade",
        type: "hillshade",
        source: "dem",
        paint: {
          "hillshade-shadow-color": p.hillShadow,
          "hillshade-highlight-color": p.hillHighlight,
          "hillshade-accent-color": p.hillAccent,
          "hillshade-exaggeration": ["interpolate", ["linear"], ["zoom"], 7, 0.5, 13, 0.3],
          "hillshade-illumination-direction": 300,
        },
      },
      {
        id: "waterway",
        type: "line",
        source: "openmaptiles",
        "source-layer": "waterway",
        filter: line,
        minzoom: 9,
        paint: { "line-color": p.water, "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.6, 15, 2.5] },
      },
      {
        id: "road-minor",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["all", line, ["match", ["get", "class"], ["minor", "service", "track", "path"], true, false]],
        minzoom: 11,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": p.roadMinor, "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 11, 0.4, 18, 9] },
      },
      {
        id: "road-major-casing",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["all", line, ["match", ["get", "class"], ["primary", "secondary", "tertiary", "trunk", "motorway"], true, false]],
        minzoom: 8,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": p.roadCasing, "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 8, 1, 18, 20] },
      },
      {
        id: "road-major",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["all", line, ["match", ["get", "class"], ["primary", "secondary", "tertiary", "trunk", "motorway"], true, false]],
        minzoom: 6,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": p.roadMajor, "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 6, 0.5, 18, 16] },
      },
      {
        id: "boundary",
        type: "line",
        source: "openmaptiles",
        "source-layer": "boundary",
        filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
        paint: {
          "line-color": p.border,
          "line-opacity": 0.5,
          "line-dasharray": [3, 2],
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.6, 13, 1.6],
        },
      },
      {
        id: "building-3d",
        type: "fill-extrusion",
        source: "openmaptiles",
        "source-layer": "building",
        minzoom: 13,
        paint: {
          "fill-extrusion-color": p.building,
          "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 13, 0, 14.5, ["coalesce", ["get", "render_height"], 5]],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
          "fill-extrusion-opacity": 0.85,
        },
      },
      {
        id: "road-label",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "transportation_name",
        filter: line,
        minzoom: 13,
        layout: {
          visibility,
          "symbol-placement": "line",
          "symbol-spacing": 420,
          "text-field": he as never,
          "text-font": [MAP_FONT],
          "text-size": 12,
        },
        paint: { "text-color": p.label, "text-halo-color": p.halo, "text-halo-width": 1.6 },
      },
      {
        id: "place-small",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        filter: [
          "all",
          pt,
          ["match", ["get", "class"], ["village", "hamlet", "suburb", "neighbourhood"], true, false],
          ownLabelsFilter([]) as never,
        ],
        minzoom: 11,
        layout: {
          visibility,
          "text-field": he as never,
          "text-font": [MAP_FONT],
          "text-size": ["interpolate", ["linear"], ["zoom"], 10, 12, 15, 15],
          "text-max-width": 8,
        },
        paint: { "text-color": p.label, "text-halo-color": p.halo, "text-halo-width": 1.6 },
      },
      {
        id: "place-town",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        filter: ["all", pt, ["match", ["get", "class"], ["town", "city"], true, false], ownLabelsFilter([]) as never],
        minzoom: 6.5,
        layout: {
          visibility,
          "text-field": he as never,
          "text-font": [MAP_FONT_BOLD],
          "text-size": ["interpolate", ["linear"], ["zoom"], 7, 13, 13, 19],
          "text-max-width": 8,
        },
        paint: { "text-color": p.labelStrong, "text-halo-color": p.halo, "text-halo-width": 1.8 },
      },
    ],
  } as StyleSpecification
}

/**
 * Set every map color to the palette. With a duration, MapLibre interpolates the change itself
 * (paint and sky transitions), so the sunrise costs one call instead of a style update per frame.
 */
export function applyPalette(map: MLMap, p: Palette, duration = 0) {
  const t = { duration, delay: 0 }
  const set = map.setPaintProperty.bind(map) as (l: string, p: string, v: unknown, o?: object) => void
  for (const [layer, prop, key] of BINDINGS) {
    if (!map.getLayer(layer)) continue
    set(layer, `${prop}-transition`, t, { validate: false })
    set(layer, prop, p[key], { validate: false })
  }
  map.setSky({
    "sky-color": p.sky,
    "horizon-color": p.horizon,
    "fog-color": p.fog,
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.7,
    "fog-ground-blend": 0.35,
    "atmosphere-blend": 0,
    "sky-color-transition": t,
    "horizon-color-transition": t,
    "fog-color-transition": t,
  } as never)
}
