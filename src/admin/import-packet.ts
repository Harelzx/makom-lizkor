import { z } from "@/shared/zod"
import { CuratedInput, CuratedPhotoMeta, curatedSourceProblems } from "@/shared/curated"

export const MAX_PACKET_BYTES = 64 * 1024 * 1024
const filename = /^[a-zA-Z0-9_-]+\.(webp|jpg|jpeg)$/
const record = CuratedInput.omit({ expectedRev: true, photos: true }).extend({
  photos: z.array(CuratedPhotoMeta.extend({ file: z.string().regex(filename) }).strict()).max(12),
})
const schema = z
  .object({
    format: z.literal("makom-curated-v1"),
    places: z.array(record).min(1).max(200),
    files: z.record(z.string().regex(filename), z.object({ file: z.string(), thumb: z.string() }).strict()),
  })
  .strict()

function picture(encoded: string): Uint8Array {
  if (!encoded || encoded.length > Math.ceil((4 * 1024 * 1024) / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    throw new Error("אחת התמונות בקובץ פגומה או גדולה מדי. צריך להכין את הקובץ מחדש.")
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
  if (bytes.length > 4 * 1024 * 1024) throw new Error("אחת התמונות בקובץ גדולה מדי. צריך להכין את הקובץ מחדש.")
  const ascii = (a: number, b: number) => String.fromCharCode(...bytes.slice(a, b))
  if (
    !(bytes.length > 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") &&
    !(bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
  )
    throw new Error("אחת התמונות בקובץ בסוג שלא נתמך. צריך להכין את הקובץ מחדש.")
  return bytes
}

/** Validate every record and picture before the first upload. The packet is selected locally, never part of the build. */
export function readImportPacket(text: string) {
  if (new TextEncoder().encode(text).byteLength > MAX_PACKET_BYTES) throw new Error("הקובץ גדול מדי.")
  const parsed = schema.safeParse(JSON.parse(text))
  if (!parsed.success) throw new Error("זה לא קובץ המקומות שהוכן ליבוא. בדקו שבחרתם את הקובץ הנכון.")
  const { places, files } = parsed.data
  if (new Set(places.map((p) => p.id)).size !== places.length) throw new Error("אותו מקום מופיע בקובץ פעמיים. צריך להכין את הקובץ מחדש.")
  const pictures = new Map<string, { file: Uint8Array; thumb: Uint8Array; name: string }>()
  for (const place of places) {
    if (curatedSourceProblems(place.curated, place.photos, place.sources).length)
      throw new Error("לאחד המקומות חסר מקור למידע או לתמונה. צריך להכין את הקובץ מחדש.")
    for (const photo of place.photos) {
      const bytes = files[photo.file]
      if (!bytes) throw new Error("חסרה בקובץ תמונה של אחד המקומות. צריך להכין את הקובץ מחדש.")
      if (!pictures.has(photo.file)) pictures.set(photo.file, { file: picture(bytes.file), thumb: picture(bytes.thumb), name: photo.file })
    }
  }
  if (pictures.size !== Object.keys(files).length) throw new Error("יש בקובץ תמונות שלא שייכות לאף מקום. צריך להכין את הקובץ מחדש.")
  return { places, pictures, photoCount: places.reduce((n, p) => n + p.photos.length, 0) }
}
