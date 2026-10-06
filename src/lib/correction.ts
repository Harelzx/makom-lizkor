import type { Draft, Tracked } from "@/lib/api"
import { cleanText } from "@/shared/text"

/** A correction waiting for review, or approved, was saved; one turned down, sent back or replaced was not. */
const SAVED = new Set(["pending", "approved"])
const NOT_SAVED = new Set(["rejected", "returned", "superseded"])

/**
 * Whether a correction whose answer was unclear (none came, or a retry was refused as stale) is the one the server
 * saved: the newest text there is the very text sent from here, compared as the server stores it (cleanText:
 * normalized, spaces folded), in a revision strictly newer than the one the form was opened on, and in a state that
 * means saved (waiting for review, or approved).
 */
export function savedHere(now: Tracked | null | undefined, sent: Partial<Record<keyof Draft, string>>, openedRev: number): boolean {
  return sameText(now, sent, openedRev) && SAVED.has(now!.revision_state ?? "")
}

/** This very correction reached the server, but was turned down, sent back or replaced since: it arrived, unaccepted. */
export function refusedHere(now: Tracked | null | undefined, sent: Partial<Record<keyof Draft, string>>, openedRev: number): boolean {
  return sameText(now, sent, openedRev) && NOT_SAVED.has(now!.revision_state ?? "")
}

function sameText(now: Tracked | null | undefined, sent: Partial<Record<keyof Draft, string>>, openedRev: number): boolean {
  // Only a strictly newer revision can be this correction; an equal, older or missing one can't.
  if (!now?.draft || typeof now.rev !== "number" || now.rev <= openedRev) return false
  const same = (a?: string | null, b?: string, multiline = false) => (a ?? "") === (b ? (cleanText(b, { multiline }) ?? b) : "")
  return (["name_he", "place_he", "in_memory_of", "story_he", "link_url"] as const).every((k) =>
    same(now.draft![k], sent[k], k === "story_he"),
  )
}
