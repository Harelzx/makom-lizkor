import { env } from "cloudflare:workers"
import { describe, expect, it } from "vitest"
import { durations, REAL, STAGING_DAY_SECONDS } from "../lib/durations"

// The retention time scale (L-RET A2, a78, a87): staging alone may run its retention, export and drill deadlines on a
// shorter day, so spec 7's end-to-end test can watch them pass; the real clock, the notices and production's arithmetic
// stay as they are. One value only, 7200 seconds (a two-hour day), and only where ENVIRONMENT is staging.
const at = (ENVIRONMENT: string, RETENTION_DAY_SECONDS?: string) => ({ ...env, ENVIRONMENT, RETENTION_DAY_SECONDS }) as Env

describe("the retention time scale", () => {
  it("is a real day everywhere it isn't set", () => {
    for (const e of ["production", "staging", "development"]) expect(durations(at(e))).toEqual(REAL)
    expect(durations(at("production", ""))).toEqual(REAL)
    expect(REAL).toEqual({ day: 86_400_000, hour: 3_600_000 })
  })

  it("on staging, set to 7200, makes a day two hours and an hour five minutes", () => {
    expect(STAGING_DAY_SECONDS).toBe(7200)
    expect(durations(at("staging", "7200"))).toEqual({ day: 7_200_000, hour: 300_000 })
  })

  it("refuses any other value, and any value outside staging, before anything uses it", () => {
    for (const v of ["3600", "7200.0", " 7200", "abc", "0", "-7200"])
      expect(() => durations(at("staging", v)), v).toThrow(/RETENTION_DAY_SECONDS/)
    for (const e of ["production", "development", ""]) expect(() => durations(at(e, "7200")), e).toThrow(/RETENTION_DAY_SECONDS/)
  })

  it("is never set by what a deploy ships", () => {
    const shipped = (env as unknown as { DEPLOY_VARS: Record<string, string> }).DEPLOY_VARS
    expect(shipped.RETENTION_DAY_SECONDS ?? "").toBe("")
  })
})
