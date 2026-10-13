import { createStore, get, set, update, type UseStore } from "idb-keyval"
import type { Place } from "@/types"

// The visitor's own copy of what they added, and their anemones, in this browser's IndexedDB. A place is also sent
// for review (src/lib/api.ts); its photo and the anemones stay here.
let store: UseStore | null | undefined
/** Null when the browser won't give us IndexedDB (a private window, a blocked site): the site works without it. */
function db(): UseStore | null {
  if (store === undefined) {
    try {
      // idb-keyval opens the database lazily, so a browser with no IndexedDB at all would only fail on first use.
      store = typeof indexedDB === "undefined" ? null : createStore("makom-lizkor-v2", "v1")
    } catch {
      store = null
    }
  }
  return store
}

/** The visitor's places as stored; null when the device couldn't be read (then nothing is known about what it holds). */
export async function loadLocal(): Promise<Place[] | null> {
  try {
    const s = db()
    if (!s) return null
    return (await get<Place[]>("local", s)) ?? []
  } catch {
    return null
  }
}

/**
 * Changes the stored places in one transaction: what is stored now is read, changed and written back. Another tab may
 * have stored places since this one loaded, so a change is applied to the stored records, never by writing this tab's
 * copy over them (that lost the other tab's place, with the only key it is sent under). Returns what is stored now;
 * throws when the browser keeps nothing.
 */
export async function changeLocal(change: (stored: Place[]) => Place[]): Promise<Place[]> {
  const s = db()
  if (!s) throw new Error("storage_unavailable")
  let next: Place[] = []
  await update<Place[]>("local", (stored) => (next = change(stored ?? [])), s)
  return next
}

const visitIds = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(id)))] : []

export async function loadSavedVisits(): Promise<string[] | null> {
  try {
    const s = db()
    return s ? visitIds(await get("saved-visits", s)) : null
  } catch {
    return null
  }
}

/** Atomic across tabs, separate from submissions and their private capabilities. */
export async function changeSavedVisits(change: (ids: string[]) => string[]): Promise<string[]> {
  const s = db()
  if (!s) throw new Error("storage_unavailable")
  let next: string[] = []
  await update("saved-visits", (stored) => (next = visitIds(change(visitIds(stored)))), s)
  return next
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

let device: Promise<string | null> | undefined
/**
 * This device's random id for the shared anemone count, kept in IndexedDB and read back before it is trusted. Null
 * when the browser won't keep it: then nothing is sent, since a new id each visit would count one device many times.
 * Made only when asked to (`create`, when an anemone is left at a counted place), never just by opening the site.
 */
export function deviceId(create = false): Promise<string | null> {
  if (device) return device.then((id) => id ?? (create ? (device = makeDevice()) : null))
  const found = makeDevice(create)
  if (create) device = found
  return found
}

const valid = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f]{32}$/.test(id)

async function makeDevice(create = true): Promise<string | null> {
  try {
    const s = db()
    if (!s) return null
    const known = await get<string>("device", s)
    if (valid(known)) return known
    if (!create) return null
    const id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("")
    // In one transaction: an id another tab stored meanwhile is kept, so two tabs leaving their first anemone at once
    // end up with the same one. Whatever is stored after it is the id, once it reads back.
    await update<string>("device", (stored) => (valid(stored) ? stored : id), s)
    const kept = await get<string>("device", s)
    return valid(kept) ? kept : null
  } catch {
    return null
  }
}

/** Whether this browser keeps what the site stores (so a device id could be kept), without storing anything. */
export async function storageWorks(): Promise<boolean> {
  try {
    const s = db()
    if (!s) return false
    await get("device", s)
    return true
  } catch {
    return false
  }
}

/**
 * An anemone's place in the queue: waiting to be counted (its key, kept through every retry, and when it was left), or
 * answered on a Jerusalem day (more taps that day send nothing). One record per place, so a tap and an answer can't
 * slip between two writes.
 */
export type PendingTribute = { key: string; at: number }
export type TributeEntry = PendingTribute | { day: string }

/** Changes the anemones' queue in one transaction (another tab may be sending too). */
export async function changeTributeOutbox(
  change: (stored: Record<string, TributeEntry>) => Record<string, TributeEntry>,
): Promise<Record<string, TributeEntry>> {
  const s = db()
  if (!s) throw new Error("storage_unavailable")
  let next: Record<string, TributeEntry> = {}
  await update<Record<string, TributeEntry>>("tributeOutbox", (stored) => (next = change(stored ?? {})), s)
  return next
}

/**
 * Removal and correction requests sent from this browser whose arrival isn't confirmed yet, by key: kept, as sent,
 * from just before the first try until an answer for that key, or until the window from the first try ends (notice
 * notice.report@2026-10-3), so a resend is the same request.
 */
export async function changeReportOutbox<T>(change: (stored: Record<string, T>) => Record<string, T>): Promise<Record<string, T>> {
  const s = db()
  if (!s) throw new Error("storage_unavailable")
  let next: Record<string, T> = {}
  await update<Record<string, T>>("reportOutbox", (stored) => (next = change(stored ?? {})), s)
  return next
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

/**
 * Contributions this browser learned are not public (their share page answered 404 or 410): kept off its offline copy
 * of the feed, across reloads. Each mark carries a generation from a counter kept with the marks and raised in the same
 * transaction, so the order of what this browser learned never depends on its clock. A feed check notes the generation
 * when it starts; its response lifts only marks it lists that were made at or before then, so a response already on
 * its way when a removal was learned can't undo it, while a later feed can relist. Empty without storage.
 */
type Unlisted = { gen: number; marks: Record<string, number> }
const unlisted = (stored: unknown): Unlisted => {
  const u = stored as Partial<Unlisted> | undefined
  return u && typeof u.gen === "number" && u.marks && typeof u.marks === "object" ? (u as Unlisted) : { gen: 0, marks: {} }
}

export async function markUnlisted(id: string): Promise<void> {
  try {
    const s = db()
    if (s)
      await update<Unlisted>("unlisted", (old) => ((u) => ({ gen: u.gen + 1, marks: { ...u.marks, [id]: u.gen + 1 } }))(unlisted(old)), s)
  } catch {
    /* the page itself still keeps it off while it is open */
  }
}

export async function loadUnlisted(): Promise<string[]> {
  try {
    const s = db()
    return Object.keys(unlisted(s ? await get("unlisted", s) : undefined).marks)
  } catch {
    return []
  }
}

/** Where the marks stand now: noted when a feed check begins. */
export async function unlistedGeneration(): Promise<number> {
  try {
    const s = db()
    return unlisted(s ? await get("unlisted", s) : undefined).gen
  } catch {
    return 0
  }
}

/** A live feed asked for at generation `askedGen` lists these places: marks made at or before it are lifted. */
export async function relistPublished(ids: string[], askedGen: number): Promise<void> {
  try {
    const s = db()
    const listed = new Set(ids)
    if (s)
      await update<Unlisted>(
        "unlisted",
        (old) => {
          const u = unlisted(old)
          return { gen: u.gen, marks: Object.fromEntries(Object.entries(u.marks).filter(([id, g]) => !(listed.has(id) && g <= askedGen))) }
        },
        s,
      )
  } catch {
    /* nothing to undo without storage */
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
  try {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL("image/jpeg", 0.84)
  } finally {
    bitmap.close()
  }
}
