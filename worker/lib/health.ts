import { METRIC_SAMPLE_EVERY } from "./metrics"
import { SiteHealth } from "./health-schema"

export { SiteHealth }

/** The counters keep two days (pruneCounters), so that is all there is to show. */
export const HEALTH_WINDOW_HOURS = 48

/** The moderators' site-health view: every hourly counter still kept, and the version that answered. */
export async function siteHealth(env: Env, now: Date): Promise<SiteHealth> {
  const since = new Date(Math.floor(now.getTime() / 3600_000) * 3600_000 - (HEALTH_WINDOW_HOURS - 1) * 3600_000).toISOString()
  const [metrics, seen] = await env.DB.batch([
    env.DB.prepare("SELECT hour, code, samples, total_ms, slow FROM request_metrics WHERE hour >= ? ORDER BY hour, code").bind(since),
    env.DB.prepare("SELECT sent_at FROM job_alerts WHERE job = 'health_seen'"),
  ])
  const results = metrics.results as { hour: string; code: string; samples: number; total_ms: number; slow: number }[]
  return SiteHealth.parse({
    generated_at: now.toISOString(),
    version: env.CF_VERSION_METADATA?.tag || null,
    sample_every: METRIC_SAMPLE_EVERY,
    window_hours: HEALTH_WINDOW_HOURS,
    seen_at: (seen.results[0] as { sent_at: string } | undefined)?.sent_at ?? null,
    // A code this view doesn't know (an older row, a future one) is left out rather than failing the whole view.
    hours: results.filter((r) => /^(http_[1-5]\d\d|(err|ev)_[a-z][a-z0-9_]{0,47})$/.test(r.code)),
  })
}

/**
 * A moderator looked at the failures: kept as a time beside the alerts' own (job_alerts, «health_seen»), so the screen
 * reads only what came after it, for every moderator. Null takes it back. The counters themselves are never touched.
 */
export async function markHealthSeen(env: Env, at: Date | null) {
  if (!at) await env.DB.prepare("DELETE FROM job_alerts WHERE job = 'health_seen'").run()
  else
    await env.DB.prepare(
      "INSERT INTO job_alerts (job, sent_at) VALUES ('health_seen', ?1) ON CONFLICT (job) DO UPDATE SET sent_at = excluded.sent_at",
    )
      .bind(at.toISOString())
      .run()
}
