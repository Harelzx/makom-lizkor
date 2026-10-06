/**
 * Which restore a point in time allows (spec 7, decided 5.10). Restoring in place (Route A, Time Travel) to a point
 * before the last deletion run that finished would bring back what that run deleted, and the provider's history would
 * then hold it for another 30 days. So Route A goes only to a point at or after that run's end, by the run record and
 * not by the clock; an earlier point is restored through the filtered import (Route B). With no finished run yet,
 * nothing has been deleted by the job, and any point is allowed.
 */
export async function restoreRoute(db: D1Database, point: Date): Promise<{ route: "A" | "B"; after: string | null }> {
  const after =
    (await db.prepare("SELECT MAX(finished_at) AS at FROM retention_runs WHERE ok = 1").first<{ at: string | null }>())?.at ?? null
  return { route: !after || point.toISOString() >= after ? "A" : "B", after }
}
