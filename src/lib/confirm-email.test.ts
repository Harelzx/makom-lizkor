import { afterEach, expect, it, vi } from "vitest"
import { confirmEmail } from "@/lib/api"

const answer = (body: unknown, status = 200) => vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status }))
afterEach(() => vi.unstubAllGlobals())

it("says what happened to the tracking mail, not only that the address was verified", async () => {
  const cases: [unknown, string][] = [
    [{ ok: true, first: true, mail: "sent" }, "ok"],
    [{ ok: true, first: false, mail: "sent" }, "resent"],
    [{ ok: true, first: false, mail: "earlier" }, "again"],
    [{ ok: true, first: true, mail: "failed" }, "unsent"],
    [{ ok: true, first: false, mail: "stopped" }, "stopped"],
  ]
  for (const [body, expected] of cases) {
    answer(body)
    expect(await confirmEmail("t")).toBe(expected)
  }
  answer({ type: "not_found" }, 404)
  expect(await confirmEmail("t")).toBe("expired")
})
