/**
 * What a visitor's browser tells the Worker when the site's own code throws: the error's class and the file it came
 * from (its name, without the build hash), nothing more. Never the message or the stack, which can carry what someone
 * typed or a place's id. Errors from elsewhere (an extension, another origin, the opaque "Script error.") are not ours to
 * fix and are left out. Sent in the Reporting API's format to /api/csp-report, the one browser-report address Access
 * leaves open.
 */
const CLASS = /^[A-Z][A-Za-z]{0,39}$/

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
  return JSON.stringify([{ type: "client-error", body: { name: CLASS.test(error.name) ? error.name : "Error", chunk } }])
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
