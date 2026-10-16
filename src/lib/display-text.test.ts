import { expect, it } from "vitest"
import { displayTextFields, nameParts } from "./display-text"
it("normalizes database prose for display without changing the stored record or its links", () => {
  const p = {
    id: "id–unchanged",
    name_he: "ספסל — פינה",
    summary_he: "2023–2026",
    links: [{ label_he: "משפחה – אתר", url: "https://example.test/name–path" }],
    revival: { story_he: ["סיפור — הקהילה"] },
  }
  const view = displayTextFields(p)
  expect(view.name_he).toBe("ספסל - פינה")
  expect(view.revival.story_he[0]).toBe("סיפור - הקהילה")
  expect(view.links[0].url).toBe(p.links[0].url)
  expect(view.id).toBe(p.id)
  expect(p.name_he).toBe("ספסל — פינה")
})

it("splits a credit that names the author in two scripts, so each part keeps its own direction", () => {
  expect(nameParts("Israel Parker (ישראל פרקר)")).toEqual(["Israel Parker", "ישראל פרקר"])
  expect(nameParts("ארתור שמונק (Arthur Schmunk)")).toEqual(["ארתור שמונק", "Arthur Schmunk"])
  expect(nameParts("Oren Rozen")).toEqual(["Oren Rozen"])
  expect(nameParts("מקף־עברי")).toEqual(["מקף־עברי"])
  // a parenthesis in the same script is part of the name, not a second spelling of it
  expect(nameParts("Studio (Tel Aviv)")).toEqual(["Studio (Tel Aviv)"])
})
