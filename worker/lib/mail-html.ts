/**
 * The site's mails as a page, beside their plain text: right to left, one quiet column on a warm ground, the anemone's
 * dot and name above, the one thing to do as a dark button, and the small print below a hairline. Tables and inline
 * styles only, since that is what mail clients keep; no images, fonts or scripts to fetch. Whatever came from a person
 * (a place's name, a moderator's note) is escaped here, never trusted as markup.
 */

export type Letter = {
  heading: string
  /** Paragraphs in order; a line break inside one stays a line break. */
  paragraphs: string[]
  /** The one thing to do. Its address also stays in the plain text, which is what a client without HTML shows. */
  action?: { label: string; href: string }
  /** Small print under the button: how long a link lasts, what to do if it wasn't you. */
  note?: string
}

const INK = "#131a2c"
const MUTED = "#5f6472"
const GROUND = "#f4f2ec"
const LINE = "#e4e1d8"
// The site's mark (AnemoneMark: the anemone as an ink line, only its heart red) as public/art/mail-logo.png, a picture
// since mail clients don't draw SVG. A client that holds images back still shows the name beside it.
const LOGO = "https://makomlizkor.org/art/mail-logo.png"
const FONT = "Arial, 'Segoe UI', Helvetica, sans-serif"

const escape = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;")
const lines = (s: string) => escape(s).replaceAll("\n", "<br>")
// Only the site's own https links become buttons or anchors; anything else stays text.
const safeHref = (href: string) => (/^https:\/\/[^\s"'<>]+$/.test(href) ? escape(href) : null)

function page(subject: string, body: string) {
  return `<!doctype html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(subject)}</title></head>
<body style="margin:0;padding:0;background:${GROUND};" dir="rtl">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${GROUND};" dir="rtl">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#ffffff;border:1px solid ${LINE};border-radius:14px;" dir="rtl">
<tr><td dir="rtl" align="right" style="padding:28px 28px 24px;font-family:${FONT};color:${INK};text-align:right;direction:rtl;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" dir="rtl"><tr>
<td style="width:32px;vertical-align:middle;"><img src="${LOGO}" width="32" height="32" alt="" style="display:block;width:32px;height:32px;border:0;"></td>
<td style="padding-right:10px;vertical-align:middle;font-family:${FONT};font-size:16px;font-weight:bold;color:${INK};">מקום לזכור</td>
</tr></table>
${body}
</td></tr>
</table>
<p dir="rtl" style="margin:16px 0 0;font-family:${FONT};font-size:12px;color:${MUTED};text-align:center;">מקום לזכור · <a href="https://makomlizkor.org" style="color:${MUTED};">makomlizkor.org</a></p>
</td></tr>
</table>
</body>
</html>`
}

export function letterHtml(subject: string, l: Letter): string {
  const href = l.action && safeHref(l.action.href)
  const body = [
    `<h1 dir="rtl" style="margin:22px 0 10px;font-family:${FONT};font-size:21px;line-height:1.35;font-weight:bold;color:${INK};">${escape(l.heading)}</h1>`,
    ...l.paragraphs.map(
      (p) => `<p dir="rtl" style="margin:0 0 12px;font-family:${FONT};font-size:15px;line-height:1.7;color:${INK};">${lines(p)}</p>`,
    ),
    href && l.action
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 4px;"><tr><td style="background:${INK};border-radius:10px;">` +
        `<a href="${href}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">${escape(l.action.label)}</a>` +
        `</td></tr></table>`
      : "",
    l.note
      ? `<p dir="rtl" style="margin:22px 0 0;padding-top:14px;border-top:1px solid ${LINE};font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED};">${lines(l.note)}</p>`
      : "",
  ].join("\n")
  return page(subject, body)
}

/**
 * A mail written only as text (the operational alerts, a contact message) in the same frame: its paragraphs as they
 * are, and the site's own links clickable.
 */
export function textHtml(subject: string, text: string): string {
  const paragraphs = text.trim().split(/\n{2,}/)
  const body = paragraphs
    .map((p) => {
      const linked = lines(p).replace(/https:\/\/makomlizkor\.org[^\s<]*/g, (url) => `<a href="${url}" style="color:${INK};">${url}</a>`)
      return `<p dir="rtl" style="margin:0 0 12px;font-family:${FONT};font-size:15px;line-height:1.7;color:${INK};">${linked}</p>`
    })
    .join("\n")
  // The subject without the site's name, which the frame already carries: «מקום לזכור - תקלות בשרת» reads «תקלות בשרת».
  const heading = subject.replace(/^מקום לזכור\s*[-·]\s*/, "").replace(/\s*·\s*מקום לזכור$/, "")
  return page(
    subject,
    `<h1 dir="rtl" style="margin:22px 0 10px;font-family:${FONT};font-size:21px;line-height:1.35;font-weight:bold;color:${INK};">${escape(heading)}</h1>\n${body}`,
  )
}
