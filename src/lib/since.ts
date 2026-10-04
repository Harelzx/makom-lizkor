// How long it has been since that morning, in the words the site speaks.
// Computed from today's date in Israel, so the copy stays true after the anniversary and in the years that follow.

const FIRST = Date.UTC(2023, 9, 7)
const DAY = 86_400_000

const FEMININE = ["", "", "", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה", "תשע", "עשר"]
const MASCULINE = ["", "", "", "שלושה", "ארבעה", "חמישה", "שישה", "שבעה", "שמונה", "תשעה", "עשרה"]

/** Today's calendar date in Israel, wherever the visitor happens to be. */
function israelDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return { year: get("year"), month: get("month"), day: get("day") }
}

/**
 * The years turn on 15 September, not on 7 October: the memorial day of the Hebrew calendar (24 Tishrei)
 * falls anywhere from late September to late October, and through that season the site speaks of the anniversary being marked.
 */
export function since(now = new Date()) {
  const { year, month, day } = israelDate(now)
  const days = Math.round((Date.UTC(year, month - 1, day) - FIRST) / DAY)
  const years = year - 2023 - (month < 9 || (month === 9 && day < 15) ? 1 : 0)
  return { days, years }
}

/** The day of the count a date falls on: 0 on 7 October 2023. */
export const dayOf = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - FIRST) / DAY)

/** "שלוש שנים", "ארבע שנים" … */
export function yearsHe(n: number) {
  if (n === 1) return "שנה"
  if (n === 2) return "שנתיים"
  return `${FEMININE[n] ?? n} שנים`
}

/** "שלושה חורפים", "ארבעה חורפים" … */
export function wintersHe(n: number) {
  if (n === 1) return "חורף אחד"
  if (n === 2) return "שני חורפים"
  return `${MASCULINE[n] ?? n} חורפים`
}

/** "1,093 ימים" */
export const daysHe = (n: number) => `${n.toLocaleString("he-IL")} ימים`
