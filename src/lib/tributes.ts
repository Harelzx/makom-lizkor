import { getTributeTotals, sendTribute } from "@/lib/api"
import { changeTributeOutbox, deviceId, storageWorks, type PendingTribute, type TributeEntry } from "@/lib/storage"
import { useStore } from "@/store"

/** An anemone not sent within a week is dropped; the visitor's own flowers stay (spec 4). */
const WEEK = 7 * 24 * 3600 * 1000

const JERUSALEM = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" })
/** Today in Jerusalem by this device's clock: only to avoid sending what the server would not count anyway. */
const today = () => JERUSALEM.format(new Date())

/**
 * Whether anemones at a place reach the shared count: every place the server publishes does, the site's own places
 * included since they moved into the database (phase 7); a place kept only on this device never does.
 */
export const shared = (placeId: string) => !placeId.startsWith("local-")

/** Whether this browser can take part in the shared count: it keeps a device id. */
export const canShare = () => storageWorks()

/**
 * One anemone for the shared count, after the visitor's own flower is already there. At most one waits per place, so
 * ten taps send one; the server counts one a day per device anyway.
 */
export async function queueTribute(placeId: string) {
  if (!shared(placeId) || !(await deviceId(true))) return
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
 * The answer for one waiting anemone, recorded as the day it was counted on, but only if it is still the one sent
 * (another tab may have replaced it). Answers from earlier days are dropped as they are no longer needed.
 */
const settle = (placeId: string, sent: PendingTribute, countedOn: string | null) =>
  changeTributeOutbox((o) => {
    const kept = Object.fromEntries(Object.entries(o).filter(([, e]) => "key" in e || e.day === today()))
    if ((o[placeId] as PendingTribute | undefined)?.key !== sent.key) return kept
    if (countedOn) return { ...kept, [placeId]: { day: countedOn } }
    const rest = { ...kept }
    delete rest[placeId]
    return rest
  }).catch(() => undefined)

let draining = false
let again = false
/**
 * Sends what waits, each under the key it was given; stops at the first sign the server is unreachable. An anemone
 * left while a send is under way is picked up by the same run: it reads the outbox again before it ends.
 */
export async function drainTributes() {
  if (draining) return void (again = true)
  draining = true
  try {
    do {
      again = false
    } while ((await drainOnce()) && again)
  } finally {
    draining = false
  }
}

/** One pass over the outbox as it is now; false when the server was unreachable, so nothing more is tried. */
async function drainOnce(): Promise<boolean> {
  const queue = await changeTributeOutbox((o) => o).catch(() => ({}) as Record<string, TributeEntry>)
  if (!Object.values(queue).some((e) => "key" in e)) return true
  // Only an anemone left here made the id; nothing waiting, nothing read.
  const id = await deviceId()
  if (!id) return false
  for (const [placeId, entry] of Object.entries(queue)) {
    if (!("key" in entry)) continue
    if (Date.now() - entry.at > WEEK) {
      await settle(placeId, entry, null)
      continue
    }
    const r = await sendTribute(placeId, id, entry.key)
    if (!r.ok && r.kind === "temporary") return false
    // Answered: recorded under the day the server counts it on (a late answer may come after midnight), so later taps
    // that day stay local; a refusal is recorded as today's.
    await settle(placeId, entry, r.ok && "day" in r.result ? r.result.day : today())
    // Counted just now: the shared count shows it at once, before the next refresh.
    if (r.ok && r.result.counted && !r.result.reason) {
      const totals = useStore.getState().tributeTotals
      useStore.getState().setTributeTotals({ ...totals, [placeId]: (totals[placeId] ?? 0) + 1 })
    }
  }
  return true
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
