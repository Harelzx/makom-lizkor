import { env } from "cloudflare:workers"
import { call } from "./app"
import { expect, it } from "vitest"
import { CURRENT_REPORT_NOTICE, CURRENT_SUBMISSION_NOTICE, REPORT_NOTICES, SUBMISSION_NOTICES } from "@/shared/contract"
import { NOTICES, noticeHtml } from "@/data/legal"
import { DISCARD_LABEL } from "@/data/reports"
import { RETENTION } from "@/config"

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
  "notice.submission@2026-10-12",
  "notice.submission@2026-10-13",
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

it("the report notice says what the browser keeps and for how long, from the configured hours, and names the button that lets it go", () => {
  const text = noticeHtml(CURRENT_REPORT_NOTICE)
  expect(text).toContain("בדפדפן שלכם")
  expect(text).toContain(`רק עד ${RETENTION.reportOutboxHours} שעות מהשליחה הראשונה`)
  expect(text).toContain("וממשיך לנסות למחוק אותה כל עוד הוא פתוח")
  expect(text).toContain("היא עשויה להופיע בו שוב")
  expect(text).toContain("נשארת בטופס כפי שנשלחה")
  expect(text).toContain("בקשה חדשה על אותו מקום")
  expect(text).toContain(`«${DISCARD_LABEL}»`)
  expect(text).toContain("לא נשלחת שוב מעצמה")
  expect(text).toContain("נשמרת רק בדף הפתוח")
  expect(text).not.toContain("{{")
})

it("the submission notice says what the retention job erases: a returned or refused submission, and only a published place's correction", () => {
  const text = noticeHtml(CURRENT_SUBMISSION_NOTICE)
  expect(text).toContain("נשארת רק רשומה ריקה")
  expect(text).toContain("כבר לא ייפתח")
  expect(text).toContain("מפסיק לעבוד כשהוא נמחק")
  expect(text).toContain("נמחק רק התיקון")
  expect(text).toContain(`תוך ${RETENTION.returnedDays} יום`)
  expect(text).toContain(`נמחקת ${RETENTION.rejectedTextDays} יום אחרי ההחלטה`)
  expect(text).not.toContain("{{")
})

it("version 12 keeps the text it was shown with; version 13 says how each tracking link ends", () => {
  const twelve = noticeHtml("notice.submission@2026-10-12")
  expect(twelve).toContain("נשארת רק רשומה ריקה, וקישור המעקב יראה שההצעה נמחקה.")
  expect(twelve).not.toContain("כבר לא ייפתח")
  expect(twelve).not.toContain("מפסיק לעבוד כשהוא נמחק")
  const thirteen = noticeHtml("notice.submission@2026-10-13")
  expect(thirteen).toContain("וקישור המעקב שנשלח אליכם במייל כבר לא ייפתח")
  expect(thirteen).toContain("ומפסיק לעבוד כשהוא נמחק")
  expect(CURRENT_SUBMISSION_NOTICE).toBe("notice.submission@2026-10-14")
})

it("a submission made under version 12 is kept under 12, its retry is the same submission, and its link still works", async () => {
  // A form loaded before version 13 went up still sends 12 (adviser 20261006T153309Z-ef1427c3, F5-N1).
  const twelve = "notice.submission@2026-10-12"
  const key = crypto.randomUUID().replaceAll("-", "")
  const body = JSON.stringify({
    kind: "bench",
    name_he: "ספסל דמו בגרסה 12",
    lat: 31.42,
    lng: 34.49,
    email: "twelve-demo@example.test",
    consent_version: twelve,
  })
  const post = () =>
    call("http://local/api/v1/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key, "Turnstile-Token": "pass" },
      body,
    })
  const first = await post()
  expect(first.status).toBe(201)
  const again = await post()
  expect(again.status).toBe(200)
  const a = await first.json<{ id: string }>()
  const b = await again.json<{ id: string; trackingToken: string }>()
  expect(b.id).toBe(a.id)
  const recorded = await env.DB.prepare(
    "SELECT r.consent_version AS revision, c.consent_version AS contact, (SELECT COUNT(*) FROM revisions WHERE place_id = ?1) AS n FROM revisions r JOIN contacts c ON c.place_id = r.place_id WHERE r.place_id = ?1",
  )
    .bind(b.id)
    .first()
  expect(recorded).toEqual({ revision: twelve, contact: twelve, n: 1 })
  // The tracking link version 12 described still follows and withdraws it.
  const status = await call(`http://local/api/v1/submissions/${b.id}`, { headers: { Authorization: `Bearer ${b.trackingToken}` } })
  expect(status.status).toBe(200)
  // And the text it was shown is still there to read.
  expect(noticeHtml(twelve)).toContain("קישור המעקב")
  const mails = await env.DB.prepare("SELECT COUNT(*) AS n FROM dev_outbox WHERE to_address = ?")
    .bind("twelve-demo@example.test")
    .first("n")
  // One address check, sent once: the retry is the same submission, not a second mail.
  expect(mails).toBe(1)
})

it("version 14 describes receipt-only local storage, without rewriting version 13", () => {
  expect(noticeHtml("notice.submission@2026-10-13")).not.toContain("אין ניסיון שליחה אוטומטי")
  const current = noticeHtml(CURRENT_SUBMISSION_NOTICE)
  expect(current).toContain("אין עותק מקומי ואין ניסיון שליחה אוטומטי")
  expect(current).toContain("ייתכן שההצעה כבר הגיעה לשרת")
})
