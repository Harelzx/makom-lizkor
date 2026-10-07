/**
 * How long a retention day and hour last here (L-RET A2; adviser a78, a87). Everywhere they are real. On staging alone,
 * RETENTION_DAY_SECONDS=7200 makes a day two hours (and an hour five minutes), so spec 7's end-to-end test can watch the
 * retention, export and drill deadlines pass with the existing 15-minute cron. Only the lengths change: the clock, the
 * provider's timestamps, the notices' numbers (RETENTION in src/config.ts) and production's arithmetic (a month is 30
 * days, as it always was) stay as they are. Any other value, or the setting anywhere but staging, is refused before
 * anything uses it: a request or a job that would write or compare a deadline fails instead.
 */
export type Durations = { day: number; hour: number }

/** A month is 30 days, as it always was here (never a calendar month): 12 of them are 360 days. */
export const MONTH_DAYS = 30

export const REAL: Durations = { day: 86_400_000, hour: 3_600_000 }
/** The one staging day allowed: two hours, so 23 and 26 scaled hours (the export's cadence, the drill's limit) are 115 and 130 minutes. */
export const STAGING_DAY_SECONDS = 7200

export function durations(env: Pick<Env, "ENVIRONMENT"> & { RETENTION_DAY_SECONDS?: string }): Durations {
  const set = env.RETENTION_DAY_SECONDS ?? ""
  if (set === "") return REAL
  if (env.ENVIRONMENT !== "staging" || set !== String(STAGING_DAY_SECONDS))
    throw new Error(`RETENTION_DAY_SECONDS is ${STAGING_DAY_SECONDS} on staging or unset; refused here`)
  const day = STAGING_DAY_SECONDS * 1000
  return { day, hour: day / 24 }
}
