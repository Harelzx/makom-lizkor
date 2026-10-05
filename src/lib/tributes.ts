import { getTributeTotals, sendTribute } from "@/lib/api"
import { changeTributeOutbox, changeTributeSent, deviceId, type PendingTribute } from "@/lib/storage"
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
  const sent = await changeTributeSent((s) => s).catch(() => ({}) as Record<string, string>)
  if (sent[placeId] === today()) return
  const key = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("")
  try {
    await changeTributeOutbox((o) => (o[placeId] ? o : { ...o, [placeId]: { key, at: Date.now() } }))
  } catch {
    return
  }
  await drainTributes()
}

/** Removes one waiting anemone, but only if it is still the one sent: another tab may have replaced it meanwhile. */
const settle = (placeId: string, sent: PendingTribute) =>
  changeTributeOutbox((o) => {
    if (o[placeId]?.key !== sent.key) return o
    const rest = { ...o }
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
    const waiting = await changeTributeOutbox((o) => o).catch(() => ({}) as Record<string, PendingTribute>)
    for (const [placeId, entry] of Object.entries(waiting)) {
      if (Date.now() - entry.at > WEEK) {
        await settle(placeId, entry)
        continue
      }
      const r = await sendTribute(placeId, id, entry.key)
      if (!r.ok && r.kind === "temporary") break
      await settle(placeId, entry)
      // Answered: the server has this device's anemone for today (or refused it); later taps today stay local. Only
      // today's entries are kept.
      const day = today()
      await changeTributeSent((s) => ({ ...Object.fromEntries(Object.entries(s).filter(([, d]) => d === day)), [placeId]: day })).catch(
        () => undefined,
      )
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
