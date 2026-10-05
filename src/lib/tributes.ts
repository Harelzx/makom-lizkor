import { getTributeTotals, sendTribute } from "@/lib/api"
import { changeTributeOutbox, deviceId, type PendingTribute, type TributeEntry } from "@/lib/storage"
import { useStore } from "@/store"

/** An anemone not sent within a week is dropped; the visitor's own flowers stay (spec 4). */
const WEEK = 7 * 24 * 3600 * 1000

const JERUSALEM = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" })
/** Today in Jerusalem by this device's clock: only to avoid sending what the server would not count anyway. */
const today = () => JERUSALEM.format(new Date())

/** Whether anemones at a place reach the shared count: only places published on the server do (until phase 7). */
export const shared = (placeId: string) => placeId.startsWith("p_")

/** Whether this browser can take part in the shared count: it keeps a device id. */
export const canShare = () => deviceId().then((id) => id !== null)

/**
 * One anemone for the shared count, after the visitor's own flower is already there. At most one waits per place, so
 * ten taps send one; the server counts one a day per device anyway.
 */
export async function queueTribute(placeId: string) {
  if (!shared(placeId) || !(await deviceId())) return
  const key = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("")
  const day = today()
  try {
    // Waiting already, or answered today: nothing more to send. Otherwise a new anemone, in the same transaction.
    await changeTributeOutbox((o) => {
      const e = o[placeId]
      return e && ("key" in e || e.day === day) ? o : { ...o, [placeId]: { key, at: Date.now() } }
    })
  } catch {
    return
  }
  await drainTributes()
}

/**
 * The answer for one waiting anemone, recorded as the day it was answered, but only if it is still the one sent
 * (another tab may have replaced it). Answers from earlier days are dropped as they are no longer needed.
 */
const settle = (placeId: string, sent: PendingTribute, answered: boolean) =>
  changeTributeOutbox((o) => {
    const day = today()
    const kept = Object.fromEntries(Object.entries(o).filter(([, e]) => "key" in e || e.day === day))
    if ((o[placeId] as PendingTribute | undefined)?.key !== sent.key) return kept
    if (answered) return { ...kept, [placeId]: { day } }
    const rest = { ...kept }
    delete rest[placeId]
    return rest
  }).catch(() => undefined)

let draining = false
/** Sends what waits, each under the key it was given; stops at the first sign the server is unreachable. */
export async function drainTributes() {
  if (draining) return
  draining = true
  try {
    const id = await deviceId()
    if (!id) return
    const queue = await changeTributeOutbox((o) => o).catch(() => ({}) as Record<string, TributeEntry>)
    for (const [placeId, entry] of Object.entries(queue)) {
      if (!("key" in entry)) continue
      if (Date.now() - entry.at > WEEK) {
        await settle(placeId, entry, false)
        continue
      }
      const r = await sendTribute(placeId, id, entry.key)
      if (!r.ok && r.kind === "temporary") break
      // Answered: the server has this device's anemone for today (or refused it); later taps today stay local.
      await settle(placeId, entry, true)
      // Counted just now: the shared count shows it at once, before the next refresh.
      if (r.ok && r.result.counted && !r.result.reason) {
        const totals = useStore.getState().tributeTotals
        useStore.getState().setTributeTotals({ ...totals, [placeId]: (totals[placeId] ?? 0) + 1 })
      }
    }
  } finally {
    draining = false
  }
}

export async function refreshTotals() {
  const totals = await getTributeTotals()
  if (totals) useStore.getState().setTributeTotals(totals)
}

/** Once the day begins: the shared counts, and anything left waiting, now and whenever the tab comes back. */
export function startTributeSync(): () => void {
  const wake = () => {
    if (document.visibilityState !== "visible") return
    void drainTributes()
    void refreshTotals()
  }
  wake()
  document.addEventListener("visibilitychange", wake)
  window.addEventListener("online", wake)
  return () => {
    document.removeEventListener("visibilitychange", wake)
    window.removeEventListener("online", wake)
  }
}
