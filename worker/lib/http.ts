import type { Context } from "hono"

/** Anything authenticated must never sit in a shared cache. */
export const PRIVATE = { "Cache-Control": "private, no-store" } as const

/**
 * RFC 9457 problem details; the client turns `code` into Hebrew, the server never writes UI text.
 * Errors are never cached either: a 404 for a wrong tracking token must not be served to its rightful holder.
 */
export function problem(
  c: Context,
  status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 500 | 503,
  code: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return c.body(JSON.stringify({ type: "about:blank", status, code, ...extra }), status, {
    "Content-Type": "application/problem+json",
    ...PRIVATE,
    ...headers,
  })
}
