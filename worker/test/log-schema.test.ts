import { describe, expect, it } from "vitest"
import { log, logLineProblems } from "../lib/log"

// Spec 11: the Worker writes only its own structured lines, from a list of allowed fields, and never a request body,
// an address, a token, an email or a User-Agent. Every line the whole Worker suite writes is checked against this
// (worker/test/log-guard.ts); these are the rule's own cases.

const line = (o: unknown) => JSON.stringify(o)

describe("a log line", () => {
  it("passes when it holds only allowed fields with codes, ids and counts", () => {
    for (const ok of [
      { level: "error", event: "job_failed", job: "retention", error: "TypeError" },
      { level: "error", event: "unhandled", method: "POST", path: "/api/v1/submissions/:id/revisions", error: "Error" },
      { level: "error", event: "op_finish_failed", op: "t_01J9Z7Q5W8K3M2N4P6R8T0V2X4" },
      { level: "error", event: "photo_unsettled", place: "p_01J9Z7Q5W8K3M2N4P6R8T0V2X4", error: "photo_unavailable" },
      { level: "error", event: "export_audit", found: { contacts: 1, unreadable: 2 } },
      { level: "info", event: "csp_report", directive: "img-src", source: "map_tiles" },
      { level: "error", event: "job_failed", job: "drill", dropped: ["error"] },
    ])
      expect(logLineProblems(line(ok)), JSON.stringify(ok)).toEqual([])
  })
  it("fails when it isn't one JSON object with a level and an event", () => {
    expect(logLineProblems("withdrawal failed for p_123")).not.toEqual([])
    expect(logLineProblems(line({ event: "x" }))).not.toEqual([])
    expect(logLineProblems(line({ level: "error" }))).not.toEqual([])
    expect(logLineProblems(line([1, 2]))).not.toEqual([])
  })
  it("fails on a field outside the list, whatever it holds", () => {
    expect(logLineProblems(line({ level: "error", event: "x", body: "{}" }))).not.toEqual([])
    expect(logLineProblems(line({ level: "error", event: "x", ip: "203.0.113.7" }))).not.toEqual([])
    expect(logLineProblems(line({ level: "error", event: "x", userAgent: "Mozilla/5.0" }))).not.toEqual([])
  })
  it("fails on free text, an address, an email or a real path in an allowed field", () => {
    for (const bad of [
      { level: "error", event: "x", error: "could not reach 203.0.113.7" },
      { level: "error", event: "x", error: "visitor@example.test" },
      { level: "error", event: "x", error: "2001:db8::1" },
      { level: "error", event: "x", path: "/api/v1/submissions/p_01J9Z7Q5W8K3M2N4P6R8T0V2X4" },
      { level: "error", event: "Withdraw Failed" },
      { level: "error", event: "x", place: "../etc" },
      { level: "error", event: "x", host: "tiles.openfreemap.org" },
      { level: "error", event: "x", source: "secret-label.tiles.example.test" },
      { level: "error", event: "x", directive: "made-up-directive" },
      { level: "error", event: "x", dropped: ["email"] },
      { level: "error", event: "x", found: { contacts: "one" } },
    ])
      expect(logLineProblems(line(bad)), JSON.stringify(bad)).not.toEqual([])
  })
  it("is what log() writes", () => {
    const written: string[] = []
    const original = console.error
    console.error = (s: string) => void written.push(s)
    try {
      log("error", "job_failed", { job: "drill", error: "TypeError" })
    } finally {
      console.error = original
    }
    expect(written).toHaveLength(1)
    expect(JSON.parse(written[0])).toEqual({ level: "error", event: "job_failed", job: "drill", error: "TypeError" })
    expect(logLineProblems(written[0])).toEqual([])
  })

  it("log() drops a value outside its field's rule and says which field, never echoing what it dropped (a49 P6-LOG-1)", async () => {
    const written: string[] = []
    const original = console.error
    console.error = (s: string) => void written.push(s)
    const secrets = [
      "visitor@example.test",
      "203.0.113.7",
      "Bearer AAAAAAAAAAAAAAAAAAAAAA",
      "/api/v1/submissions/p_01J9Z7Q5W8K3M2N4P6R8T0V2X4",
    ]
    try {
      log("error", "photo_unsettled", { place: secrets[0], error: secrets[1], op: secrets[2], path: secrets[3], found: { contacts: NaN } })
      log("error", "Not A Code" as string, { job: "drill" })
    } finally {
      console.error = original
    }
    expect(written).toHaveLength(2)
    for (const w of written) {
      expect(logLineProblems(w)).toEqual([])
      for (const secret of [...secrets, "Not A Code"]) expect(w).not.toContain(secret)
    }
    expect(JSON.parse(written[0])).toEqual({
      level: "error",
      event: "photo_unsettled",
      dropped: ["place", "error", "op", "path", "found"],
    })
    expect(JSON.parse(written[1])).toEqual({ level: "error", event: "invalid_event", job: "drill" })
  })
})
