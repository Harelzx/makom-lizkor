import type { Place } from "@/types"

/**
 * A place as it may leave the device in an exported file: no key it is sent under, no tracking link, no email or name.
 * The file is a backup a visitor may send on (About asks them to); those are their private capability and details.
 */
export function exportable(places: Place[]): Place[] {
  return places.map((p) => {
    if (!p.local) return p
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- left out on purpose
    const { submitKey, trackingToken, remoteId, submission, send, sendError, nextTryAt, ...kept } = p.local
    return { ...p, local: kept }
  })
}

/** A place read from a file: shown on this device only, and never sent from it on its own (the form wasn't seen here). */
export const importable = (places: Place[]): Place[] => exportable(places)
