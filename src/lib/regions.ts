import type { MultiPolygon, Polygon, Position } from "geojson"
import boundaries from "../data/region-boundaries.json" with { type: "json" }
import type { Place } from "@/types"

// Navigation groups, separate from the legacy envelope/country field used by the safety notice.
export const REGIONS = [
  { id: "envelope", title: "עוטף עזה" },
  { id: "north", title: "הצפון" },
  { id: "golan", title: "רמת הגולן" },
  { id: "haifa", title: "חיפה והסביבה" },
  { id: "center", title: "המרכז והשרון" },
  { id: "tel-aviv", title: "תל אביב והסביבה" },
  { id: "jerusalem", title: "ירושלים והסביבה" },
  { id: "judea-samaria", title: "יהודה ושומרון" },
  { id: "south", title: "הדרום" },
  { id: "other", title: "מקומות נוספים" },
] as const
export type RegionId = (typeof REGIONS)[number]["id"]
type GeoPlace = Pick<Place, "lat" | "lng" | "region">
type Group<T> = { id: RegionId | "local"; title: string; items: T[] }

const SUBDISTRICTS: Record<string, RegionId> = {
  Zefat: "north",
  Akko: "north",
  "Yizre'el": "north",
  Kinneret: "north",
  Golan: "golan",
  Haifa: "haifa",
  Hadera: "haifa",
  HaSharon: "center",
  "Petah Tiqwa": "center",
  Ramla: "center",
  Rehovot: "center",
  "Tel Aviv": "tel-aviv",
  Jerusalem: "jerusalem",
  "West Bank": "judea-samaria",
  Ashqelon: "south",
  "Be'er Sheva": "south",
}

// A boundary point belongs to the polygon too. Shared boundaries resolve in the fixed dataset order.
function inRing(point: Position, ring: Position[]): "inside" | "outside" | "boundary" {
  const [x, y] = point
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j]
    const [bx, by] = ring[i]
    const dx = bx - ax
    const dy = by - ay
    // Repeated vertices are not a segment; they must not turn every point into a boundary point.
    if (dx === 0 && dy === 0) {
      if (x === ax && y === ay) return "boundary"
      continue
    }
    const cross = (x - ax) * dy - (y - ay) * dx
    if (
      Math.abs(cross) <= 1e-10 * Math.hypot(dx, dy) &&
      x >= Math.min(ax, bx) - 1e-10 &&
      x <= Math.max(ax, bx) + 1e-10 &&
      y >= Math.min(ay, by) - 1e-10 &&
      y <= Math.max(ay, by) + 1e-10
    )
      return "boundary"
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside
  }
  return inside ? "inside" : "outside"
}

function inPolygon(point: Position, rings: Position[][]) {
  const outer = inRing(point, rings[0])
  if (outer === "outside") return false
  if (outer === "boundary") return true
  for (const hole of rings.slice(1)) {
    const result = inRing(point, hole)
    if (result === "boundary") return true
    if (result === "inside") return false
  }
  return true
}

export function containsPoint(point: Position, geometry: Polygon | MultiPolygon) {
  if (point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return false
  return geometry.type === "Polygon"
    ? inPolygon(point, geometry.coordinates)
    : geometry.coordinates.some((rings) => inPolygon(point, rings))
}

const index = boundaries.features.map(({ name, geometry }) => {
  const shape = geometry as Polygon | MultiPolygon
  const positions = shape.type === "Polygon" ? shape.coordinates.flat() : shape.coordinates.flat(2)
  return {
    id: SUBDISTRICTS[name],
    shape,
    west: Math.min(...positions.map((p) => p[0])),
    east: Math.max(...positions.map((p) => p[0])),
    south: Math.min(...positions.map((p) => p[1])),
    north: Math.max(...positions.map((p) => p[1])),
  }
})

export function placeRegion(place: GeoPlace): RegionId {
  const { lat, lng } = place
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return "other"
  // Preserve the established envelope collection. It is not redefined as a guessed rectangle or a new safety zone.
  if (place.region === "envelope") return "envelope"
  for (const area of index) {
    if (lng < area.west || lng > area.east || lat < area.south || lat > area.north) continue
    if (containsPoint([lng, lat], area.shape)) return area.id ?? "other"
  }
  // Never assign the nearest city or drop a place when the snapshot does not cover its location.
  return "other"
}

export function groupPlaces<T extends GeoPlace & { local?: unknown }>(places: T[]): Group<T>[] {
  const groups: Group<T>[] = [{ id: "local", title: "הוספתם במכשיר הזה", items: [] }, ...REGIONS.map((r) => ({ ...r, items: [] as T[] }))]
  const byId = new Map(groups.map((g) => [g.id, g]))
  for (const place of places) byId.get(place.local ? "local" : placeRegion(place))!.items.push(place)
  return groups.filter((g) => g.items.length)
}
