// Read-only corpus audit using the same classifier the UI runs (Node >=22.18 strips TypeScript).
import fixtures from "../fixtures/curated.json" with { type: "json" }
import { groupPlaces } from "../src/lib/regions.ts"
const places = fixtures.places
  .filter((p) => p.kind !== "community")
  .map((p) => ({ id: p.id, name: p.name_he, lat: p.lat, lng: p.lng, region: p.curated.region }))
const groups = groupPlaces(places)
console.log(JSON.stringify({ total: places.length, groups }, null, 2))
