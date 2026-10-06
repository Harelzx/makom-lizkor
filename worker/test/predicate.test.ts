import { describe, expect, it } from "vitest"
import { complete, isSpam, linkCount, normalizeExplanation, REPORT_GUARDS } from "../lib/guards"

const long = "המקום מציג את שם אחי בלי רשותנו, ואנחנו מבקשים להסיר אותו."
const base = { elements: ["name_he"] as const, requesterType: "family" as const, relationship: "אחות", explanation: long }
const live = { origin: "contribution" as const, published: true }

describe("complete(r): eligible for the automatic path (spec 6), never a finding that the request is credible", () => {
  // Each row changes one thing from a complete request.
  const rows: [string, Parameters<typeof complete>[0], Parameters<typeof complete>[1], boolean][] = [
    ["a family request, with a relationship and a full explanation", base, live, true],
    ["the whole place", { ...base, elements: ["whole"] }, live, true],
    ["a rights holder asking about the photo", { ...base, requesterType: "rights_holder", elements: ["photo"] }, live, true],
    ["a rights holder asking about the name", { ...base, requesterType: "rights_holder", elements: ["name_he"] }, live, false],
    [
      "a rights holder asking about the photo and the story",
      { ...base, requesterType: "rights_holder", elements: ["photo", "story_he"] },
      live,
      false,
    ],
    ["someone else (an error, offensive content)", { ...base, requesterType: "other" }, live, false],
    ["no relationship", { ...base, relationship: undefined }, live, false],
    ["a blank relationship", { ...base, relationship: "   " }, live, false],
    ["an explanation of 19 characters", { ...base, explanation: "א".repeat(19) }, live, false],
    ["an explanation of exactly 20 characters", { ...base, explanation: "א".repeat(20) }, live, true],
    // Twenty characters as a person counts them: combining marks don't pad a short explanation.
    ["19 letters padded with combining marks", { ...base, explanation: "בּ".repeat(10) + "א".repeat(9) }, live, false],
    ["a place not published", base, { origin: "contribution", published: false }, false],
    ["a curated place (no rows to hide until phase 7)", base, { origin: "curated", published: true }, false],
  ]
  it.each(rows)("%s", (_name, r, target, expected) => expect(complete(r, target)).toBe(expected))
})

describe("spam signals", () => {
  it("counts links in their usual written forms", () => {
    expect(linkCount("ראו https://a.example ו־http://b.example וגם www.c.example")).toBe(3)
    expect(linkCount("בלי קישורים")).toBe(0)
  })

  it("an explanation copied with different spacing, case or punctuation is the same explanation", () => {
    expect(normalizeExplanation("Please   REMOVE this!!")).toBe(normalizeExplanation("please remove, this"))
    expect(normalizeExplanation("הסירו את השם.")).toBe(normalizeExplanation("הסירו  את השם"))
  })

  const quiet = { duplicate: false, links: 0, reporterCount: 1 }
  it.each([
    ["nothing unusual", quiet, false],
    ["the same explanation in another request today", { ...quiet, duplicate: true }, true],
    [`${REPORT_GUARDS.maxLinks} links`, { ...quiet, links: REPORT_GUARDS.maxLinks }, false],
    [`${REPORT_GUARDS.maxLinks + 1} links`, { ...quiet, links: REPORT_GUARDS.maxLinks + 1 }, true],
    [`the reporter's ${REPORT_GUARDS.reporterPerDay}th request today`, { ...quiet, reporterCount: REPORT_GUARDS.reporterPerDay }, false],
    [
      `the reporter's ${REPORT_GUARDS.reporterPerDay + 1}th request today`,
      { ...quiet, reporterCount: REPORT_GUARDS.reporterPerDay + 1 },
      true,
    ],
  ])("%s", (_name, signals, expected) => expect(isSpam(signals)).toBe(expected))
})
