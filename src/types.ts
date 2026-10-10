import type { SubmissionInput } from "@/shared/contract"

export type Kind = "community" | "monument" | "bench" | "lookout" | "grove" | "garden" | "plaque" | "shelter" | "site" | "museum" | "other"

export interface Link {
  label_he: string
  url: string
}

export interface Photo {
  /** The photo and its thumbnail: the media route for places in the database, the bundled files until phase 7 ends. */
  url: string
  thumb_url: string
  title: string
  commons_url: string
  author: string
  license: string
  license_url: string
  subject_he: string
}

export interface Revival {
  status: "full" | "partial" | "not-yet" | "unknown"
  date?: string | null
  note_he?: string
  milestones_he: string[]
  revival_he: string
  sources: Link[]
  confidence: "high" | "medium" | "low"
}

export interface Place {
  id: string
  name_he: string
  kind: Kind
  lat: number
  lng: number
  precision: "exact" | "approx"
  place_he: string
  summary_he: string
  established?: number | null
  links: Link[]
  coord_source: "osm" | "wikidata" | "manual" | "community" | "contribution"
  coord_source_url?: string
  /** Legacy envelope collection/safety label. Navigation regions are derived separately from coordinates. */
  region: "envelope" | "country"
  photos?: Photo[]
  /** Whom a contributed place remembers, as the family wrote it. */
  inMemoryOf?: string
  /** How to visit a contributed place on private property, shown exactly with its owner's permission. */
  accessNote?: string
  /** A contributed place's photo, approved with it and served from the site. */
  contributedPhoto?: { url: string; alt: string; credit?: string }
  /** Only on attacked communities. */
  revival?: Revival
  /** Only on places a visitor added on this device. */
  local?: LocalFields
}

export interface LocalFields {
  createdAt: string
  consentAt: string
  inMemoryOf?: string
  story?: string
  submitter?: string
  photo?: string
  photoAlt?: string
  photoCredit?: string
  /** The id the server gave this place when it was sent for review; once approved, the feed carries it. */
  remoteId?: string
  /** The private capability to follow the submission's status; only its hash is on the server. */
  trackingToken?: string
  /** One key per place, made before the first try: every retry is the same submission (Idempotency-Key). */
  submitKey?: string
  /** Exactly what was sent, so a retry sends the same body. */
  submission?: SubmissionInput
  /** sending: on its way (or cut off by a closed tab) · waiting: unreachable, retried on its own · sent · rejected: never
   *  resent · withdrawn: taken back by the sender, erased on the server */
  send?: "sending" | "waiting" | "sent" | "rejected" | "withdrawn"
  /** The server's reason, when it refused the place, or why it asked to wait. */
  sendError?: string
  /** Not before this time (ms): the server asked to wait (a full queue, too many at once). */
  nextTryAt?: number
  /** The photo reached the server with the place (it stays here too). Unset while it still has to be sent. */
  photoSent?: boolean
  /** The server refused the photo (not a picture, too large): it isn't sent again. */
  photoError?: string
}
