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
    expect(await restoreRoute(env.DB, new Date("2027-01-02T03:00:04.000Z"))).toEqual({
      route: "A",
      after: "2027-01-02T03:00:04.000Z",
      verified: true,
    })
    expect(await restoreRoute(env.DB, new Date("2027-01-02T12:00:00.000Z"))).toMatchObject({ route: "A" })
    // Before the last run finished, the point still holds what that run deleted.
    expect(await restoreRoute(env.DB, new Date("2027-01-02T03:00:03.999Z"))).toEqual({
      route: "B",
      after: "2027-01-02T03:00:04.000Z",
      verified: true,
    })
    expect(await restoreRoute(env.DB, new Date("2027-01-01T12:00:00.000Z"))).toMatchObject({ route: "B" })
  })

  it("counts a failed run's deletions too, and an unfinished one's until a cron run's longest life ran out (F5-R7)", async () => {
    await run("rr_1", "2027-01-01T03:00:00.000Z", "2027-01-01T03:00:05.000Z", 1)
    // Failed in one part after deleting in others: what it deleted is in every point before its end.
    await run("rr_2", "2027-01-02T03:00:00.000Z", "2027-01-02T03:00:04.000Z", 0)
    expect(await restoreRoute(env.DB, new Date("2027-01-01T04:00:00.000Z"))).toMatchObject({ route: "B" })
    expect(await restoreRoute(env.DB, new Date("2027-01-02T03:00:04.000Z"))).toEqual({
      route: "A",
      after: "2027-01-02T03:00:04.000Z",
      verified: true,
    })
    // Never recorded its end: it may have deleted until a scheduled run is stopped (15 minutes, and a minute's grace).
    await run("rr_3", "2027-01-03T03:00:00.000Z", null, 0)
    expect(await restoreRoute(env.DB, new Date("2027-01-03T03:15:59.999Z"))).toMatchObject({ route: "B" })
    expect(await restoreRoute(env.DB, new Date("2027-01-03T03:16:00.000Z"))).toEqual({
      route: "A",
      after: "2027-01-03T03:16:00.000Z",
      verified: true,
    })
  })

  it("with no successful run on record, no point is verified: the filtered import (F5-R7)", async () => {
    expect(await restoreRoute(env.DB, new Date("2027-01-01T00:00:00.000Z"))).toEqual({ route: "B", after: null, verified: false })
    // A first run that deleted contacts and then failed elsewhere leaves no successful record.
    await run("rr_1", "2027-01-01T03:00:00.000Z", "2027-01-01T03:00:05.000Z", 0)
    expect(await restoreRoute(env.DB, new Date("2027-01-01T02:00:00.000Z"))).toEqual({ route: "B", after: null, verified: false })
    expect(await restoreRoute(env.DB, new Date("2027-01-02T00:00:00.000Z"))).toEqual({ route: "B", after: null, verified: false })
  })
})
