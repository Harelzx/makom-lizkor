import type { MiddlewareHandler } from "hono"
import type { AppEnv } from "../index"
import { rateKey } from "./ids"
import { problem } from "./http"

/** Counts at the edge before a parser, database lookup or provider call. No address is persisted. */
export function requestCap(
  binding: "SUBMIT_LIMIT" | "TRIBUTE_LIMIT" | "REPORT_LIMIT" | "READ_LIMIT" | "TILE_LIMIT",
  scope = "",
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const address = c.req.header("CF-Connecting-IP")
    if (address) {
      const secret = binding === "TRIBUTE_LIMIT" ? c.env.TRIBUTE_SECRET : c.env.TRACKING_SECRET
      if (!secret || !c.env[binding]) return problem(c, 503, "not_configured")
      // Scope is applied AFTER address canonicalization. Prefixing the IPv6 input defeats /64 grouping.
      const key = `${scope}${await rateKey(secret, address)}`
      if (!(await c.env[binding].limit({ key })).success) return problem(c, 429, "rate_limited", {}, { "Retry-After": "60" })
    }
    await next()
  }
}

/** Bounds ACTUAL UTF-8/multipart bytes, even without a length or with a misleading length. */
export function boundedBody(maxBytes: number): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const raw = c.req.raw
    const declared = raw.headers.get("Content-Length")
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
      await raw.body?.cancel().catch(() => undefined)
      return problem(c, 413, "too_large")
    }
    if (!raw.body) return next()
    const reader = raw.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > maxBytes) {
          await reader.cancel().catch(() => undefined)
          return problem(c, 413, "too_large")
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const headers = new Headers(raw.headers)
    headers.set("Content-Length", String(size))
    c.req.raw = new Request(raw, { body: bytes, headers })
    await next()
  }
}

export const PUBLIC_JSON_BYTES = 24 * 1024
export const PHOTO_REQUEST_BYTES = 5 * 1024 * 1024
