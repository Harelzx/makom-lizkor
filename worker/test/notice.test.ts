import { call } from "./app"
import { expect, it } from "vitest"
import { CURRENT_REPORT_NOTICE, CURRENT_SUBMISSION_NOTICE, REPORT_NOTICES, SUBMISSION_NOTICES } from "@/shared/contract"
import { NOTICES } from "@/data/legal"

const submit = (consent_version: string) =>
  call("http://local/api/v1/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""), "Turnstile-Token": "pass" },
    body: JSON.stringify({ kind: "bench", name_he: "ספסל דמו", lat: 31.42, lng: 34.49, consent_version }),
  })

it("records only a notice version whose text exists, and the form shows the newest", () => {
  for (const v of SUBMISSION_NOTICES) expect(Object.keys(NOTICES)).toContain(v)
  expect(SUBMISSION_NOTICES.at(-1)).toBe(CURRENT_SUBMISSION_NOTICE)
})

it("refuses a submission that names a notice the site never showed", async () => {
  expect((await submit("notice.submission@1999-1-1")).status).toBe(400)
  expect((await submit(CURRENT_SUBMISSION_NOTICE)).status).toBe(201)
})

it("describes the flow that exists: a tracking link to follow and withdraw, and a photo sent for review", () => {
  const text = NOTICES[CURRENT_SUBMISSION_NOTICE]
  expect(text).toContain("קישור המעקב")
  expect(text).toContain("למשוך אותה")
  expect(text).not.toContain("אין עדיין דף")
  expect(text).toContain("לתקן אותה")
  expect(text).not.toContain("כדי לתקן אותה, כתבו לנו")
  expect(text).toContain("לחזור אליי לתיקון")
  expect(text).toContain("תנאי השליחה")
  expect(text).toContain("התמונה")
  expect(text).not.toContain("התמונה לא נשלחת")
  expect(text).toContain("מתפרסמת רק אם המקום אושר")
  expect(text).toContain("את התמונה צילמתי בעצמי")
  expect(text).toContain("סימנתם שהמקום בשטח פרטי")
  // The browser check runs now, so Cloudflare is named for it among the processors.
  expect(text).toContain("Turnstile")
  expect(text).toContain("מייל אימות")
  expect(text).not.toContain("אין שדה למייל")
})

// Every version a form has ever shown. A device may still retry a queued submission under one of them, and its consent
// record points to that text: removing a version would refuse the retry and orphan the record. Only append here.
const SHOWN = [
  "notice.submission@2026-10-2",
  "notice.submission@2026-10-3",
  "notice.submission@2026-10-4",
  "notice.submission@2026-10-5",
  "notice.submission@2026-10-6",
  "notice.submission@2026-10-7",
  "notice.submission@2026-10-8",
  "notice.submission@2026-10-9",
  "notice.submission@2026-10-10",
  "notice.submission@2026-10-11",
]

it("never drops a version a form has shown, and keeps each one's text", () => {
  for (const v of SHOWN) {
    expect(SUBMISSION_NOTICES).toContain(v)
    expect(Object.keys(NOTICES)).toContain(v)
  }
  // New versions go at the end: the order is the order they were shown.
  expect(SUBMISSION_NOTICES.slice(0, SHOWN.length)).toEqual(SHOWN)
})

// The report notices a request may have recorded. As for submissions, never removed and new ones at the end.
const REPORTS_SHOWN = ["notice.report@2026-10-1", "notice.report@2026-10-2", "notice.report@2026-10-3"]

it("keeps every report notice a request may have recorded, in the order they were shown, and the form shows the newest", () => {
  for (const v of REPORTS_SHOWN) {
    expect(REPORT_NOTICES).toContain(v)
    expect(Object.keys(NOTICES)).toContain(v)
  }
  expect(REPORT_NOTICES.slice(0, REPORTS_SHOWN.length)).toEqual(REPORTS_SHOWN)
  expect(REPORT_NOTICES.at(-1)).toBe(CURRENT_REPORT_NOTICE)
  expect(CURRENT_REPORT_NOTICE).toBe("notice.report@2026-10-3")
})

it("the report notice says the browser keeps a request until its arrival is known, for at most a day, and what a browser that keeps nothing means", () => {
  const text = NOTICES[CURRENT_REPORT_NOTICE]
  expect(text).toContain("בדפדפן שלכם")
  expect(text).toContain("24 שעות")
  expect(text).toContain("ולא נשלחת שוב מעצמה")
  expect(text).toContain("נשמרת רק עד שתסגרו או תרעננו את הדף")
})
