import { call } from "./app"
import { admin, devToken } from "./helpers"
import { feed } from "./submission-helpers"
import type { PublicCuratedPlace } from "@/shared/contract"
import fixtures from "../../fixtures/curated.json"
import { importCurated } from "../../scripts/curated-import.mjs"

// Curated records made through the moderators' route (phase 7), for the tests of that route and of their lifecycle.

/** A WebP file's first bytes: the route checks the format, it doesn't decode the picture. */
export const webp = (fill: number) =>
  new Uint8Array([...new TextEncoder().encode("RIFF"), 64, 0, 0, 0, ...new TextEncoder().encode("WEBPVP8 "), ...Array(48).fill(fill)])

export async function uploadPhoto(placeId: string, fill = 0x41) {
  const form = new FormData()
  form.set("place_id", placeId)
  form.set("file", new File([webp(fill)], "x.webp", { type: "image/webp" }))
  form.set("thumb", new File([webp(fill + 1)], "x.thumb.webp", { type: "image/webp" }))
  const res = await multipart(form)
  return { res, ...(res.ok ? await res.json<{ key: string; thumb_key: string }>() : { key: "", thumb_key: "" }) }
}

/** A photo upload: multipart, so not through admin(), which sends JSON. */
export const multipart = async (form: FormData) =>
  call("http://local/api/admin/curated-photos", {
    method: "POST",
    body: form,
    headers: { "Cf-Access-Jwt-Assertion": await devToken("dev@example.test"), "Sec-Fetch-Site": "same-origin" },
  })

export const sources = [
  {
    field: "coords",
    source: "osm",
    license: "ODbL-1.0",
    url: "https://www.openstreetmap.org/node/1",
    retrieved_at: "2026-10-04",
    retrieved_approx: true,
  },
  { field: "text", source: "operator", retrieved_approx: false },
]
export const body = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  expectedRev: 0,
  kind: "monument",
  name_he: `אנדרטת דמו ${id}`,
  lat: 31.41,
  lng: 34.45,
  precision: "approx",
  place_he: "יישוב דמו",
  summary_he: "תקציר דמו של אנדרטה שנכתב לבדיקה בלבד.",
  curated: { links: [{ label_he: "מקור דמו", url: "https://example.org/a" }], coord_source: "osm", region: "envelope" },
  photos: [],
  sources,
  ...extra,
})
export const post = (b: unknown, key = crypto.randomUUID().replaceAll("-", "")) =>
  admin("/api/admin/places", { method: "POST", body: JSON.stringify(b), headers: { "Idempotency-Key": key } })
export const curatedIn = async (id: string) => (await feed()).find((p) => p.id === id) as PublicCuratedPlace | undefined
export const viewRev = async (id: string) => (await (await admin(`/api/admin/places/${id}`)).json<{ rev: number }>()).rev
let n = 0
export const newId = () => `demo-curated-${Date.now().toString(36)}-${n++}`

/** A real 1×1 WebP, so the share image's renderer has a picture it can decode. */
export const TINY_WEBP = Uint8Array.from(atob("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=="), (c) => c.charCodeAt(0))

/**
 * Some of the site's own places, put into this test's database the way the dev server and the e2e state get them: the
 * importer, through the moderators' route (phase 7, task 2). Insert-only, so calling it again is harmless.
 */
export async function seedCurated(ids: string[]) {
  const records = fixtures.places.filter((p) => ids.includes(p.id))
  if (records.length !== ids.length)
    throw new Error(`not in fixtures/curated.json: ${ids.filter((id) => !records.some((r) => r.id === id))}`)
  return importCurated({
    fetch: async (url, init) => call(url, init),
    base: "http://local",
    records,
    readPhoto: async (file) => ({ file: TINY_WEBP, thumb: TINY_WEBP, name: file }),
    headers: { "Cf-Access-Jwt-Assertion": await devToken("dev@example.test") },
  })
}
