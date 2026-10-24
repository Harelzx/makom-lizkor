import { expect, it } from "vitest"
import { letterHtml, textHtml } from "../lib/mail-html"
import { decisionMail, reportAlertMail, verificationMail } from "../lib/messages"

it("sets a mail right to left, with its one action as a button and the link kept in the text", () => {
  const m = verificationMail("a@example.org", "https://makomlizkor.org/verify?t=abc&x=1")
  expect(m.html).toMatch(/<html lang="he" dir="rtl">/)
  expect(m.html).toContain('href="https://makomlizkor.org/verify?t=abc&amp;x=1"')
  expect(m.html).toContain("אישור הכתובת")
  expect(m.text).toContain("https://makomlizkor.org/verify?t=abc&x=1")
  expect(m.html).not.toMatch(/<script|<img|@import|url\(/i)
})

it("escapes what a person wrote, so a place's name or a note can't become markup or a link", () => {
  const m = decisionMail("a@example.org", "return", '<b>גן</b> "x"', 'ראו <a href="https://evil.example">כאן</a>')
  expect(m.html).not.toContain("<b>גן</b>")
  expect(m.html).not.toContain('href="https://evil.example"')
  expect(m.html).toContain("&lt;b&gt;גן&lt;/b&gt;")
})

it("makes a button only of an https address", () => {
  const html = letterHtml("s", { heading: "h", paragraphs: [], action: { label: "go", href: "javascript:alert(1)" } })
  expect(html).not.toContain("javascript:")
  expect(html).not.toContain(">go<")
})

it("frames a text-only mail the same way, linking only the site's own addresses", () => {
  const html = textHtml("s", "שורה\nשנייה\n\nhttps://makomlizkor.org/admin/#reports ו־https://other.example/x")
  expect(html).toContain('<a href="https://makomlizkor.org/admin/#reports"')
  expect(html).not.toContain('href="https://other.example')
  expect(html).toContain("שורה<br>שנייה")
})

it("keeps the moderators' alert free of the requester's words in both forms", () => {
  const m = reportAlertMail("m@example.org", {
    link: "https://makomlizkor.org/admin/#reports",
    hidden: true,
    curated: false,
    reminder: false,
  })
  expect(m.html).toContain("פתיחת הבקשה בניהול")
  expect(m.text).toContain("https://makomlizkor.org/admin/#reports")
})
