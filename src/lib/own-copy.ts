import { trackSubmission, type Tracked } from "@/lib/api"
import { useStore } from "@/store"

/** Once withdrawn or erased, there is nothing left to take back. */
export const FINAL = new Set(["withdrawn", "erased"])

/**
 * After a submission's status was read, the sender's own copy on this device follows it: a withdrawn place says so,
 * and the device stops keeping the tracking link once nothing is left to finish. While its files wait to be erased the
 * link stays, so the card can still open the view and finish them. A status read with another link (the mailed one,
 * which a withdrawal ends) says nothing of the copy's own, so the copy asks with its own.
 */
export async function settleOwnCopy(id: string, openedWith: string, status: Tracked | null | undefined): Promise<void> {
  const own = useStore.getState().local.find((p) => p.local?.remoteId === id)
  const token = own?.local?.trackingToken
  if (!own?.local) return
  const mine = token && token !== openedWith ? await trackSubmission(id, token) : status
  if (mine === undefined) return
  // A moderation refusal drops the accepted proposal's local copy too. A refused revision of a published place does not.
  if (mine?.status === "rejected") return void (await useStore.getState().removeLocal(own.id))
  // Without its own link, a 404 from another link proves nothing about this copy.
  if (mine === null && !token) return
  if (mine === null || (FINAL.has(mine.status) && !mine.files))
    return void (await useStore.getState().updateLocal(own.id, { send: "withdrawn", trackingToken: undefined, submitKey: undefined }))
  if (FINAL.has(mine.status) && own.local.send !== "withdrawn") await useStore.getState().updateLocal(own.id, { send: "withdrawn" })
}
