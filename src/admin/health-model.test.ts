import { expect, it } from "vitest"
import { failureLabel, healthReport, readHealth } from "./health-model"
import type { SiteHealth } from "../../worker/lib/health-schema"

const now = "2026-10-21T12:30:00.000Z"
const hour = (h: number) => new Date(Date.UTC(2026, 9, 21, 12 - h)).toISOString()
const health = (rows: SiteHealth["hours"]): SiteHealth => ({
  generated_at: now,
  version: "release-60a872939f5f",
  sample_every: 32,
  window_hours: 48,
  seen_at: null,
  hours: rows,
})
const row = (h: number, code: string, samples: number, total_ms = 0, slow = 0) => ({ hour: hour(h), code, samples, total_ms, slow })

it("all well when nothing failed, and says so for the window", () => {
  const r = readHealth(health([row(0, "http_200", 40, 4000)]), null, 24)
  expect(r.level).toBe("good")
  expect(r.reasons).toEqual([])
  expect(r.meanMs).toBe(100)
  expect(r.estimated).toBe(1280)
  expect(r.timeline).toHaveLength(24)
})

it("a failed job or five server errors is a problem; one server error or three browser reports is worth a look", () => {
  expect(readHealth(health([row(1, "err_job_export", 1)]), null, 24).level).toBe("bad")
  expect(readHealth(health([row(1, "err_http_500", 5)]), null, 24).level).toBe("bad")
  expect(readHealth(health([row(1, "err_http_500", 1)]), null, 24).level).toBe("watch")
  expect(readHealth(health([row(1, "err_client_error", 3)]), null, 24).level).toBe("watch")
  expect(readHealth(health([row(1, "err_client_error", 2)]), null, 24).level).toBe("good")
})

it("counts only what falls in the chosen window", () => {
  const h = health([row(2, "err_http_500", 1), row(30, "err_http_500", 4)])
  expect(readHealth(h, null, 6).serverErrors).toBe(1)
  expect(readHealth(h, null, 48).serverErrors).toBe(5)
})

it("names each code in plain words, and a code it doesn't know as itself", () => {
  expect(failureLabel("err_job_export")).toBe("עבודה ברקע נכשלה: גיבוי לילי")
  expect(failureLabel("err_http_503")).toBe("שגיאה בשרת (503)")
  expect(failureLabel("err_client_something_new")).toBe("client_something_new")
})

it("the copied report carries the version, every failure with its hours, the traffic and the raw counters", () => {
  const h = health([row(0, "http_200", 10, 900), row(1, "err_http_500", 2)])
  const text = healthReport(h, null, readHealth(h, null, 24))
  expect(text).toContain("release-60a872939f5f")
  expect(text).toContain("err_http_500")
  expect(text).toContain("תשובות שנדגמו: 10")
  expect(text).toContain('"code":"err_http_500"')
})

it("reads browser errors by kind: a dropped connection alone is not our code, until there are many", () => {
  const h = health([row(1, "err_client_error_network", 4), row(1, "err_client_error_json", 1), row(2, "err_client_error", 1)])
  const r = readHealth(h, null, 24)
  expect(r.browserErrors).toBe(6)
  expect(r.errorKinds).toEqual({ network: 4, json: 1, other: 1 })
  expect(r.level).toBe("good")
  expect(failureLabel("err_client_error_json")).toBe("שגיאה בדפדפן של מבקר: תשובה לא צפויה מהשרת")
  expect(readHealth(health([row(1, "err_client_error_json", 3)]), null, 24).level).toBe("watch")
  expect(readHealth(health([row(1, "err_client_error_network", 10)]), null, 24).level).toBe("watch")
})

it("puts aside what came before a moderator marked it looked at, and reads what came after", () => {
  const rows = [row(5, "err_http_500", 6), row(5, "err_client_crash", 1), row(1, "err_client_crash", 1)]
  const before = readHealth(health(rows), null, 24)
  expect(before.level).toBe("bad")
  const after = readHealth({ ...health(rows), seen_at: new Date(Date.UTC(2026, 9, 21, 9)).toISOString() }, null, 24)
  expect(after.seenFailures).toBe(7)
  expect(after.serverErrors).toBe(0)
  expect(after.failures).toEqual([
    { code: "err_client_crash", label: "האתר קרס אצל מבקר (מסך לבן)", n: 1, when: [{ hour: hour(1), n: 1 }] },
  ])
  expect(after.level).toBe("watch")
  expect(after.timeline.find((t) => t.hour === hour(5))).toMatchObject({ failures: 0, seen: 7 })
  expect(healthReport(health(rows), null, after)).toContain("7 תקלות מלפני כן")
})
