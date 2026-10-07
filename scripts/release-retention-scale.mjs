// The staging-only retention day (worker/lib/durations.ts, L-RET A2) never ships: production's deadlines are real days.
// The Worker refuses the setting outside staging at runtime too.
export function retentionScaleBlockers(raw) {
  return (raw.vars?.RETENTION_DAY_SECONDS ?? "").trim()
    ? ["RETENTION_DAY_SECONDS is set in wrangler.jsonc: a shorter retention day is staging's alone, never production's"]
    : []
}
