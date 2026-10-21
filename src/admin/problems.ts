import type { Attention } from "./api"

/**
 * A stuck operation, said as what happened and whether it is the moderator's to do: only a removal that never landed
 * is (the scheduled pass refuses it and never retries it); the rest the same pass finishes on its own, or is over.
 */
export const PROBLEM: Record<Attention["problem"], { title: string; detail: string; redo?: boolean }> = {
  interrupted: {
    title: "הסתרה לא הושלמה, והמקום עדיין מוצג",
    detail: "צריך להסתיר שוב: פותחים את המקום ומסמנים מה להסתיר.",
    redo: true,
  },
  ledger_repair: {
    title: "ההחלטה בוצעה, אבל רישום הפעולה ביומן נכשל",
    detail: "האתר ינסה שוב לבד. אם זה נשאר כאן יותר מיום, צריך בדיקה טכנית.",
  },
  media_failed: {
    title: "העברת תמונה לא הושלמה",
    detail: "האתר ינסה שוב לבד. אם זה נשאר כאן יותר מיום, צריך בדיקה טכנית.",
  },
  purge_abandoned: {
    title: "השינוי נשמר, אבל עותק ישן עלול להופיע עד דקה",
    detail: "אין צורך לעשות כלום.",
  },
}
