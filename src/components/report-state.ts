import { useEffect, useState, useSyncExternalStore } from "react"
import { RETENTION } from "@/config"
import { createHolder, type Holder, type HolderState } from "@/lib/report-holder"

// The privacy session's wording for each result (2026-10-06), word for word: a hide is never a decision on the request.
export const HIDDEN = "מה שציינתם הוסתר באופן זמני, כאמצעי זהירות, עד שאדם יבדוק את הבקשה. ההסתרה אינה הכרעה בבקשה."
export const RECEIVED = "הבקשה התקבלה. אדם יבדוק אותה בדחיפות."
export const RECEIVED_CURATED = "הבקשה התקבלה. אדם יבדוק אותה בדחיפות. במקומות שהאתר הוסיף בעצמו, שום דבר לא מוסתר לפני הבדיקה."

const HOURS = RETENTION.reportOutboxHours
// Not known to have arrived: never worded as received (F4-R12), and never as if nothing had arrived either. A resend is
// described as what the browser does (the same request again), not as a promise about what the server holds.
const UNKNOWN = "לא ברור אם הבקשה הגיעה אלינו. אפשר לשלוח אותה שוב כמו שהיא: היא תישלח כאותה בקשה, לא כבקשה חדשה."
const RESTORED = "בקשה ששלחתם מכאן עוד לא אושרה כמתקבלת. אפשר לשלוח אותה שוב כמו שהיא, כאותה בקשה, או להסיר אותה מהמכשיר הזה."
export const ELSEWHERE =
  "בקשת הסרה או תיקון ששלחתם מכאן, על מקום שאינו מוצג כרגע, עוד לא אושרה כמתקבלת. אפשר לשלוח אותה שוב כמו שהיא, כאותה בקשה, או להסיר אותה מהמכשיר הזה."
const UNREAD = "לא הצלחנו לבדוק אם שמורה בדפדפן הזה בקשה ששלחתם על המקום הזה. אם שלחתם בקשה ולא ראיתם שהתקבלה, ייתכן שכבר הגיעה אלינו."
const CONFLICT =
  "הקוד של הבקשה הזו כבר שמור אצלנו עם בקשה אחרת, ולכן לא ברור אם הבקשה הזו הגיעה. אפשר להסיר אותה מהמכשיר הזה ולשלוח בקשה חדשה."
const NOT_KEPT = " הדפדפן הזה לא שומר אותה: היא נשמרת רק בדף הפתוח, ואם תרעננו או תסגרו אותו, לא יהיה אפשר לשלוח אותה שוב."
const EXPIRED = `עברו ${HOURS} שעות מהשליחה הראשונה, ולכן הבקשה נמחקה מהדפדפן הזה בלי שנשלחה שוב. לא ידוע אם הגיעה אלינו. אם תרצו, אפשר למלא בקשה חדשה.`
const DISCARDED = "הבקשה הוסרה מהמכשיר הזה. אם כבר הגיעה אלינו, אדם יבדוק אותה כרגיל."
const DISCARD_FAILED = "לא הצלחנו להסיר את הבקשה מהדפדפן הזה. נסו שוב, או מחקו את נתוני האתר בהגדרות הדפדפן."
const NOT_CLEARED = ` העותק שנשמר בדפדפן הזה לא נמחק עכשיו. הוא יימחק לכל המאוחר ${HOURS} שעות אחרי השליחה הראשונה (אם האתר יהיה סגור אז, בפעם הבאה שייפתח).`
// Refused before the server stored anything: about this try only.
const NOT_SENT: Record<string, string> = {
  not_found: "המקום הזה אינו מוצג עכשיו, ולכן אי אפשר לשלוח עליו בקשה מכאן.",
  invalid_input: "משהו בטופס לא תקין. בדקו את המייל ואת ההסבר, ונסו שוב.",
  turnstile_required: "בדיקת הדפדפן לא הושלמה. נסו שוב בעוד רגע.",
  turnstile_failed: "בדיקת הדפדפן לא עברה. נסו שוב בעוד רגע.",
  rate_limited: "נשלחו מכאן הרבה בקשות בזמן קצר. נסו שוב בעוד דקה.",
  not_configured: "השליחה לא זמינה כרגע. נסו שוב מאוחר יותר.",
  turnstile_unavailable: "השליחה לא זמינה כרגע. נסו שוב בעוד רגע.",
}
const AFTER_EARLIER = " ניסיון קודם עדיין לא אושר, ואפשר לנסות שוב כמו שהבקשה נשלחה."
const refused = (code?: string) => NOT_SENT[code ?? ""] ?? NOT_SENT.not_configured

/** What the holder's state says to the visitor: a settled answer (`status`), or anything else (`alert`). */
export function messageOf(s: HolderState, curated: boolean, restored = RESTORED): { status?: string; alert?: string } {
  const shown = s.shown
  if (!shown) return {}
  const kept = s.stored ? "" : NOT_KEPT
  switch (shown.view) {
    case "result":
      return {
        status:
          (shown.outcome === "hidden_for_review" ? HIDDEN : curated ? RECEIVED_CURATED : RECEIVED) + (shown.cleared ? "" : NOT_CLEARED),
      }
    case "editable":
      return { alert: refused(shown.code) + (shown.cleared ? "" : NOT_CLEARED) }
    case "pending":
      if (shown.reason === "conflict") return { alert: CONFLICT + kept }
      if (shown.reason === "refused") return { alert: refused(shown.code) + AFTER_EARLIER + kept }
      return { alert: UNKNOWN + kept }
    case "restored":
      return { alert: restored }
    case "unread":
      return { alert: UNREAD }
    case "expired":
      return { alert: EXPIRED + (shown.cleared ? "" : NOT_CLEARED) }
    case "discarded":
      return { alert: shown.cleared ? DISCARDED : DISCARD_FAILED }
  }
}

/** A holder for one form, and its state. Past its window the request is let go in an open page as well. */
export function useHolder(): [Holder, HolderState] {
  const [h] = useState(() => createHolder())
  const s = useSyncExternalStore(h.subscribe, h.get)
  useEffect(() => {
    const r = s.kept
    if (!r || s.busy) return
    // On time, and on coming back to a page that slept through it (a timer doesn't run in a sleeping laptop).
    const check = () => void h.expire()
    const t = setTimeout(check, Math.max(0, r.expiresAt - Date.now()))
    document.addEventListener("visibilitychange", check)
    return () => {
      clearTimeout(t)
      document.removeEventListener("visibilitychange", check)
    }
  }, [h, s.kept, s.busy])
  return [h, s]
}
