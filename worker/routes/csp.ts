import { Hono } from "hono"
import type { AppEnv } from "../index"
import { problem } from "../lib/http"
import { rateKey } from "../lib/ids"
import { CSP_DIRECTIVES, log, type CspSource } from "../lib/log"
import { recordFailure, recordVisit } from "../lib/metrics"

export const csp = new Hono<AppEnv>()

/** A report is a few hundred bytes; anything far past that is not one. */
const MAX_BYTES = 8 * 1024
/** A browser batches a handful at most (the Reporting API's format). */
const MAX_REPORTS = 10

const PROVIDERS: Record<string, CspSource> = {
  "challenges.cloudflare.com": "turnstile",
  "tiles.openfreemap.org": "map_tiles",
  "s3.amazonaws.com": "terrain",
}
const KEYWORDS: Record<string, CspSource> = { inline: "inline", eval: "eval", "wasm-eval": "eval", data: "data", blob: "blob" }

const directiveOf = (raw: unknown) => {
  const name = typeof raw === "string" ? raw.trim().split(/\s+/)[0].toLowerCase() : ""
  return (CSP_DIRECTIVES as readonly string[]).includes(name) ? name : "unknown"
}

/** The kind of source blocked: the site itself, a provider we name, a keyword, or unknown. Never the host itself. */
function sourceOf(raw: unknown, ownHost: string): CspSource {
  if (typeof raw !== "string") return "unknown"
  const scheme = raw.split(":")[0].toLowerCase()
  // Own keys only: a report naming "constructor" is not a kind of source.
  if (Object.hasOwn(KEYWORDS, raw)) return KEYWORDS[raw]
  if (scheme === "data" || scheme === "blob") return scheme
  try {
    const host = new URL(raw).host
    return host === ownHost ? "self" : Object.hasOwn(PROVIDERS, host) ? PROVIDERS[host] : "unknown"
  } catch {
    return "unknown"
  }
}

/** Both formats browsers send: report-uri's {"csp-report": {…}} and the Reporting API's [{type, body}]. */
function violations(parsed: unknown): { directive: unknown; blocked: unknown }[] {
  if (Array.isArray(parsed))
    return parsed
      .slice(0, MAX_REPORTS)
      .filter((r) => r?.type === "csp-violation" && typeof r.body === "object" && r.body)
      .map((r) => ({ directive: r.body.effectiveDirective ?? r.body.violatedDirective, blocked: r.body.blockedURL }))
  const r = (parsed as { "csp-report"?: Record<string, unknown> } | null)?.["csp-report"]
  if (!r || typeof r !== "object") return []
  return [{ directive: r["effective-directive"] ?? r["violated-directive"], blocked: r["blocked-uri"] }]
}

/** The site's own error reports (src/lib/error-report.ts): a class name and a file of ours, or unknown. Three at most. */
function clientErrors(parsed: unknown): { name: string; chunk: string }[] {
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((r) => r?.type === "client-error" && typeof r.body === "object" && r.body)
    .slice(0, 3)
    .map((r) => ({
      name: typeof r.body.name === "string" && /^[A-Z][A-Za-z]{0,39}$/.test(r.body.name) ? r.body.name : "unknown",
      chunk: typeof r.body.chunk === "string" && /^[a-z][a-z0-9-]{0,39}$/.test(r.body.chunk) ? r.body.chunk : "unknown",
    }))
}

const ISSUES = ["crash", "map_missing", "map_tiles", "map_style", "map_webgl", "image", "feed", "stale_bundle"]

/** What went wrong for a visitor, by kind from the closed list (src/lib/error-report.ts reportIssue); others are dropped. */
function clientIssues(parsed: unknown): string[] {
  if (!Array.isArray(parsed)) return []
  const kinds = parsed
    .filter((r) => r?.type === "client-issue" && typeof r.body === "object" && r.body && ISSUES.includes(r.body.kind))
    .map((r) => r.body.kind as string)
  return [...new Set(kinds)].slice(0, ISSUES.length)
}

/** A visit's ratings (watchVisit): one visit a report at most, each measure rated good, ni or poor. */
function clientVisit(parsed: unknown): string[] | null {
  if (!Array.isArray(parsed)) return null
  const r = parsed.find((x) => x?.type === "client-visit" && typeof x.body === "object" && x.body)
  if (!r) return null
  return (["lcp", "inp", "cls"] as const).filter((m) => ["good", "ni", "poor"].includes(r.body[m])).map((m) => `${m}_${r.body[m]}`)
}

/**
 * The body as text if it is at most MAX_BYTES bytes, read only that far: a body sent without a length (or with a false
 * one) is cancelled at the bound, never buffered whole. Null past the bound.
 */
async function bounded(body: ReadableStream<Uint8Array> | null): Promise<string | null> {
  if (!body) return ""
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    all.set(c, at)
    at += c.byteLength
  }
  return new TextDecoder().decode(all)
}

/**
 * A browser's report that the page policy was broken (spec 11). Logged as two codes, the directive and the kind of
 * source, so the move to enforcing can be judged; the page's address, the referrer, the file, the sample and the host
 * blocked are read past and never kept. A malformed report is answered and forgotten.
 */
csp.post("/", async (c) => {
  // A coarse ceiling per address, under a keyed code, so a page in a loop can't fill the log.
  const address = c.req.header("CF-Connecting-IP")
  if (address && c.env.TRACKING_SECRET && !(await c.env.CSP_LIMIT.limit({ key: await rateKey(c.env.TRACKING_SECRET, address) })).success)
    return problem(c, 429, "rate_limited", {}, { "Retry-After": "60" })
  if (Number(c.req.header("Content-Length") ?? 0) > MAX_BYTES) return c.body(null, 204)
  const text = await bounded(c.req.raw.body)
  if (text === null) return c.body(null, 204)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return c.body(null, 204)
  }
  const ownHost = new URL(c.req.url).host
  for (const v of violations(parsed))
    log("warn", "csp_report", { directive: directiveOf(v.directive), source: sourceOf(v.blocked, ownHost) })
  // Errors in the site's own code, from visitors' browsers: counted for the failures alert, logged as two codes.
  for (const e of clientErrors(parsed)) {
    log("warn", "client_error", { error: e.name, chunk: e.chunk })
    await recordFailure(c.env, "client_error").catch((err: Error) => log("error", "metrics_failed", { error: err.name }))
  }
  // What else went wrong for a visitor, and how fast a visit felt: counted by kind only, never logged.
  for (const kind of clientIssues(parsed))
    await recordFailure(c.env, `client_${kind}`).catch((err: Error) => log("error", "metrics_failed", { error: err.name }))
  const visit = clientVisit(parsed)
  if (visit) await recordVisit(c.env, visit).catch((err: Error) => log("error", "metrics_failed", { error: err.name }))
  return c.body(null, 204)
})
