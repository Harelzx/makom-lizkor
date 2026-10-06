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
