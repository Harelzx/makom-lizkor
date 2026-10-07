import { env } from "cloudflare:workers"
import { describe, expect, it } from "vitest"
import { edgePurge } from "../lib/purge"

const tags = ["feed", "place:p_x"]
// The Worker's cache on (EDGE_CACHE=on), unless a test says otherwise: the purge then has an edge to clear.
const as = (ENVIRONMENT: string, EDGE_CACHE = "on") => ({ ...env, ENVIRONMENT, EDGE_CACHE }) as Env
const withCache = (purge: () => Promise<{ success: boolean }>) => ({ cache: { purge } })

describe("the edge purge (L1)", () => {
  it("with the Worker's cache off (EDGE_CACHE=off, production's launch mode) the edge holds no copy: done, and no cache is asked", async () => {
    let asked = 0
    const cache = withCache(async () => (asked++, { success: false }))
    for (const where of ["production", "staging", "development"]) {
      expect(await edgePurge(as(where, "off"), undefined, tags)).toBe(true)
      expect(await edgePurge(as(where, "off"), cache, tags)).toBe(true)
    }
    expect(asked).toBe(0)
  })

  it("anything but off is taken as a cache to clear, so a missing or mistyped mode fails loudly rather than skipping purges", async () => {
    for (const mode of ["", "Off", "false"]) expect(await edgePurge(as("production", mode), undefined, tags)).toBe(false)
  })

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
