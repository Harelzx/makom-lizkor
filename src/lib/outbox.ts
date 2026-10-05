import { submitPlace, uploadPhoto } from "@/lib/api"
import { useStore } from "@/store"

let busy = false

/** A place sent without its photo yet (the upload failed or was cut off): the photo follows on its own. */
async function sendPhotos() {
  for (const p of useStore.getState().local) {
    const l = p.local
    if (l?.send !== "sent" || !l.photo || l.photoSent || l.photoError || !l.remoteId || !l.trackingToken) continue
    if (!(await useStore.getState().stillLocal(p.id))) continue
    const r = await uploadPhoto(l.remoteId, l.trackingToken, l.photo, l.photoAlt || p.name_he, l.photoCredit)
    if (r === "ok") await useStore.getState().updateLocal(p.id, { photoSent: true })
    else if (r === "rejected") await useStore.getState().updateLocal(p.id, { photoError: "refused" })
    else break
  }
}

/** Sends again every place still waiting, with the key and body of its first try; refused ones are never resent. */
export async function retryWaiting(): Promise<void> {
  if (busy) return
  busy = true
  try {
    for (const p of useStore.getState().local) {
      const l = p.local
      if (l?.send !== "waiting" || !l.submitKey || !l.submission || (l.nextTryAt ?? 0) > Date.now()) continue
      // The list was read before the first send; a place removed since (here, or in another tab) isn't sent.
      if (!(await useStore.getState().stillLocal(p.id))) continue
      const r = await submitPlace(l.submission, l.submitKey)
      if (r.ok)
        await useStore.getState().updateLocal(p.id, { send: "sent", remoteId: r.id, trackingToken: r.trackingToken, submission: undefined })
      else if (r.kind === "rejected") await useStore.getState().updateLocal(p.id, { send: "rejected", sendError: r.code })
      else {
        // Still unreachable, or asked to wait: the next wake tries again, not before the server's time.
        if (r.retryAfter) await useStore.getState().updateLocal(p.id, { nextTryAt: Date.now() + r.retryAfter * 1000, sendError: r.code })
        break
      }
    }
    await sendPhotos()
  } finally {
    busy = false
  }
}
