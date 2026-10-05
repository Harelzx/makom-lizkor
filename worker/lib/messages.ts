import type { Mail } from "./mail"

// The mails the site sends, in Hebrew. The first, to an address nobody has confirmed yet, says nothing about the place:
// anyone could have typed someone else's address. The rest go only to a verified address.
const SIGN = "\n\nמקום לזכור"

export const verificationMail = (to: string, link: string): Mail => ({
  to,
  subject: "אימות כתובת המייל · מקום לזכור",
  text:
    `מישהו הציע מקום ב"מקום לזכור" והשאיר את הכתובת הזו כדי לקבל עדכונים.\n\n` +
    `כדי לאשר שזו הכתובת שלכם, פתחו את הקישור ולחצו "אישור הכתובת":\n${link}\n\n` +
    `הקישור בתוקף 7 ימים. אם זה לא אתם, אפשר להתעלם מהמייל: לא נשלח אליו שום דבר נוסף.` +
    SIGN,
})

export const trackingMail = (to: string, link: string): Mail => ({
  to,
  subject: "קישור המעקב אחרי ההצעה שלכם · מקום לזכור",
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

export const decisionMail = (to: string, action: string, name: string, note?: string, correction = false): Mail => ({
  to,
  subject: "עדכון על ההצעה שלכם · מקום לזכור",
  text: ((correction ? CORRECTION : DECISION)[action]?.(name, note) ?? "") + SIGN,
})
