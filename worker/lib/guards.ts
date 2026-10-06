import type { Element, ReportInput } from "@/shared/contract"

/**
 * The automatic path's safeguards (spec 6), in one place. Provisional values, to be tuned with experience; none of
 * them ever limits a moderator's manual hide, and none of them is a judgment that a request is credible.
 */
export const REPORT_GUARDS = {
  /** Automatic hides across the site: at most this many requests an hour, and this many a day. */
  perHour: 3,
  perDay: 10,
  /** The circuit breaker: from this many complete requests in an hour, the automatic path stops; people still review. */
  breakerPerHour: 10,
  /** Spam: more links than this in the explanation. */
  maxLinks: 2,
  /** Spam: more requests than this in a day from one visitor (counted under a keyed hash of the address). */
  reporterPerDay: 3,
  /** The backstop looks again this long after a complete request the automatic path didn't act on. */
  backstopHours: 24,
  /** Moderators are reminded this often until one records handling the request. */
  reminderHours: 6,
}

const letters = (s: string) => [...new Intl.Segmenter("he", { granularity: "grapheme" }).segment(s)].length

/**
 * complete(r) from spec 6: aimed at a published place's elements, from family or a rights holder (who may ask only
 * about a photo), with a relationship and an explanation of 20 characters as a person counts them. The browser check
 * has passed before this is asked. It decides only whether the automatic path may act; an incomplete request is still
 * accepted and reviewed by a person, and a complete one is never taken as credible.
 */
export function complete(
  r: Pick<ReportInput, "requesterType" | "relationship" | "explanation"> & { elements: readonly Element[] },
  target: { origin: "contribution" | "curated"; published: boolean },
): boolean {
  const targeted = target.origin === "contribution" && target.published && r.elements.length > 0
  const removalType = r.requesterType === "family" || (r.requesterType === "rights_holder" && r.elements.every((e) => e === "photo"))
  return targeted && removalType && !!r.relationship?.trim() && letters(r.explanation) >= 20
}

export const linkCount = (s: string) => (s.match(/https?:\/\/|www\./gi) ?? []).length

/** The explanation as a copy of it would read: case, spacing and punctuation don't make it a different one. */
export const normalizeExplanation = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, " ")
    .trim()

/** spamSignals(r) from spec 6, from what the server counted. */
export const isSpam = (s: { duplicate: boolean; links: number; reporterCount: number }) =>
  s.duplicate || s.links > REPORT_GUARDS.maxLinks || s.reporterCount > REPORT_GUARDS.reporterPerDay
