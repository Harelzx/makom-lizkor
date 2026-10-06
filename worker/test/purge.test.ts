import { env } from "cloudflare:workers"
import { describe, expect, it } from "vitest"
import { edgePurge } from "../lib/purge"

const tags = ["feed", "place:p_x"]
const as = (ENVIRONMENT: string) => ({ ...env, ENVIRONMENT }) as Env
const withCache = (purge: () => Promise<{ success: boolean }>) => ({ cache: { purge } })

describe("the edge purge (L1)", () => {
  it("with no edge cache, counts as done only in development; anywhere else it is a failure to retry", async () => {
    expect(await edgePurge(as("development"), undefined, tags)).toBe(true)
    expect(await edgePurge(as("production"), undefined, tags)).toBe(false)
    expect(await edgePurge(as("staging"), undefined, tags)).toBe(false)
    expect(await edgePurge(as(""), {}, tags)).toBe(false)
  })

  it("reports what the cache answered: success, a refusal, or a throw", async () => {
    let asked: unknown
    const ok = { cache: { purge: async (options: unknown) => ((asked = options), { success: true }) } }
    expect(await edgePurge(as("production"), ok, tags)).toBe(true)
    expect(asked).toEqual({ tags })
    expect(
      await edgePurge(
        as("production"),
        withCache(async () => ({ success: false })),
        tags,
      ),
    ).toBe(false)
    expect(
      await edgePurge(
        as("production"),
        withCache(() => Promise.reject(new Error("rate limited"))),
        tags,
      ),
    ).toBe(false)
  })
})
