import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { cleanText } from "@/shared/text"

describe("cleanText", () => {
  it("removes bidi overrides but keeps the marks Hebrew needs", () => {
    expect(cleanText("ספסל\u202Eשל\u202C נועה")).toBe("ספסלשל נועה")
    expect(cleanText("קיבוץ 3\u200F")).toBe("קיבוץ 3\u200F")
  })
  it("rejects control characters and folds whitespace on one line", () => {
    expect(cleanText("a\u0007b")).toBeNull()
    expect(cleanText("  שורה\nשנייה ")).toBe("שורה שנייה")
    expect(cleanText("שורה\r\nשנייה", { multiline: true })).toBe("שורה\nשנייה")
  })
  it("never lets a bidi control through, and is idempotent", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (s) => {
        const once = cleanText(s)
        if (once === null) return true
        return !/[\u202A-\u202E\u2066-\u2069]/.test(once) && cleanText(once) === once
      }),
    )
  })
})
