import { describe, expect, it } from "vitest"
import { createPager, type Page, type PagerState } from "./pager"

/** A list endpoint whose answers the test hands out, one call at a time and in any order. */
function endpoint() {
  const calls: { cursor: string | null; answer: (page: Page<string> | string) => void }[] = []
  const fetch = (cursor: string | null) => new Promise<Page<string> | string>((answer) => calls.push({ cursor, answer }))
  return { calls, fetch }
}
function pager() {
  const api = endpoint()
  let shown: PagerState<string> | null = null
  const p = createPager<string>(api.fetch, (s) => (shown = s))
  return { ...api, p, shown: () => shown! }
}
const settle = () => new Promise((r) => setTimeout(r, 0))

describe("the moderators' paged lists", () => {
  it("follows the cursor page by page and stops at the end", async () => {
    const { calls, p, shown } = pager()
    const first = p.refresh()
    calls[0].answer({ items: ["a", "b"], next: "c1" })
    await first
    const second = p.more()
    expect(calls[1].cursor).toBe("c1")
    calls[1].answer({ items: ["c"], next: null })
    await second
    expect(shown()).toMatchObject({ items: ["a", "b", "c"], next: null, error: "" })
    await p.more()
    expect(calls).toHaveLength(2)
  })

  it("asks for one older page at a time", async () => {
    const { calls, p } = pager()
    const first = p.refresh()
    calls[0].answer({ items: ["a"], next: "c1" })
    await first
    void p.more()
    void p.more()
    expect(calls).toHaveLength(2)
  })

  it("a failed load keeps the rows already shown and says so; a successful one clears the failure", async () => {
    const { calls, p, shown } = pager()
    const first = p.refresh()
    calls[0].answer({ items: ["a"], next: null })
    await first
    const failed = p.refresh()
    calls[1].answer("אין חיבור לשרת.")
    await failed
    expect(shown()).toMatchObject({ items: ["a"], error: "אין חיבור לשרת.", failed: "refresh", busy: false })
    const retry = p.refresh()
    calls[2].answer({ items: ["a", "b"], next: null })
    await retry
    expect(shown()).toMatchObject({ items: ["a", "b"], error: "", failed: null })
  })

  it("a failed older page keeps what is shown and its cursor, so asking again continues from the same place", async () => {
    const { calls, p, shown } = pager()
    const first = p.refresh()
    calls[0].answer({ items: ["a"], next: "c1" })
    await first
    const failed = p.more()
    calls[1].answer("אין חיבור לשרת.")
    await failed
    expect(shown()).toMatchObject({ items: ["a"], next: "c1", failed: "more", busy: false })
    const again = p.more()
    expect(calls[2].cursor).toBe("c1")
    calls[2].answer({ items: ["b"], next: null })
    await again
    expect(shown()).toMatchObject({ items: ["a", "b"], next: null, error: "", failed: null })
  })

  it("an older page that arrives after a refresh has finished is dropped, never added to the new rows", async () => {
    const { calls, p, shown } = pager()
    const first = p.refresh()
    calls[0].answer({ items: ["a", "b"], next: "c1" })
    await first
    const late = p.more()
    const refresh = p.refresh()
    calls[2].answer({ items: ["new", "a"], next: "c2" })
    await refresh
    calls[1].answer({ items: ["old"], next: null })
    await late
    await settle()
    expect(shown()).toMatchObject({ items: ["new", "a"], next: "c2", busy: false })
    // And the list carries on from the refresh's own cursor.
    void p.more()
    expect(calls.at(-1)!.cursor).toBe("c2")
  })

  it("of two refreshes, the later one's answer stands even when the earlier one arrives last", async () => {
    const { calls, p, shown } = pager()
    const earlier = p.refresh()
    const later = p.refresh()
    calls[1].answer({ items: ["later"], next: null })
    await later
    calls[0].answer({ items: ["earlier"], next: "c0" })
    await earlier
    expect(shown()).toMatchObject({ items: ["later"], next: null })
  })

  it("an older page isn't asked for while a refresh is on its way, so it can't use a cursor the refresh replaces", async () => {
    const { calls, p } = pager()
    const first = p.refresh()
    calls[0].answer({ items: ["a"], next: "c1" })
    await first
    void p.refresh()
    void p.more()
    expect(calls).toHaveLength(2)
  })
})
