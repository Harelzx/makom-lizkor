import { exports } from "cloudflare:workers"
import { expect, it } from "vitest"
import { CURRENT_SUBMISSION_NOTICE, SUBMISSION_NOTICES } from "@/shared/contract"
import { NOTICES } from "@/data/legal"

const submit = (consent_version: string) =>
  exports.default.fetch("http://local/api/v1/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID().replaceAll("-", "") },
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

it("describes the flow that exists: a tracking link to follow and withdraw, and the photo stays on the device", () => {
  const text = NOTICES[CURRENT_SUBMISSION_NOTICE]
  expect(text).toContain("קישור המעקב")
  expect(text).toContain("למשוך אותה")
  expect(text).not.toContain("אין עדיין דף")
  expect(text).toContain("לתקן אותה")
  expect(text).not.toContain("כדי לתקן אותה, כתבו לנו")
  expect(text).toContain("לחזור אליי לתיקון")
  expect(text).toContain("תנאי השליחה")
  expect(text).toContain("התמונה")
  expect(text).toContain("נשארת במכשיר")
  expect(text).not.toContain("Turnstile")
})

// Every version a form has ever shown. A device may still retry a queued submission under one of them, and its consent
// record points to that text: removing a version would refuse the retry and orphan the record. Only append here.
const SHOWN = ["notice.submission@2026-10-2", "notice.submission@2026-10-3", "notice.submission@2026-10-4", "notice.submission@2026-10-5"]

it("never drops a version a form has shown, and keeps each one's text", () => {
  for (const v of SHOWN) {
    expect(SUBMISSION_NOTICES).toContain(v)
    expect(Object.keys(NOTICES)).toContain(v)
  }
  // New versions go at the end: the order is the order they were shown.
  expect(SUBMISSION_NOTICES.slice(0, SHOWN.length)).toEqual(SHOWN)
})
