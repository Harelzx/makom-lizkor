import { afterEach, expect, it, vi } from "vitest"
import { trackSubmission } from "@/lib/api"

const answer = (status: number, body: string, type = "application/problem+json") =>
  vi.stubGlobal("fetch", async () => new Response(body, { status, headers: { "Content-Type": type } }))
afterEach(() => vi.unstubAllGlobals())

it("only the API's own 'not found' means the link opens nothing; any other 404 is a failure to read", async () => {
  answer(404, JSON.stringify({ code: "not_found" }))
  expect(await trackSubmission("p_1", "t")).toBeNull()
  answer(404, "<!doctype html><title>404</title>", "text/html")
  expect(await trackSubmission("p_1", "t")).toBeUndefined()
  answer(404, "")
  expect(await trackSubmission("p_1", "t")).toBeUndefined()
})

it("a withdrawal the server couldn't make for contention is a failure to retry, never a done withdrawal", async () => {
  const { withdrawSubmission } = await import("@/lib/api")
  answer(503, JSON.stringify({ code: "withdrawal_busy" }))
  expect(await withdrawSubmission("p_1", "t")).toBe("failed")
  answer(404, JSON.stringify({ code: "not_found" }))
  expect(await withdrawSubmission("p_1", "t")).toBe("failed")
  answer(200, JSON.stringify({ status: "withdrawn" }), "application/json")
  expect(await withdrawSubmission("p_1", "t")).toBe("withdrawn")
  answer(200, JSON.stringify({ status: "withdrawn", files: "pending" }), "application/json")
  expect(await withdrawSubmission("p_1", "t")).toBe("files_pending")
})

it("a successful answer that isn't a status is a failure to read, never 'opens nothing'", async () => {
  for (const body of ["null", "{}", '"withdrawn"', "<!doctype html>", '{"status": 3}']) {
    answer(200, body, "application/json")
    expect(await trackSubmission("p_1", "t"), body).toBeUndefined()
  }
  answer(200, JSON.stringify({ status: "pending", name_he: "x", rev: 1 }), "application/json")
  expect(await trackSubmission("p_1", "t")).toMatchObject({ status: "pending" })
})

it("a successful withdrawal answer that doesn't say withdrawn establishes nothing", async () => {
  const { withdrawSubmission } = await import("@/lib/api")
  for (const body of ["null", "{}", "<!doctype html>", '{"status": "pending"}', '{"status": "withdrawn", "files": "maybe"}']) {
    answer(200, body, "application/json")
    expect(await withdrawSubmission("p_1", "t"), body).toBe("failed")
  }
})

it("a status outside the contract, or a malformed field that decides completion, is a failure to read", async () => {
  const bad = [
    { status: "archived", name_he: null },
    { status: "withdrawn", name_he: null, files: "maybe" },
    { status: "withdrawn", name_he: 3 },
    { status: "pending", name_he: "x", rev: "2" },
    { status: "published", name_he: "x", draft: "text" },
    { status: "returned", name_he: "x", note: 5 },
  ]
  for (const body of bad) {
    answer(200, JSON.stringify(body), "application/json")
    expect(await trackSubmission("p_1", "t"), JSON.stringify(body)).toBeUndefined()
  }
  answer(200, JSON.stringify({ status: "withdrawn", rev: 2, name_he: null, files: "pending" }), "application/json")
  expect(await trackSubmission("p_1", "t")).toMatchObject({ files: "pending" })
})

it("a correction's metadata outside the contract is a failure to read: unknown revision state, missing or odd rev", async () => {
  for (const body of [
    { status: "published", name_he: "x", rev: 3, revision_state: "bogus" },
    { status: "published", name_he: "x", revision_state: "pending" },
    { status: "published", name_he: "x", rev: 0, revision_state: "pending" },
    { status: "published", name_he: "x", rev: 2.5, revision_state: "pending" },
  ]) {
    answer(200, JSON.stringify(body), "application/json")
    expect(await trackSubmission("p_1", "t"), JSON.stringify(body)).toBeUndefined()
  }
  answer(200, JSON.stringify({ status: "published", name_he: "x", rev: 3, revision_state: "approved" }), "application/json")
  expect(await trackSubmission("p_1", "t")).toMatchObject({ rev: 3 })
})
