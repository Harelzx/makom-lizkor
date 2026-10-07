import { describe, expect, it } from "vitest"

// zod decides whether to generate code when a schema is built, and the first such schema probes for it with
// new Function: an eval the site's policy reports (spec 11). The setting that stops it has to run before any shared
// schema is built, whichever shared module a page happens to load first.
describe("the shared schemas", () => {
  it("never probe for eval, even when curated.ts loads before contract.ts", async () => {
    const probes: unknown[][] = []
    const Real = globalThis.Function
    globalThis.Function = new Proxy(Real, {
      construct(target, args) {
        probes.push(args)
        return Reflect.construct(target, args)
      },
    })
    try {
      const { CuratedFields } = await import("./curated")
      const { Feed } = await import("./contract")
      CuratedFields.safeParse({})
      Feed.safeParse({ version: 1, places: [] })
    } finally {
      globalThis.Function = Real
    }
    expect(probes).toEqual([])
  })
})
