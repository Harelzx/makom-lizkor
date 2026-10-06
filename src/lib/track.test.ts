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
