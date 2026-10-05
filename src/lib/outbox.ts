import { submitPlace } from "@/lib/api"
import { useStore } from "@/store"

let busy = false

/** Sends again every place still waiting, with the key and body of its first try; refused ones are never resent. */
export async function retryWaiting(): Promise<void> {
  if (busy) return
  busy = true
  try {
    for (const p of useStore.getState().local) {
      const l = p.local
      if (l?.send !== "waiting" || !l.submitKey || !l.submission) continue
      const r = await submitPlace(l.submission, l.submitKey)
      if (r.ok) await useStore.getState().updateLocal(p.id, { send: "sent", remoteId: r.id, trackingToken: r.trackingToken })
      else if (r.kind === "rejected") await useStore.getState().updateLocal(p.id, { send: "rejected", sendError: r.code })
      else break // still unreachable: the next wake tries again
    }
  } finally {
    busy = false
  }
}
