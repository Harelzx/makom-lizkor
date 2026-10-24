import type { Mail } from "./mail"
import { letterHtml } from "./mail-html"

// The mails the site sends, in Hebrew. The first, to an address nobody has confirmed yet, says nothing about the place:
// anyone could have typed someone else's address. The rest go only to a verified address.
const SIGN = "\n\nמקום לזכור"

const VERIFY_SUBJECT = "אימות כתובת המייל · מקום לזכור"
export const verificationMail = (to: string, link: string): Mail => ({
  to,
  budget: "visitor",
  subject: VERIFY_SUBJECT,
  html: letterHtml(VERIFY_SUBJECT, {
    heading: "אישור כתובת המייל",
    paragraphs: [`מישהו הציע מקום ב"מקום לזכור" והשאיר את הכתובת הזו כדי לקבל עדכונים.`, "כדי לאשר שזו הכתובת שלכם, לחצו על הכפתור."],
    action: { label: "אישור הכתובת", href: link },
    note: "הקישור בתוקף 7 ימים. אם זה לא אתם, אפשר להתעלם מהמייל: לא נשלח אליו שום דבר נוסף.",
  }),
  text:
    `מישהו הציע מקום ב"מקום לזכור" והשאיר את הכתובת הזו כדי לקבל עדכונים.\n\n` +
    `כדי לאשר שזו הכתובת שלכם, פתחו את הקישור ולחצו "אישור הכתובת":\n${link}\n\n` +
    `הקישור בתוקף 7 ימים. אם זה לא אתם, אפשר להתעלם מהמייל: לא נשלח אליו שום דבר נוסף.` +
    SIGN,
})

const TRACKING_SUBJECT = "קישור המעקב אחרי ההצעה שלכם · מקום לזכור"
export const trackingMail = (to: string, link: string): Mail => ({
  to,
  budget: "visitor",
  subject: TRACKING_SUBJECT,
  html: letterHtml(TRACKING_SUBJECT, {
    heading: "הכתובת אומתה",
    paragraphs: ["בקישור המעקב רואים את מצב ההצעה, ושם אפשר גם לתקן אותה או למשוך אותה."],
    action: { label: "למעקב אחרי ההצעה", href: link },
    note: "מי שיש לו את הקישור יכול לתקן או למשוך את ההצעה, ולכן כדאי לא להעביר את המייל הלאה.",
  }),
  text:
    `הכתובת אומתה. זה קישור המעקב אחרי ההצעה שלכם:\n${link}\n\n` +
    `בקישור רואים את מצב ההצעה, ושם אפשר גם לתקן אותה או למשוך אותה. מי שיש לו את הקישור יכול לעשות את זה, ולכן כדאי לא להעביר אותו הלאה.` +
    SIGN,
})

const DECISION: Record<string, (name: string, note?: string) => string> = {
  approve: (name) => `ההצעה "${name}" אושרה ומופיעה עכשיו באתר.`,
  reject: (name) => `ההצעה "${name}" לא אושרה.`,
  return: (name, note) => `החזרנו אליכם את ההצעה "${name}" לתיקון.\n\nהערת המאשרים:\n${note ?? ""}\n\nאת התיקון שולחים מקישור המעקב.`,
}

// A correction of a place already published: the place itself stays as it was approved, whatever is decided.
const CORRECTION: Record<string, (name: string, note?: string) => string> = {
  approve: (name) => `התיקון ל"${name}" אושר, והוא מופיע עכשיו באתר.`,
  reject: (name) => `התיקון ל"${name}" לא אושר. המקום נשאר באתר כפי שאושר קודם.`,
  return: (name, note) =>
    `החזרנו אליכם את התיקון ל"${name}" לתיקון נוסף. המקום נשאר באתר כפי שאושר קודם.\n\nהערת המאשרים:\n${note ?? ""}\n\nאת התיקון שולחים מקישור המעקב.`,
}

// A correction of a place not shown now: approving it doesn't show the place again, so the mail can't say it does.
const HIDDEN_CORRECTION: Record<string, (name: string, note?: string) => string> = {
  ...CORRECTION,
  approve: (name) => `התיקון ל"${name}" אושר. המקום אינו מוצג כרגע באתר.`,
  reject: (name) => `התיקון ל"${name}" לא אושר. המקום אינו מוצג כרגע באתר.`,
  return: (name, note) =>
    `החזרנו אליכם את התיקון ל"${name}" לתיקון נוסף. המקום אינו מוצג כרגע באתר.\n\nהערת המאשרים:\n${note ?? ""}\n\nאת התיקון שולחים מקישור המעקב.`,
}

const DECISION_SUBJECT = "עדכון על ההצעה שלכם · מקום לזכור"
export const decisionMail = (to: string, action: string, name: string, note?: string, correction = false, hidden = false): Mail => {
  const said = (hidden ? HIDDEN_CORRECTION : correction ? CORRECTION : DECISION)[action]?.(name, note) ?? ""
  return {
    to,
    subject: DECISION_SUBJECT,
    html: letterHtml(DECISION_SUBJECT, { heading: "עדכון על ההצעה שלכם", paragraphs: said.split("\n\n") }),
    text: said + SIGN,
  }
}

/**
 * To the moderators, about a removal or correction request waiting for a person (spec 6): a link to the queue and what
 * the automatic path did, nothing of what the requester wrote or who they are. Mail passes through a provider; the
 * request itself stays in the admin.
 */
export const reportAlertMail = (
  to: string,
  r: { link: string; hidden: boolean; curated: boolean; reminder: boolean; waitingHours?: number },
): Mail => {
  const subject = r.reminder ? "תזכורת: בקשה ממתינה לבדיקה דחופה · מקום לזכור" : "בקשה חדשה לבדיקה דחופה · מקום לזכור"
  const opening = r.reminder
    ? `בקשה להסרה או לתיקון ממתינה כבר ${r.waitingHours ?? 0} שעות, ועדיין לא תועד טיפול בה.`
    : "התקבלה בקשה להסרה או לתיקון."
  const what = r.hidden
    ? "הפרט שבבקשה הוסתר באופן זהיר עד להחלטה. ההסתרה אינה קביעה שהבקשה מוצדקת."
    : r.curated
      ? "הבקשה נוגעת לאחד המקומות של האתר עצמו. הוא לא מוסתר אוטומטית: הסרה שלו היא שינוי בקוד."
      : "שום דבר לא הוסתר אוטומטית."
  const promise = "התחייבנו לתגובה אנושית בתוך 48 שעות לכל היותר, והיעד הוא 24."
  return {
    to,
    subject,
    html: letterHtml(subject, {
      heading: r.reminder ? "בקשה עדיין ממתינה לבדיקה" : "בקשה חדשה לבדיקה",
      paragraphs: [opening, what],
      action: { label: "פתיחת הבקשה בניהול", href: r.link },
      note: promise,
    }),
    text: `${opening}\n\n${what}\n\nהבקשה ממתינה בתור:\n${r.link}\n\n${promise}` + SIGN,
  }
}
