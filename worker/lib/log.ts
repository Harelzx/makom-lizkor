/**
 * The Worker's only way to write a log line (spec 11). Workers Logs keep these lines and nothing else (invocation logs
 * are off), so what may appear in one is fixed here: a level, an event, and a few fields, each a code, an id, a route
 * pattern or a count. Never a request body, an address, a token, an email or a User-Agent. Every line the Worker's
 * test suite writes is checked against this (worker/test/log-guard.ts).
 */

type Level = "info" | "warn" | "error"
type Counts = Record<string, number>
export type LogFields = {
  /** What part of a job, what job, what went wrong: codes. */
  job?: string
  part?: string
  failure?: string
  /** An exception's class name (TypeError), or a code of ours (photo_unavailable); never its message. */
  error?: string
  /** A durable operation's id, a place's id. */
  op?: string
  place?: string
  /** A request's method and its route pattern (/api/v1/submissions/:id), never the path it was called with. */
  method?: string
  path?: string
  /** A CSP report: the directive broken, from the known list, and the kind of source blocked, never its host (a host's
   * labels can themselves identify someone), nor anything of the page. */
  directive?: string
  source?: CspSource
  found?: Counts
  counts?: Counts
}

/** The directives a report may name; anything else is logged as unknown. */
export const CSP_DIRECTIVES = [
  "default-src",
  "script-src",
  "script-src-elem",
  "script-src-attr",
  "style-src",
  "style-src-elem",
  "style-src-attr",
  "img-src",
  "font-src",
  "connect-src",
  "worker-src",
  "child-src",
  "frame-src",
  "media-src",
  "manifest-src",
  "object-src",
  "base-uri",
  "form-action",
  "frame-ancestors",
  "unknown",
] as const
/** What kind of source was blocked: the site itself, a provider we name, inline or eval, or unknown. */
export const CSP_SOURCES = ["self", "turnstile", "map_tiles", "terrain", "inline", "eval", "data", "blob", "unknown"] as const
export type CspSource = (typeof CSP_SOURCES)[number]

const CODE = /^[a-z][a-z0-9_]{0,47}$/
const FIELDS: Record<string, (v: unknown) => boolean> = {
  level: (v) => v === "info" || v === "warn" || v === "error",
  event: (v) => typeof v === "string" && CODE.test(v),
  job: (v) => typeof v === "string" && CODE.test(v),
  part: (v) => typeof v === "string" && CODE.test(v),
  failure: (v) => typeof v === "string" && CODE.test(v),
  error: (v) => typeof v === "string" && (CODE.test(v) || /^[A-Z][A-Za-z]{0,39}$/.test(v)),
  op: (v) => typeof v === "string" && /^t_[A-Za-z0-9_]{1,64}$/.test(v),
  place: (v) => typeof v === "string" && /^(p_[0-9A-Z]{26}|[a-z0-9][a-z0-9-]{0,63})$/.test(v),
  method: (v) => typeof v === "string" && /^[A-Z]{3,7}$/.test(v),
  // Route patterns are lowercase with :params; ids are uppercase, so a real path never passes.
  path: (v) => typeof v === "string" && /^\/[a-z0-9/:*_.-]*$/.test(v),
  directive: (v) => (CSP_DIRECTIVES as readonly unknown[]).includes(v),
  source: (v) => (CSP_SOURCES as readonly unknown[]).includes(v),
  found: (v) => isCounts(v),
  counts: (v) => isCounts(v),
  // The names of fields log() dropped: names from this list only, never what they held.
  dropped: (v) => Array.isArray(v) && v.every((k) => typeof k === "string" && k in FIELDS && k !== "level" && k !== "event"),
}
const isCounts = (v: unknown) =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  Object.entries(v).every(([k, n]) => CODE.test(k) && typeof n === "number" && Number.isFinite(n))

/** What's wrong with a line, by rule; empty when it's one we may keep. */
export function logLineProblems(line: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return ["not_json"]
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return ["not_an_object"]
  const o = parsed as Record<string, unknown>
  const problems: string[] = []
  if (!("level" in o)) problems.push("no_level")
  if (!("event" in o)) problems.push("no_event")
  for (const [k, v] of Object.entries(o)) {
    const check = FIELDS[k]
    if (!check) problems.push(`field_not_allowed:${k}`)
    else if (!check(v)) problems.push(`value_not_allowed:${k}`)
  }
  return problems
}

/**
 * Writes one line. A value outside its field's rule is dropped and only the field's name is kept (`dropped`): the line
 * never echoes what it refused. An event that isn't a code becomes `invalid_event`.
 */
export function log(level: Level, event: string, fields: LogFields = {}) {
  const record: Record<string, unknown> = { level, event: FIELDS.event(event) ? event : "invalid_event" }
  const dropped: string[] = []
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue
    if (k !== "dropped" && k in FIELDS && k !== "level" && k !== "event" && FIELDS[k](v)) record[k] = v
    else dropped.push(k in FIELDS ? k : "unknown_field")
  }
  if (dropped.length) record.dropped = dropped.filter((k) => k !== "unknown_field")
  const line = JSON.stringify(record)
  if (level === "error") console.error(line)
  else if (level === "warn") console.warn(line)
  else console.log(line)
}
