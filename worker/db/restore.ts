/**
 * How long a run with no recorded end may still have been deleting: a scheduled Worker is stopped after 15 minutes of
 * wall time (Cloudflare's limits, checked 2026-10-06), and a minute more covers a runtime update's grace.
 */
const RUN_LIFE_MS = 16 * 60_000

/**
 * Which restore a point in time allows (spec 7, decided 5.10; adviser 20261006T153309Z-ef1427c3). Restoring in place
 * (Route A, Time Travel) to a point before a deletion run ended would bring back what that run deleted, and the
 * provider's history would then hold it for another 30 days. Every run may have deleted, a failed one too (each part
 * runs on its own), so Route A goes only to a point at or after the end of the latest run of any kind: its recorded
 * end, or for one that never recorded it, the longest a scheduled run can live. And only once a run has succeeded:
 * without that record nothing shows what was or wasn't deleted, and no point is verified. Every other point is
 * restored through the filtered import (Route B).
 */
export async function restoreRoute(db: D1Database, point: Date): Promise<{ route: "A" | "B"; after: string | null; verified: boolean }> {
  const row = await db
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM retention_runs WHERE ok = 1) AS succeeded,
         MAX(COALESCE(finished_at, strftime('%Y-%m-%dT%H:%M:%fZ', started_at, '+' || ?1 || ' seconds'))) AS after
       FROM retention_runs`,
    )
    .bind(RUN_LIFE_MS / 1000)
    .first<{ succeeded: number; after: string | null }>()
  if (!row?.succeeded || !row.after) return { route: "B", after: null, verified: false }
  return { route: point.toISOString() >= row.after ? "A" : "B", after: row.after, verified: true }
}
