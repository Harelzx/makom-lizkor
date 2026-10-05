import { createStore, get, set, type UseStore } from "idb-keyval"
import type { Place } from "@/types"

// The visitor's own copy of what they added, and their anemones, in this browser's IndexedDB. A place is also sent
// for review (src/lib/api.ts); its photo and the anemones stay here.
let store: UseStore | null | undefined
/** Null when the browser won't give us IndexedDB (a private window, a blocked site): the site works without it. */
function db(): UseStore | null {
  if (store === undefined) {
    try {
      store = createStore("makom-lizkor-v2", "v1")
    } catch {
      store = null
    }
  }
  return store
}

export async function loadLocal(): Promise<Place[]> {
  try {
    const s = db()
    return (s && (await get<Place[]>("local", s))) ?? []
  } catch {
    return []
  }
}

export async function saveLocal(places: Place[]): Promise<void> {
  const s = db()
  if (!s) throw new Error("storage_unavailable")
  await set("local", places, s)
}

export async function loadTributes(): Promise<Record<string, number>> {
  try {
    const s = db()
    return (s && (await get<Record<string, number>>("tributes", s))) ?? {}
  } catch {
    return {}
  }
}

export async function saveTributes(t: Record<string, number>): Promise<void> {
  try {
    const s = db()
    if (s) await set("tributes", t, s)
  } catch {
    /* a tribute that isn't saved is still a tribute */
  }
}

/** The last feed this browser received, kept whole: what the map shows with no connection (spec 5). */
export async function loadSnapshot(): Promise<unknown> {
  try {
    const s = db()
    return s ? await get("feed", s) : undefined
  } catch {
    return undefined
  }
}

export async function saveSnapshot(feed: unknown): Promise<void> {
  try {
    const s = db()
    if (s) await set("feed", feed, s)
  } catch {
    /* without storage there is simply no offline copy */
  }
}

export function downloadJSON(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Downscale a photo before storing it; re-encoding also drops EXIF location data. */
export async function resizeImage(file: File, max = 1600): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL("image/jpeg", 0.84)
}
