/**
 * The site's security headers (spec 11), in one place for both of their carriers: public/_headers for the static files
 * (written from this module by scripts/security-headers.mjs, and a test fails when the two differ), and the Worker's
 * middleware for everything it answers itself. No imports, so Node can read it too.
 *
 * The policy is enforced. Full browser compatibility and same-SHA staging are required before its production rollout.
 * Turnstile's one documented host is challenges.cloudflare.com (Cloudflare's Turnstile docs, 2026-10-06); the spec's
 * "two new hostnames" were not found there and are not guessed here. The map's tiles and terrain come from the
 * site itself, and its labels from the site's own fonts; its worker is the site's own module file, not a blob.
 */
export const CSP = [
  "default-src 'self'",
  // The client photo encoder compiles its bundled WASM. This does NOT permit JavaScript eval/Function.
  "script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com",
  // motion writes inline styles (spec 11).
  "style-src 'self' 'unsafe-inline'",
  // A visitor's own photos are data: and blob: URLs from the device's storage.
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // The map's tiles and terrain are the site's own (src/shared/tiles.ts): no tile server is trusted.
  "connect-src 'self' https://challenges.cloudflare.com",
  "worker-src 'self'",
  "frame-src https://challenges.cloudflare.com",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "report-uri /api/csp-report",
].join("; ")

export const SECURITY_HEADERS = {
  // No includeSubDomains or preload until the domain and its other hosts are known (go-live checklist).
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(self), camera=(), microphone=(), payment=(), usb=(), browsing-topics=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  // Also protects older clients that don't implement frame-ancestors.
  "X-Frame-Options": "DENY",
} as const

/** Hash only Vite's trusted development preamble. Production/staging never gain inline-script permission. */
export async function developmentPreamble(site: Response, environment: string): Promise<Response> {
  if (environment !== "development") return site
  const reader = site.body?.getReader()
  if (!reader) return site
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 128 * 1024) throw new Error("Development asset HTML exceeded its bound")
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  const html = new TextDecoder().decode(bytes),
    hashes: string[] = []
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (
      /\bsrc\s*=/i.test(script[1]) ||
      !/\btype\s*=\s*(["'])module\1/i.test(script[1]) ||
      !/\bimport\s+(?:\w+|\{[^}]*\})\s+from\s*["']\/@react-refresh["']/.test(script[2])
    )
      continue
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(script[2].replace(/\r\n?/g, "\n"))))
    hashes.push(`'sha256-${btoa(String.fromCharCode(...digest))}'`)
  }
  const headers = new Headers(site.headers)
  if (hashes.length) headers.set("Content-Security-Policy", CSP.replace("script-src 'self'", `script-src 'self' ${hashes.join(" ")}`))
  return new Response(bytes, { status: site.status, headers })
}

/** Sets the headers on a response the Worker made: replaced, never added beside a copy the page already carried. A
 * response with its own Content-Security-Policy (a photo's sandbox) keeps it, without the page's policy beside it. */
export function secure(headers: Headers) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value)
  headers.delete("Content-Security-Policy-Report-Only")
  if (!headers.has("Content-Security-Policy")) headers.set("Content-Security-Policy", CSP)
}
