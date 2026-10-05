// Invisible characters that can show text in a different order from the one stored ("Trojan Source").
// LRM and RLM (U+200E/F) stay: Hebrew mixed with numbers and English needs them.
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/g
const ZERO_WIDTH = /[\u200B\u2060\uFEFF]/g
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const FORBIDDEN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/

/** Normalized text, or null when it carries a control character we refuse to store. */
export function cleanText(input: string, opts: { multiline?: boolean } = {}): string | null {
  let s = input.normalize("NFC").replace(BIDI_CONTROLS, "").replace(ZERO_WIDTH, "").replace(/\r\n?/g, "\n")
  s = opts.multiline
    ? s
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    : s.replace(/\s+/g, " ").trim()
  return FORBIDDEN.test(s) ? null : s
}
