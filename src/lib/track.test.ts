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
