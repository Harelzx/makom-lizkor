import { createStore, get, set } from "idb-keyval"
import type { Place } from "@/types"

// Everything a visitor adds stays in this browser's IndexedDB. Nothing is sent anywhere.
const store = createStore("makom-lizkor-v2", "v1")

export async function loadLocal(): Promise<Place[]> {
  try {
    return (await get<Place[]>("local", store)) ?? []
  } catch {
    return []
  }
}

export async function saveLocal(places: Place[]): Promise<void> {
  await set("local", places, store)
}

export async function loadTributes(): Promise<Record<string, number>> {
  try {
    return (await get<Record<string, number>>("tributes", store)) ?? {}
  } catch {
    return {}
  }
}

export async function saveTributes(t: Record<string, number>): Promise<void> {
  try {
    await set("tributes", t, store)
  } catch {
    /* a tribute that isn't saved is still a tribute */
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
