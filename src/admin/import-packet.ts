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
    throw new Error("קובץ תמונה פגום או גדול מדי.")
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
  if (bytes.length > 4 * 1024 * 1024) throw new Error("קובץ תמונה גדול מדי.")
  const ascii = (a: number, b: number) => String.fromCharCode(...bytes.slice(a, b))
  if (
    !(bytes.length > 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") &&
    !(bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
  )
    throw new Error("התמונות חייבות להיות WebP או JPEG.")
  return bytes
}

/** Validate every record and picture before the first upload. The packet is selected locally, never part of the build. */
export function readImportPacket(text: string) {
  if (new TextEncoder().encode(text).byteLength > MAX_PACKET_BYTES) throw new Error("קובץ היבוא גדול מדי.")
  const parsed = schema.safeParse(JSON.parse(text))
  if (!parsed.success) throw new Error("קובץ היבוא אינו בפורמט הנדרש.")
  const { places, files } = parsed.data
  if (new Set(places.map((p) => p.id)).size !== places.length) throw new Error("יש מזהי מקום כפולים.")
  const pictures = new Map<string, { file: Uint8Array; thumb: Uint8Array; name: string }>()
  for (const place of places) {
    if (curatedSourceProblems(place.curated, place.photos, place.sources).length) throw new Error("חסר מקור למידע או לתמונה.")
    for (const photo of place.photos) {
      const bytes = files[photo.file]
      if (!bytes) throw new Error("חסרה תמונה בקובץ היבוא.")
      if (!pictures.has(photo.file)) pictures.set(photo.file, { file: picture(bytes.file), thumb: picture(bytes.thumb), name: photo.file })
    }
  }
  if (pictures.size !== Object.keys(files).length) throw new Error("קובץ היבוא כולל תמונות שאינן משויכות למקום.")
  return { places, pictures, photoCount: places.reduce((n, p) => n + p.photos.length, 0) }
}
