import { expect, it } from "vitest"
import { refusedHere, savedHere } from "@/lib/correction"

const sent = { name_he: "ספסל  דמו", story_he: "שורה\nשנייה" }
const draft = (name_he: string, story_he: string) => ({ name_he, story_he, place_he: null, in_memory_of: null, link_url: null })
const now = (revision_state: string, d = draft("ספסל דמו", "שורה\nשנייה")) => ({
  status: "published",
  name_he: "ספסל דמו",
  rev: 3,
  revision_state,
  draft: d,
})

it("the newest text on the server, as it stores it, is this correction: saved", () => {
  expect(savedHere(now("pending"), sent, 2)).toBe(true)
  // approved before the lost answer was checked
  expect(savedHere(now("approved"), sent, 2)).toBe(true)
})

it("the same text, but refused, returned or replaced since, isn't reported as saved", () => {
  for (const state of ["rejected", "returned", "superseded"]) {
    expect(savedHere(now(state), sent, 2)).toBe(false)
    // …and it is told as arrived but not accepted, not as missing.
    expect(refusedHere(now(state), sent, 2)).toBe(true)
  }
  expect(refusedHere(now("pending"), sent, 2)).toBe(false)
})

it("other text, an unchanged revision, or no status at all, isn't saved", () => {
  expect(savedHere(now("pending", draft("אחר", "")), sent, 2)).toBe(false)
  expect(savedHere(now("pending"), sent, 3)).toBe(false)
  expect(savedHere(null, sent, 2)).toBe(false)
  expect(savedHere(undefined, sent, 2)).toBe(false)
})

it("only a strictly newer revision in a recognised saved state confirms; anything else confirms nothing", async () => {
  const d = draft("ספסל דמו", "שורה\nשנייה")
  const at = (rev: unknown, revision_state: unknown) => ({ status: "published", name_he: "x", rev, revision_state, draft: d }) as never
  expect(savedHere(at(3, "pending"), sent, 2)).toBe(true)
  for (const [rev, state] of [
    [3, "bogus"],
    [3, undefined],
    [undefined, "pending"],
    [2, "pending"],
    [1, "approved"],
  ] as const) {
    expect(savedHere(at(rev, state), sent, 2), `${rev} ${state}`).toBe(false)
    expect(refusedHere(at(rev, state), sent, 2), `${rev} ${state}`).toBe(false)
  }
})
