// Builds src/data/places.json, and the curated fixtures in fixtures/curated.json, from the research files in data-src/.
//   oct7.json      researched memorial sites (only scope "oct7" and "mixed" reach the map)
//   extra.json     community points and sites added by hand, same schema
//   revival.json   return status and revival milestones per community, merged by id
//   photos.json    Wikimedia Commons photos with TASL credits, matched to places in photo-map.json
//   exclude.txt    ids kept out of the map, with a reason
// Every record is validated; failures are printed and left out, never silently fixed.
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { curatedFixtures } from "./curated-fixtures.mjs"

const read = (f, fallback) => (existsSync(`data-src/${f}`) ? JSON.parse(readFileSync(`data-src/${f}`, "utf8")) : fallback)
const KINDS = ["community", "monument", "bench", "lookout", "grove", "garden", "plaque", "shelter", "site", "museum", "other"]
const BBOX = { minLat: 29.4, maxLat: 33.45, minLng: 34.2, maxLng: 35.95 }
const ENVELOPE = (p) => p.lat > 31.15 && p.lat < 31.68 && p.lng < 34.72

const exclude = new Set(
  readFileSync("data-src/exclude.txt", "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#")),
)
const revival = read("revival.json", { communities: [] })
const photos = read("photos.json", [])
const photoMap = read("photo-map.json", {}) // { placeId: [photoFile, ...] }
const photoByFile = new Map(photos.map((p) => [p.file, p]))

const meters = (a, b) => {
  const R = 6371000
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

const out = []
const rejected = []
for (const p of [...read("oct7.json", []), ...read("extra.json", [])]) {
  if (exclude.has(p.id)) continue
  if (p.scope && !["oct7", "mixed"].includes(p.scope)) continue
  const kind = p.id.startsWith("community-") ? "community" : KINDS.includes(p.kind) ? p.kind : "other"
  const why = []
  if (!p.id || !p.name_he) why.push("missing id/name")
  if (!(p.lat >= BBOX.minLat && p.lat <= BBOX.maxLat && p.lng >= BBOX.minLng && p.lng <= BBOX.maxLng))
    why.push(`coords out of area ${p.lat},${p.lng}`)
  if (!p.summary_he || p.summary_he.length < 20) why.push("summary too short")
  if (why.length) {
    rejected.push({ id: p.id, why })
    continue
  }
  const dup = out.find((q) => q.id === p.id || (meters(q, p) < 40 && q.name_he === p.name_he))
  if (dup) {
    rejected.push({ id: p.id, why: [`duplicate of ${dup.id}`] })
    continue
  }
  const rid = p.id.replace(/^community-/, "")
  const r = kind === "community" ? revival.communities.find((c) => c.id === rid) : null
  out.push({
    id: p.id,
    // Communities go by their own name ("בארי", not "קיבוץ בארי"), the way people say it.
    name_he: kind === "community" ? p.name_he.trim().replace(/^(קיבוץ|מושב) /, "") : p.name_he.trim(),
    kind,
    lat: +(+p.lat).toFixed(6),
    lng: +(+p.lng).toFixed(6),
    precision: p.precision === "exact" ? "exact" : "approx",
    place_he: (p.place_he ?? "").trim(),
    summary_he: p.summary_he.trim(),
    established: Number.isInteger(p.established) ? p.established : null,
    links: (p.links ?? []).filter((l) => /^https:\/\//.test(l.url ?? "") && l.label_he),
    coord_source: ["osm", "wikidata", "manual"].includes(p.coord_source) ? p.coord_source : "manual",
    coord_source_url: p.coord_source_url || undefined,
    region: ENVELOPE(p) ? "envelope" : "country",
    photos: (photoMap[p.id] ?? [])
      .map((f) => photoByFile.get(f))
      .filter(Boolean)
      .map(({ file, title, commons_url, author, license, license_url, subject_he }) => ({
        file,
        title,
        commons_url,
        author,
        license,
        license_url,
        subject_he,
      })),
    revival: r
      ? {
          status: r.returned?.status ?? "unknown",
          date: r.returned?.date ?? null,
          note_he: r.returned?.note_he,
          milestones_he: r.milestones_he ?? [],
          revival_he: r.revival_he,
          sources: (r.sources ?? []).filter((s) => /^https:\/\//.test(s.url)),
          confidence: r.confidence ?? "medium",
        }
      : undefined,
  })
}

writeFileSync("src/data/places.json", JSON.stringify(out, null, 1))
writeFileSync("src/data/context.json", JSON.stringify(revival.context ?? {}, null, 1))
// Landscapes of the western Negev in bloom, for the revival chapters. A picture that is also a place's photo is the
// place's: served as a static file it would outlive that photo's hide, so it is never a landscape (P7-MEDIA-1).
const placePhotos = new Set(Object.values(photoMap).flat())
writeFileSync(
  "src/data/landscapes.json",
  JSON.stringify(
    photos
      .filter((p) => p.category === "landscape" && !placePhotos.has(p.file))
      .map(({ file, title, commons_url, author, license, license_url, subject_he }) => ({
        file,
        title,
        commons_url,
        author,
        license,
        license_url,
        subject_he,
      })),
    null,
    1,
  ),
)
// The same places as the records the importer sends to the admin route (phase 7). retrieved_at for most sources is
// the day data-src/ was last committed; the file keeps that date, so its check never needs the git history.
const dataSrcDate = execFileSync("git", ["log", "-1", "--format=%cs", "--", "data-src"], { encoding: "utf8" }).trim()
mkdirSync("fixtures", { recursive: true })
writeFileSync("fixtures/curated.json", JSON.stringify(curatedFixtures(out, { dataSrcDate, revivalAsOf: revival.as_of }), null, 1))
const by = (k) => out.reduce((m, p) => ((m[p[k]] = (m[p[k]] ?? 0) + 1), m), {})
console.log(`places: ${out.length}`, by("kind"), by("region"), by("precision"))
console.log(`communities with revival: ${out.filter((p) => p.revival).length}, with photos: ${out.filter((p) => p.photos.length).length}`)
if (rejected.length) console.log("rejected:", JSON.stringify(rejected, null, 1))
