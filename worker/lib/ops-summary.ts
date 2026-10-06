import { checkDeletion } from "../db/exports"
import { ATTENTION, OpsSummary, OVERDUE_DAYS, PLACE_STATUSES, REPORT_STATUSES } from "./ops-schema"

export { OpsSummary }

/**
 * What the diagnostic agent may see of production (spec 10, 12.1; adviser a49): counts, dates and codes, under a closed
 * schema, so a field that could carry a person's words can't be added without the schema (and the release manifest's
 * snapshot of it) saying so. Error rates come from the structured logs through a source the deployment connects; with
 * none connected, or one that fails, they are unavailable, never zero.
 */

/** A log-backed aggregate: error responses by code over a window, and the requests in it (the denominator). */
export type ErrorRates = () => Promise<{ windowHours: number; requests: number; byCode: Record<string, number> } | null>

const snakeKeys = (o: Record<string, number>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), v]))

export async function opsSummary(env: Env, errorRates: ErrorRates | undefined, now: Date): Promise<OpsSummary> {
  const db = env.DB
  const overdueBefore = new Date(now.getTime() - OVERDUE_DAYS * 86_400_000).toISOString()
  const [places, queue, reports, attention, run, unfinished, exp, drill, alerts] = await db.batch([
    db.prepare("SELECT status, COUNT(*) AS n FROM places GROUP BY status"),
    db.prepare("SELECT COUNT(*) AS pending, SUM(created_at <= ?) AS overdue FROM revisions WHERE state = 'pending'").bind(overdueBefore),
    db.prepare("SELECT status, COUNT(*) AS n FROM reports GROUP BY status"),
    // The moderators' attention list (db/moderation.ts attention), counted by kind.
    db.prepare(
      `SELECT CASE WHEN state = 'refused' THEN 'interrupted'
                   WHEN intent = 'failed' OR ledger_commit = 'failed' THEN 'ledger_repair'
                   WHEN media = 'failed' THEN 'media_failed'
                   ELSE 'purge_abandoned' END AS problem, COUNT(*) AS n
       FROM visibility_ops
       WHERE (state = 'refused' AND refused_reason = 'interrupted' AND removal = 1)
          OR (state = 'applied' AND (intent = 'failed' OR ledger_commit = 'failed' OR media = 'failed' OR purge = 'abandoned'))
       GROUP BY problem`,
    ),
    db.prepare("SELECT started_at, finished_at, ok, counts FROM retention_runs ORDER BY started_at DESC, id DESC LIMIT 1"),
    db.prepare("SELECT COUNT(*) AS n FROM retention_runs WHERE finished_at IS NULL"),
    db.prepare("SELECT created_at, ok FROM exports ORDER BY created_at DESC LIMIT 1"),
    db.prepare("SELECT started_at, ok, failure FROM drill_runs ORDER BY started_at DESC LIMIT 1"),
    db.prepare("SELECT job, sent_at FROM job_alerts ORDER BY job"),
  ])
  const grouped = <K extends readonly string[]>(keys: K, rows: unknown[], key: string) => {
    const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K[number], number>
    for (const r of rows as Record<string, unknown>[])
      if ((keys as readonly unknown[]).includes(r[key])) out[r[key] as K[number]] = r.n as number
    return out
  }
  const q = queue.results[0] as { pending: number; overdue: number | null }
  const last = run.results[0] as { started_at: string; finished_at: string | null; ok: number | null; counts: string | null } | undefined
  const e = exp.results[0] as { created_at: string; ok: number | null } | undefined
  const d = drill.results[0] as { started_at: string; ok: number | null; failure: string | null } | undefined
  let errors: OpsSummary["errors"] = { status: "unavailable" }
  try {
    const rates = errorRates ? await errorRates() : null
    if (rates)
      errors = {
        status: "ok",
        window_hours: rates.windowHours,
        requests: rates.requests,
        by_code: rates.byCode,
        per_thousand: Object.fromEntries(
          Object.entries(rates.byCode).map(([k, n]) => [k, rates.requests ? Math.round((n * 1000 * 100) / rates.requests) / 100 : 0]),
        ),
      }
  } catch {
    errors = { status: "unavailable" }
  }
  return OpsSummary.parse({
    generated_at: now.toISOString(),
    places: grouped(PLACE_STATUSES, places.results, "status"),
    queue: { pending: q.pending, overdue: q.overdue ?? 0, overdue_days: OVERDUE_DAYS },
    reports: grouped(REPORT_STATUSES, reports.results, "status"),
    attention: grouped(ATTENTION, attention.results, "problem"),
    retention: {
      last: last
        ? {
            started_at: last.started_at,
            finished_at: last.finished_at,
            ok: last.ok === 1,
            counts: snakeKeys(JSON.parse(last.counts ?? "{}")),
          }
        : null,
      unfinished: (unfinished.results[0] as { n: number }).n,
    },
    export: e ? { created_at: e.created_at, ok: e.ok === 1 } : null,
    drill: d ? { started_at: d.started_at, ok: d.ok === null ? null : d.ok === 1, failure: d.failure } : null,
    deletion_check: await checkDeletion({ db, exports: env.EXPORTS, keys: env.EXPORT_PUBLIC_KEYS ?? "" }, now),
    alerts: alerts.results as { job: string; sent_at: string }[],
    errors,
  })
}
