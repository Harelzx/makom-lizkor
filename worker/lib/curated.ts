import seed from "@/data/places.json"

type Seed = { id: string; name_he: string; summary_he?: string; place_he?: string }

// Local scaffolding until phase 7 moves the site's own places into D1: their share pages read the copy that ships
// with the site. Not verified launch data.
const byId = new Map((seed as Seed[]).map((p) => [p.id, p]))

/** One of the site's own places, for its share page: name and words only (the site ships the rest). */
export function curatedPlace(
  id: string,
): { kind: "published"; place: { name_he: string; summary_he: string; place_he: string } } | { kind: "none" } {
  const p = byId.get(id)
  return p
    ? { kind: "published", place: { name_he: p.name_he, summary_he: p.summary_he ?? "", place_he: p.place_he ?? "" } }
    : { kind: "none" }
}
