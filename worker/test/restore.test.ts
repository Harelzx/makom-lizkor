import { env } from "cloudflare:workers"
import { beforeEach, describe, expect, it } from "vitest"
import { restoreRoute } from "../db/restore"

const run = (id: string, started: string, finished: string | null, ok: 0 | 1) =>
  env.DB.prepare("INSERT INTO retention_runs (id, started_at, finished_at, ok, counts) VALUES (?, ?, ?, ?, '{}')")
    .bind(id, started, finished, ok)
    .run()

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM retention_runs").run()
})

describe("which restore a point allows (spec 7, Route A)", () => {
  it("restores in place only to a point at or after the last finished deletion run; earlier needs the filtered import", async () => {
    await run("rr_1", "2027-01-01T03:00:00.000Z", "2027-01-01T03:00:05.000Z", 1)
    await run("rr_2", "2027-01-02T03:00:00.000Z", "2027-01-02T03:00:04.000Z", 1)
    expect(await restoreRoute(env.DB, new Date("2027-01-02T03:00:04.000Z"))).toEqual({ route: "A", after: "2027-01-02T03:00:04.000Z" })
    expect(await restoreRoute(env.DB, new Date("2027-01-02T12:00:00.000Z"))).toMatchObject({ route: "A" })
    // Before the last run finished, the point still holds what that run deleted.
    expect(await restoreRoute(env.DB, new Date("2027-01-02T03:00:03.999Z"))).toEqual({ route: "B", after: "2027-01-02T03:00:04.000Z" })
    expect(await restoreRoute(env.DB, new Date("2027-01-01T12:00:00.000Z"))).toMatchObject({ route: "B" })
  })

  it("goes by the record, not the clock: a failed or unfinished run moves nothing", async () => {
    await run("rr_1", "2027-01-01T03:00:00.000Z", "2027-01-01T03:00:05.000Z", 1)
    await run("rr_2", "2027-01-02T03:00:00.000Z", "2027-01-02T03:00:04.000Z", 0)
    await run("rr_3", "2027-01-03T03:00:00.000Z", null, 0)
    expect(await restoreRoute(env.DB, new Date("2027-01-01T04:00:00.000Z"))).toEqual({ route: "A", after: "2027-01-01T03:00:05.000Z" })
  })

  it("allows any point while no deletion run has finished yet", async () => {
    expect(await restoreRoute(env.DB, new Date("2027-01-01T00:00:00.000Z"))).toEqual({ route: "A", after: null })
  })
})
