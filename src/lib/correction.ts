import type { Draft, Tracked } from "@/lib/api"
import { cleanText } from "@/shared/text"

/** A correction the moderators turned down, sent back, or replaced with a newer one is not one that was saved. */
const NOT_SAVED = new Set(["rejected", "returned", "superseded"])

/**
 * Whether a correction whose answer was unclear (none came, or a retry was refused as stale) is the one the server
 * saved: the newest text there is the very text sent from here, compared as the server stores it (cleanText:
 * normalized, spaces folded), in a revision newer than the one the form was opened on, and not turned down since.
 */
export function savedHere(now: Tracked | null | undefined, sent: Partial<Record<keyof Draft, string>>, openedRev: number): boolean {
  if (!now?.draft || now.rev === openedRev || NOT_SAVED.has(now.revision_state ?? "")) return false
  const same = (a?: string | null, b?: string, multiline = false) => (a ?? "") === (b ? (cleanText(b, { multiline }) ?? b) : "")
  return (["name_he", "place_he", "in_memory_of", "story_he", "link_url"] as const).every((k) =>
    same(now.draft![k], sent[k], k === "story_he"),
  )
}
