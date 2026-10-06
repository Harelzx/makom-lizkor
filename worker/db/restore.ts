/**
 * Which restore a point in time allows (spec 7, decided 5.10; advisers 20261006T153309Z-ef1427c3, 20261006T172339Z-c250f24e).
 * Restoring in place (Route A, Time Travel) to a point before a deletion run ended would bring back what that run
 * deleted, and the provider's history would then hold it for another 30 days. Every run may have deleted, a failed one
 * too (each part runs on its own), so Route A goes only to a point at or after the recorded end of the latest run. A run
 * with no recorded end proves nothing: its start is the time it was scheduled for, it may have begun later, deleted,
 * and stopped without a record, so while one is on record no point is verified. Nor is any before a run has succeeded.
 * Every other point is restored through the filtered import (Route B), which is always open.
 */
export async function restoreRoute(db: D1Database, point: Date): Promise<{ route: "A" | "B"; after: string | null; verified: boolean }> {
  const row = await db
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM retention_runs WHERE ok = 1) AS succeeded,
         EXISTS (SELECT 1 FROM retention_runs WHERE finished_at IS NULL) AS unfinished,
         MAX(finished_at) AS after
       FROM retention_runs`,
    )
    .first<{ succeeded: number; unfinished: number; after: string | null }>()
  if (!row?.succeeded || row.unfinished || !row.after) return { route: "B", after: null, verified: false }
  return { route: point.toISOString() >= row.after ? "A" : "B", after: row.after, verified: true }
}
