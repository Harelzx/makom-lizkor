import type { Attention } from "./api"

/** A stuck operation, said as what a moderator should do about it. */
export const PROBLEM: Record<Attention["problem"], string> = {
  interrupted: "הסתרה שנעצרה לפני שנשמרה: צריך לבצע אותה שוב",
  ledger_repair: "ההחלטה נשמרה, אבל הרישום ב־ledger עוד לא הושלם",
  media_failed: "העברת קובץ לא הושלמה",
  purge_abandoned: "ניקוי המטמון בקצה לא הצליח; העותק יפוג תוך דקה",
}
