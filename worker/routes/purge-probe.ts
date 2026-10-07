import { Hono } from "hono"
import { probeCaller } from "../lib/access"
import { PRIVATE, problem } from "../lib/http"
import type { AppEnv } from "../index"

/**
 * The production purge probe (L-PURGE; adviser a73, Q2). Its address answers one number, the probe's generation, and
 * the edge keeps it a minute under its own tag; one dedicated service token moves the generation on and purges that tag.
 * A release watches a copy the edge held turn into the new generation, timed from the request: the purge mechanism seen
 * working in production with no place, person or content involved. A takedown never purges this tag, and this never
 * purges a takedown's.
 */
export const PROBE_TAG = "purge-probe"

/** A run's own address (?run=…) and an exercise's id: lowercase letters and digits, 12 to 32 of them. */
const RUN = /^[a-z0-9]{12,32}$/

export const probe = new Hono<AppEnv>()

probe.get("/", async (c) => {
  const run = c.req.query("run")
  if (!run || !RUN.test(run)) return problem(c, 400, "bad_run", {}, { "Cache-Control": "no-store" })
  const generation = await c.env.DB.prepare("SELECT generation FROM purge_probe WHERE id = 1").first<number>("generation")
  // The browser never keeps it; the edge keeps it as long as a feed (worker/routes/feed.ts), under the probe's tag alone.
  return c.json({ generation: generation ?? 0 }, 200, {
    "Cache-Control": "no-store",
    "Cloudflare-CDN-Cache-Control": "max-age=60",
    "Cache-Tag": PROBE_TAG,
  })
})

export const probeMove = new Hono<AppEnv>()

/**
 * Moves the generation from `expected` to the next, for one exercise, and purges the probe's tag. Exercises are
 * serialized: from a generation another one already moved, it is refused. The same exercise sent again, after it moved
 * the generation, gets the same answer and purges again, so a retry after a lost answer or a refused purge is safe.
 */
probeMove.post("/", async (c) => {
  const caller = await probeCaller(c.req.raw, c.env)
  if (!caller.ok) return problem(c, caller.status, caller.status === 401 ? "unauthorized" : "forbidden")
  const body = (await c.req.json().catch(() => null)) as { exercise?: unknown; expected?: unknown } | null
  const exercise = typeof body?.exercise === "string" && RUN.test(body.exercise) ? body.exercise : null
  const expected = Number.isSafeInteger(body?.expected) && (body?.expected as number) >= 0 ? (body?.expected as number) : null
  if (exercise === null || expected === null) return problem(c, 400, "bad_request")
  const db = c.env.DB
  const moved = await db
    .prepare("UPDATE purge_probe SET generation = generation + 1, exercise = ? WHERE id = 1 AND generation = ?")
    .bind(exercise, expected)
    .run()
  const now = await db
    .prepare("SELECT generation, exercise FROM purge_probe WHERE id = 1")
    .first<{ generation: number; exercise: string | null }>()
  const ours = !!now && now.generation === expected + 1 && now.exercise === exercise
  if (!moved.meta.changes && !ours) return problem(c, 409, "changed_meanwhile", { generation: now?.generation ?? null })
  const purged = await c.get("purge")(c.env, executionCtx(c), [PROBE_TAG])
  if (!purged) return problem(c, 503, "purge_failed", { generation: expected + 1 })
  return c.json({ generation: expected + 1, purged: true }, 200, PRIVATE)
})

function executionCtx(c: { readonly executionCtx: unknown }) {
  try {
    return c.executionCtx
  } catch {
    return undefined
  }
}
