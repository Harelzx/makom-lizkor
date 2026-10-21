import { METRIC_SAMPLE_EVERY } from "./metrics"
import { SiteHealth } from "./health-schema"

export { SiteHealth }

/** The counters keep two days (pruneCounters), so that is all there is to show. */
export const HEALTH_WINDOW_HOURS = 48

/** The moderators' site-health view: every hourly counter still kept, and the version that answered. */
export async function siteHealth(env: Env, now: Date): Promise<SiteHealth> {
  const since = new Date(Math.floor(now.getTime() / 3600_000) * 3600_000 - (HEALTH_WINDOW_HOURS - 1) * 3600_000).toISOString()
  const { results } = await env.DB.prepare(
    "SELECT hour, code, samples, total_ms, slow FROM request_metrics WHERE hour >= ? ORDER BY hour, code",
  )
    .bind(since)
    .all<{ hour: string; code: string; samples: number; total_ms: number; slow: number }>()
  return SiteHealth.parse({
    generated_at: now.toISOString(),
    version: env.CF_VERSION_METADATA?.tag || null,
    sample_every: METRIC_SAMPLE_EVERY,
    window_hours: HEALTH_WINDOW_HOURS,
    // A code this view doesn't know (an older row, a future one) is left out rather than failing the whole view.
    hours: results.filter((r) => /^(http_[1-5]\d\d|err_[a-z][a-z0-9_]{0,47})$/.test(r.code)),
  })
}
