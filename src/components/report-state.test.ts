import { expect, it } from "vitest"
import { messageOf } from "@/components/report-state"
import type { Entry } from "@/lib/report-holder"

const base: Entry = { key: "k", placeId: "p_1", at: 0, r: null, expiresAt: 0, uncertain: true, stored: true, busy: false, shown: null }

it("a request found again that this browser wouldn't keep says a reload loses it", () => {
  expect(messageOf({ ...base, stored: false, shown: { view: "restored" } }, false).alert).toMatch(/נשמרת רק בדף הפתוח/)
  expect(messageOf({ ...base, shown: { view: "restored" } }, false).alert).not.toMatch(/נשמרת רק בדף הפתוח/)
})

it("an expiry says the request won't go again and whether its copy went, never that it went when it didn't", () => {
  const gone = messageOf({ ...base, shown: { view: "expired", cleared: true } }, false).alert!
  const stuck = messageOf({ ...base, shown: { view: "expired", cleared: false } }, false).alert!
  expect(gone).toMatch(/לא תישלח שוב/)
  expect(gone).toMatch(/נמחקה מהדפדפן הזה/)
  expect(stuck).toMatch(/לא תישלח שוב/)
  expect(stuck).not.toMatch(/נמחקה/)
  expect(stuck).toMatch(/עוד לא נמחק/)
  expect(stuck).toMatch(/נתוני האתר/)
})

it("an answer whose copy couldn't be removed says so, without promising when it goes", () => {
  const status = messageOf({ ...base, shown: { view: "result", outcome: "received", cleared: false } }, false).status!
  expect(status).toMatch(/עוד לא נמחק/)
  expect(status).not.toMatch(/לכל המאוחר/)
})

it("a first refusal held because its removal failed, in a browser that never kept it, says only the page holds it and a reload loses it", () => {
  const held = { view: "editable" as const, code: "turnstile_failed", cleared: false }
  const page = messageOf({ ...base, stored: false, shown: held }, false).alert!
  const kept = messageOf({ ...base, stored: true, shown: held }, false).alert!
  expect(page).toMatch(/לא שמר את הבקשה/)
  expect(page).toMatch(/נשמרת רק בדף הפתוח/)
  expect(page).not.toMatch(/עדיין שמורה בדפדפן הזה/)
  expect(kept).toMatch(/עדיין שמורה בדפדפן הזה/)
  expect(messageOf({ ...base, stored: false, shown: { view: "discarded", cleared: false } }, false).alert).toMatch(/נשמרת רק בדף הפתוח/)
})

it("a day's limit reached says it wasn't sent, when to try again, and where else to write", () => {
  const alert = messageOf({ ...base, shown: { view: "editable", code: "daily_limit", cleared: true } }, false).alert!
  expect(alert).toMatch(/מחר/)
  expect(alert).toMatch(/«כתבו לנו»/)
})
