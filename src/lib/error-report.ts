/**
 * What a visitor's browser tells the Worker when the site's own code throws: the error's class and the file it came
 * from (its name, without the build hash), nothing more. Never the message or the stack, which can carry what someone
 * typed or a place's id. Errors from elsewhere (an extension, another origin, the opaque "Script error.") are not ours to
 * fix and are left out. Sent in the Reporting API's format to /api/csp-report, the one browser-report address Access
 * leaves open.
 */
const CLASS = /^[A-Z][A-Za-z]{0,39}$/

/**
 * What kind of failure it was, read from the message here in the browser and sent as one word from a closed list: the
 * network (a request that never got an answer), JSON (an answer that wasn't what the code expected), a file of the site
 * that didn't load, or other. The message itself never leaves the browser.
 */
export type ErrorKind = "network" | "json" | "chunk" | "other"
export function errorKind(error: Error): ErrorKind {
  const m = error.message ?? ""
  if (/importing a module script failed|dynamically imported module|loading (css )?chunk|unable to preload css/i.test(m)) return "chunk"
  if (error.name === "TimeoutError" || error.name === "AbortError") return "network"
  if (
    error.name === "TypeError" &&
    /failed to fetch|load failed|networkerror|network error|network connection was lost|fetch failed/i.test(m)
  )
    return "network"
  if (error.name === "SyntaxError" && /json|unexpected (token|end|character|non-whitespace)|did not match the expected pattern/i.test(m))
    return "json"
  return "other"
}

function chunkOf(url: string | undefined, origin: string) {
  if (!url?.startsWith(`${origin}/assets/`)) return null
  return /\/assets\/([a-z0-9-]+?)-[A-Za-z0-9_-]{8}\.js/.exec(url)?.[1] ?? null
}

export function clientErrorReport(event: { error?: unknown; filename?: string }, origin: string): string | null {
  const error = event.error
  if (!(error instanceof Error)) return null
  const frame = (error.stack ?? "").match(/https?:\/\/[^\s)]+/g)?.find((u) => u.startsWith(`${origin}/assets/`))
  const chunk = chunkOf(event.filename, origin) ?? chunkOf(frame, origin)
  if (!chunk) return null
  return JSON.stringify([
    { type: "client-error", body: { name: CLASS.test(error.name) ? error.name : "Error", chunk, kind: errorKind(error) } },
  ])
}

/** At most three a page: a loop that throws every frame should not become a stream of reports. */
export function watchErrors() {
  let left = 3
  const send = (event: { error?: unknown; filename?: string }) => {
    if (left <= 0 || !navigator.sendBeacon) return
    const body = clientErrorReport(event, location.origin)
    if (!body) return
    left--
    navigator.sendBeacon("/api/csp-report", new Blob([body], { type: "application/reports+json" }))
  }
  addEventListener("error", (e) => send({ error: e.error, filename: e.filename }))
  addEventListener("unhandledrejection", (e) => send({ error: e.reason }))
}

/**
 * What went wrong for a visitor that isn't an error thrown in our code, named from a closed list: the page crashed
 * (React gave up and the screen went blank), the map couldn't be drawn or its tiles or style didn't load, a picture didn't
 * load, the places couldn't be fetched, or an old tab asked for a build that is gone. Only the kind is sent, once per
 * kind a page: never which place, picture or tile.
 */
export const ISSUES = ["crash", "map_missing", "map_tiles", "map_style", "map_webgl", "image", "feed", "stale_bundle"] as const
export type Issue = (typeof ISSUES)[number]
const told = new Set<Issue>()

const beacon = (report: unknown) =>
  navigator.sendBeacon?.("/api/csp-report", new Blob([JSON.stringify([report])], { type: "application/reports+json" }))

export function reportIssue(kind: Issue) {
  if (told.has(kind)) return
  told.add(kind)
  try {
    beacon({ type: "client-issue", body: { kind } })
  } catch {
    /* a report that can't go is not worth an error of its own */
  }
}

export type Rating = "good" | "ni" | "poor"
const RATING = { good: "good", "needs-improvement": "ni", poor: "poor" } as const

/**
 * How fast this visit felt, once, when the visitor leaves or hides the page: Google's three ratings (good, needs
 * improvement, poor) for the largest paint, the slowest response to a tap, and how much the layout jumped. The rating
 * only, never the milliseconds, the page or the element. The visit itself is counted with it, so failures can be read
 * against how many visits there were.
 */
export function watchVisit() {
  const seen: Partial<Record<"lcp" | "inp" | "cls", Rating>> = {}
  let sent = false
  const send = () => {
    if (sent || document.visibilityState !== "hidden") return
    sent = true
    try {
      beacon({ type: "client-visit", body: seen })
    } catch {
      /* as above */
    }
  }
  void import("web-vitals")
    .then(({ onLCP, onINP, onCLS }) => {
      onLCP((m) => (seen.lcp = RATING[m.rating]))
      onINP((m) => (seen.inp = RATING[m.rating]))
      onCLS((m) => (seen.cls = RATING[m.rating]))
    })
    .catch(() => {})
    // Added after the library's own listeners, so the final ratings it settles on hiding are in.
    .finally(() => addEventListener("visibilitychange", send))
}
