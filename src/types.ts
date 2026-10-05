export type Kind = "community" | "monument" | "bench" | "lookout" | "grove" | "garden" | "plaque" | "shelter" | "site" | "museum" | "other"

export interface Link {
  label_he: string
  url: string
}

export interface Photo {
  file: string
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
  coord_source: "osm" | "wikidata" | "manual" | "community"
  coord_source_url?: string
  /** Which area the place belongs to, for grouping: the Gaza envelope or elsewhere in Israel. */
  region: "envelope" | "country"
  photos?: Photo[]
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
}
