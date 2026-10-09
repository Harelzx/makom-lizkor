import { uploadPhoto } from "@/lib/api"
import { unacceptedLocal } from "@/lib/local-policy"
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

/** Only photos of accepted submissions retry. Unaccepted places are discarded, never sent in the background. */
export async function retryWaiting(): Promise<void> {
  if (busy) return
  busy = true
  try {
    for (const p of useStore.getState().local) {
      if (unacceptedLocal(p)) await useStore.getState().removeLocal(p.id)
    }
    await sendPhotos()
  } finally {
    busy = false
  }
}
