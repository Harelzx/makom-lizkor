import type { OpEnv } from "../db/ops"

/** Clears the edge's copies tagged with any of `tags`; true when the edge accepted it. */
export type Purge = (env: Env, ctx: unknown, tags: string[]) => Promise<boolean>

type EdgeCache = { purge(options: { tags: string[] }): Promise<{ success: boolean }> }

/**
 * The Workers cache's purge (ctx.cache.purge, documented 2026-10). Locally there is no edge cache, so there is nothing to
 * clear; in production its absence is a failure, recorded and retried, never taken as done.
 */
export const edgePurge: Purge = async (env, ctx, tags) => {
  const cache = (ctx as { cache?: EdgeCache } | undefined)?.cache
  if (!cache) return env.ENVIRONMENT !== "production"
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
  return { db: c.env.DB, media: c.env.MEDIA, ledger: c.env.LEDGER, purge: (tags) => c.get("purge")(c.env, ctx, tags) }
}
