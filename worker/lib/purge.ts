import { durations } from "../lib/durations"
import type { OpEnv } from "../db/ops"

/** Clears the edge's copies tagged with any of `tags`; true when the edge accepted it. */
export type Purge = (env: Env, ctx: unknown, tags: string[]) => Promise<boolean>

type EdgeCache = { purge(options: { tags: string[] }): Promise<{ success: boolean }> }

/**
 * The Workers cache's purge: ctx.cache.purge({ tags }), which resolves to { success, errors } (Cloudflare's "Purge and
 * invalidate the cache", checked 2026-10-06). The site launches with the Worker's cache off (EDGE_CACHE=off, C-CACHE):
 * then Cloudflare runs the Worker on every request and stores none of its answers (Workers Cache docs, read 7 October),
 * so the edge holds no copy and there is nothing to clear. With the cache on, a missing cache is nothing to clear only in
 * development; anywhere else it is a failure, recorded and retried, never taken as done. Any mode but "off" counts as on,
 * so a missing or mistyped one shows as failed purges rather than skipped ones. release-cache.mjs holds the mode to
 * wrangler.jsonc's `cache` block, and edge-check fails a deployment in off mode whose answers come from a cache.
 */
export const edgePurge: Purge = async (env, ctx, tags) => {
  if (env.EDGE_CACHE === "off") return true
  const cache = (ctx as { cache?: EdgeCache } | undefined)?.cache
  if (!cache) return env.ENVIRONMENT === "development"
  try {
    return (await cache.purge({ tags })).success
  } catch {
    return false
  }
}

/** What a recorded decision reaches, from a request: its bindings and the purge with the request's own context. */
export function opEnv(c: { env: Env; get(key: "purge"): Purge; readonly executionCtx: unknown }): OpEnv {
  let ctx: unknown
  try {
    ctx = c.executionCtx
  } catch {
    ctx = undefined
  }
  return {
    db: c.env.DB,
    media: c.env.MEDIA,
    ledger: c.env.LEDGER,
    purge: (tags) => c.get("purge")(c.env, ctx, tags),
    durations: durations(c.env),
  }
}
