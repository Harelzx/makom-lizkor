// Legal and policy texts. Based on a compliance brief (October 2026); general information, not legal advice.
// Names, addresses, providers and periods are tokens like {{EMAIL}}, filled from src/config.ts by fillLegal(), so a
// value is set once and every text that states it changes with it. {{FONTS}} is filled where the credits are shown.

import { ACCESS_RESPONSE_DAYS, CONTACT_EMAIL, HOSTING, MAILBOX, OPERATOR, RETENTION } from "@/config"

export const FAMILY_CONSENT_TEXT =
  "אני בן או בת משפחה של מי שהמקום מנציח, או שקיבלתי את רשות המשפחה להוסיף את פרטי ההנצחה. ידוע לי שאפשר לבקש להסיר אותם בכל עת."

// Matches the notice the add form shows (CURRENT_SUBMISSION_NOTICE in src/shared/contract.ts), a draft until approved.
export const CONSENT_TEXT =
  "קראתי את הודעת הפרטיות ואת תנאי השליחה שלמעלה, ואני מסכים או מסכימה להם. ידוע לי שהפרטים יישלחו לבדיקה, ויוצגו לכל הגולשים רק אחרי שיאושרו."

export const PHOTO_RIGHTS_TEXT =
  "צילמתי את התמונה בעצמי, או שקיבלתי רשות מהצלם או מבעל הזכויות לפרסם אותה. ידוע לי שגם אם התמונה נמצאת ברשות המשפחה, הזכויות בה עשויות להיות של הצלם."

const link = (href: string, text: string) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`
const MAIL = `<a href="mailto:{{EMAIL}}">{{EMAIL}}</a>`
const HOME_FRONT = link("https://www.oref.org.il", "פיקוד העורף")

/** A placeholder reads as one, in brackets, so nothing unfilled can pass for a real value. */
const days = (n: number | null) => (n === null ? "[X ימים]" : `${n} יום`)

/** Fill a text's tokens from config.ts. */
export const fillLegal = (html: string) =>
  html
    .replaceAll("{{OPERATOR}}", OPERATOR.name)
    .replaceAll("{{EMAIL}}", CONTACT_EMAIL)
    .replaceAll("{{MAIL_PROVIDER}}", MAILBOX.provider)
    .replaceAll("{{MAIL_STORED_IN}}", MAILBOX.storedIn)
    .replaceAll("{{MAIL_MAX}}", `${MAILBOX.maxMonths} חודשים`)
    .replaceAll("{{MAIL_TAIL}}", days(MAILBOX.deletionTailDays))
    .replaceAll("{{HOSTING}}", HOSTING.provider)
    .replaceAll("{{CONTACT_AFTER_CLOSE}}", days(RETENTION.contactAfterCloseDays))
    .replaceAll("{{CONTACT_MAX}}", `${RETENTION.contactMaxMonths} חודשים`)
    .replaceAll("{{BACKUP_TAIL}}", days(RETENTION.backupTailDays))
    .replaceAll("{{REJECTED_PHOTO}}", days(RETENTION.rejectedPhotoDays))
    .replaceAll("{{TRIBUTE_DAYS}}", days(RETENTION.tributeDays))
    .replaceAll("{{ACCESS_DAYS}}", days(ACCESS_RESPONSE_DAYS))
    .replaceAll("{{REPORT_ABUSE_HOURS}}", `${RETENTION.reportAbuseCodeMaxHours} שעות`)
    .replaceAll("{{REPORT_OUTBOX_HOURS}}", `${RETENTION.reportOutboxHours} שעות`)
    .replaceAll("{{RETURNED_DAYS}}", days(RETENTION.returnedDays))
    .replaceAll("{{REJECTED_TEXT_DAYS}}", days(RETENTION.rejectedTextDays))
    .replaceAll("{{AUDIT_MAX}}", `${RETENTION.auditMonths} חודשים`)
    .replaceAll("{{RECOVERY_DAYS}}", days(RETENTION.restoreDrillCopyDays))

/**
 * The sections in About. They describe the site as it is now: a place a visitor adds, with its photo, is sent for
 * review, and appears to everyone only once approved. The form shows the notice for submissions below.
 */
export const LEGAL_SECTIONS: { id: string; title: string; html: string }[] = [
  {
    id: "terms",
    title: "תנאי שימוש",
    html: `
<p>"מקום לזכור" הוא מיזם פרטי והתנדבותי, ללא מטרות רווח, שמפעיל {{OPERATOR}}. הוא נועד להנציח את נרצחי ונופלי 7 באוקטובר 2023, ולספר על הקהילות בדרום שחוזרות לפרוח. <strong>האתר אינו אתר רשמי</strong> ואינו קשור למשרד הביטחון, לצה"ל, לביטוח הלאומי או לכל גוף ממשלתי אחר. המידע הרשמי נמצא באתרים ${link("https://www.izkor.gov.il", "יזכור")} ו${link("https://laad.btl.gov.il", "לעד")}.</p>
<p><strong>דיוק.</strong> נעשה מאמץ להציג מידע מדויק, ובכל זאת ייתכנו טעויות, ומידע עשוי להתיישן. מידע שמשתנה, כמו מצב החזרה של קהילה, נכון לתאריך שמופיע לצדו. מיקומים שמסומנים "משוער" מצביעים על היישוב או האזור, ולא על הנקודה המדויקת. מצאתם טעות? כתבו לנו.</p>
<p><strong>ביקור במקומות.</strong> הופעת מקום באתר אינה אומרת שהוא פתוח לביקור, שמותר להגיע אליו או שהדרך אליו בטוחה. חלק מהמקומות קרובים לגבול עזה, בתוך יישובים או בשטח פרטי, והגישה אליהם עשויה להיות מוגבלת או אסורה. לפני יציאה בדקו את ההנחיות של ${HOME_FRONT} ואת הודעות צה"ל, וביישובים תאמו ביקור מראש. כפתורי הניווט פותחים את Waze או את Google Maps; האתר לא בודק את המסלול שהם מציעים.</p>
<p><strong>תוכן שמוסיפים.</strong> מי שמוסיף תוכן אחראי לו. אסור להוסיף תוכן פוגעני, תוכן שאין לכם זכות להשתמש בו, מידע פרטי על אנשים אחרים בלי הסכמתם, הזדהות עם טרור או הכחשה של הטבח.</p>
<p><strong>תמונות וטקסטים.</strong> כל תמונה באתר מוצגת לפי הרישיון או ההרשאה שלה, ושם הצלם מופיע לצדה. אנחנו מקשרים לכתבות ולא מעתיקים מהן טקסט או תמונות. התיאורים באתר נכתבו במקור עבור "מקום לזכור", ומותר לצטט אותם לצורכי הנצחה, עם ציון המקור.</p>
<p><strong>אחריות.</strong> האתר ניתן בחינם, כמו שהוא. ככל שהדין מתיר, המפעיל אינו אחראי לנזק שנגרם מהסתמכות על המידע באתר או באתרים שהוא מקשר אליהם, ואיננו אחראים לתוכן של אתרים אחרים.</p>
<p>השימוש באתר כפוף לדין הישראלי, וסמכות השיפוט נתונה לבתי המשפט המוסמכים בישראל. התנאים עשויים להתעדכן; התאריך בתחתית הדף מראה מתי עודכנו לאחרונה.</p>`,
  },
  {
    id: "takedown",
    title: "בקשת תיקון או הסרה",
    html: `
<p>אתם בני משפחה, בעלי זכויות בתמונה, או שמצאתם טעות? כתבו לנו לכתובת ${MAIL}. ציינו את שם המקום, מה צריך לתקן או להסיר, ומה הקשר שלכם אליו.</p>
<p>אדם קורא כל פנייה בדחיפות. בקשה של משפחה או של בעל הזכויות עשויה להביא להסתרה זמנית של הפרט שציינתם, כאמצעי זהירות, עד שהבדיקה תסתיים. נשיב תוך 7 ימים לכל המאוחר. תוכן שהוסתר חוזר רק אחרי בדיקה מתועדת, ולעולם לא רק בגלל מחלוקת בין בני משפחה.</p>
<p>הסרה מורידה את התוכן מהאתר ומהקישורים אליו. עותקים שכבר נשמרו מחוץ לאתר, כמו תצוגה מקדימה של קישור ששותף ב־WhatsApp או בפייסבוק, או מטמון של מנוע חיפוש, נשמרים אצל השירותים האלה ואינם בשליטתנו. כשאפשר, נבקש מהם להסיר אותם. אצלנו, תוכן שנמחק בעקבות בקשה נמחק גם מהגיבויים תוך {{BACKUP_TAIL}}.</p>`,
  },
  {
    id: "privacy",
    title: "פרטיות",
    html: `
<p><strong>מי אחראי על המידע:</strong> {{OPERATOR}}, שמפעיל את האתר באופן פרטי והתנדבותי. ליצירת קשר: ${MAIL}.</p>
<p><strong>מקום שאתם מוסיפים נשלח אלינו לבדיקה.</strong> סוג המקום, השם, הנקודה על המפה, היישוב, למי הוא מוקדש, הסיפור והקישור נשלחים לשרת של האתר. מאשר בודק אותם, והמקום יופיע לכל הגולשים רק אחרי שיאושר. אם כתבתם את השם שלכם או מייל, הם נשמרים בנפרד ולא מתפרסמים. למייל נשלח קודם מייל אימות, בלי פרטים על המקום, ורק אחרי שתאשרו אותו נשלח אליו את קישור המעקב ועדכון כשתתקבל החלטה. עותק של המיילים שהאתר שולח לכם, עם כתובת המייל שלכם, נשמר בתיבת הדואר של המיזם לפי הכלל שמתואר כאן בהמשך. אין חובה לשלוח: בלי זה המקום פשוט לא יופיע אצל אחרים. ההודעה המלאה מוצגת בטופס ההוספה, לפני השליחה.</p>
<p><strong>תמונה.</strong> היא מוקטנת, ונתוני המיקום ושאר הנתונים שהמצלמה שומרת בקובץ (EXIF) נמחקים, בדפדפן ושוב בשרת. היא נשלחת לבדיקה עם המקום, ומתפרסמת רק אם המקום אושר; תמונה שלא אושרה נמחקת. עותק של המקום נשמר גם בדפדפן; מחיקה שלו מהמכשיר לא מושכת את ההצעה. את מצב ההצעה רואים בקישור המעקב שמוצג אחרי השליחה, ושם אפשר גם לתקן אותה או למשוך אותה: המשיכה מוחקת מהשרת מיד את ההצעה ואת השם והמייל שלכם, ומורידה את התמונה מהאתר; קובץ התמונה נמחק מהאחסון מיד, ואם המחיקה נכשלת, הוא נמחק בהמשך. אם החזרנו הצעה לתיקון, ההערה שלנו מופיעה שם, ושם שולחים אותה מחדש. כשמאושר תיקון למקום שכבר מוצג, הגרסה הקודמת לא מתפרסמת, אבל נשמרת אצלנו כל עוד המקום באתר, כדי שאפשר יהיה לבדוק מה השתנה; משיכת המקום מוחקת גם אותה.</p>
<p><strong>אם תכתבו לנו במייל או בטופס הפנייה.</strong> נשתמש במה שכתבתם רק כדי לטפל בפנייה ולחזור אליכם. כשהטופס פעיל, כתובת האימייל וההודעה עוברות דרך {{HOSTING}} לצורך שליחתן לתיבת המיזם; האתר אינו שומר עותק שלהן במסד הנתונים או טיוטה בדפדפן. המייל נשמר בתיבת הדואר של המיזם אצל {{MAIL_PROVIDER}}, שמעבד מידע ב{{MAIL_STORED_IN}}. מנגנון נפרד מעביר כל הודעה שחלפו {{MAIL_MAX}} ממועד קבלתה לאשפה. הוא מתוזמן מדי שעה, בכפוף לזמינות ולמכסות Google. תשובה חדשה באותו שרשור נבחנת לפי מועד קבלתה. אפשר לבקש מחיקה מוקדמת. לפי ${link("https://support.google.com/mail/answer/7401?hl=iw", "מדיניות Gmail")} הודעה באשפה ניתנת לשחזור עד {{MAIL_TAIL}}, ולאחר מכן נמחקת מהתיבה. זהו חלון השחזור המתועד של הספק; לא מדדנו מחיקה פיזית של עותקים או גיבויים פנימיים אצל Google. המיזם אינו מרוקן את האשפה אוטומטית; מנגנון השמירה אינו קורא את תוכן ההודעות.</p>
<p><strong>המיקום שלכם.</strong> הכפתור "המיקום הנוכחי שלי" מבקש מהדפדפן את המיקום שלכם רק כשלוחצים עליו, ורק כדי לסמן את המקום שאתם מוסיפים. נשמרת רק הנקודה של המקום, בלי השעה ובלי הדיוק של האיתור. הנקודה נשלחת עם המקום, ואם הוא יאושר, היא תוצג במדויק. אם תסמנו בטופס שהמקום בשטח פרטי, נציג אותו במיקום משוער, ברמת היישוב, בלי ניווט אליו, ונשמור רק את הנקודה המעוגלת; מיקום מדויק יוצג רק ברשות הבעלים.</p>
<p><strong>כלניות.</strong> כשמשאירים כלנית במקום שמוצג במפה, ממקומות האתר או ממקומות שנוספו ואושרו, כלנית אחת ביום מכל מכשיר נספרת במונה שכולם רואים. לשם כך נשמר בדפדפן מזהה אקראי של המכשיר, שאינו קשור לשם או לפרטים שלכם. הדפדפן שולח את המזהה עם הכלנית; השרת לא שומר אותו, אלא רק קוד שנגזר ממנו ומהתאריך ומשתנה בכל יום, יחד עם המקום, היום והשעה. כדי להגביל שימוש לרעה, נשמר עם הכלנית גם קוד שנגזר מכתובת ה־IP ומהתאריך ומשתנה בכל יום, כך שמכתובת אחת נספרות עד 20 כלניות ביום בכל מקום; הכתובת עצמה לא נשמרת. בנוסף, השירות של Cloudflare סופר בקצה הרשת בקשות לפי קוד שנגזר מהכתובת. הרשומות נמחקות אחרי {{TRIBUTE_DAYS}}, ואינן נכללות בגיבויים; ספק האחסון שומר אפשרות לשחזר מצב קודם של מסד הנתונים כולו עד {{RECOVERY_DAYS}}, ואחרי זה גם היא נעלמת. כלניות נוספות באותו יום, וכלניות במקום שנשמר רק במכשיר שלכם, נשמרות רק במכשיר.</p>
<p><strong>מה נשמר בדפדפן.</strong> אם כבר צפיתם בפתיחה, ואם בחרתם לצפות בה עם צליל, כדי שלא תצטרכו לבחור שוב; המקומות שהוספתם והתמונות שצירפתם; עותק מקומי של הצעה חדשה נשמר רק אחרי שהשרת אישר שקיבל אותה; טופס ששליחתו לא אושרה נשאר בזיכרון הדף בלבד, ואינו נשמר במכשיר או נשלח שוב ברקע; למקום שנשלח, קישור המעקב שלו, עד שהמשיכה שלו מהמכשיר הזה תושלם, כולל מחיקת התמונה מהאחסון (אם משכתם ממקום אחר, הקישור נשאר כאן, אבל מראה רק שההצעה נמשכה); הכלניות שהשארתם; המקומות ששמרתם לביקור; רשימה של מקומות שהאתר למד שהוסרו, כדי שלא יוצגו מהעותק שבמכשיר; בקשת הסרה או תיקון ששלחתם, כפי ששלחתם אותה, כולל ההסבר והמייל, עד שנדע מה קרה איתה, ולכל היותר {{REPORT_OUTBOX_HOURS}} מהשליחה (אם האתר היה סגור, עד הפעם הבאה שייפתח; אם הדפדפן לא אפשר למחוק אותה, עד שיאפשר); מזהה אקראי של המכשיר, רק לספירת הכלניות; ועותק של המקומות שאושרו, כדי שהמפה תעבוד גם בלי חיבור. קובץ שתייצאו מהמקומות שהוספתם לא כולל את השם, את המייל או את קישור המעקב. האתר לא מפעיל עוגיות פרסום או כלי מעקב אחרי הגלישה האישית. השרת שומר סיכומים לפי שעה: מדגם של קודי התגובה וזמני התגובה, וספירה מלאה של תקלות (בשרת, בעבודות שרצות ברקע ובקוד האתר בדפדפן), בלי כתובת, מייל, תוכן, קישור או מזהה גולש. הסיכומים אינם נכללים בגיבויים, ונמחקים בסבב הניקוי הרגיל לאחר כשני ימים, עם מרווח של גרנולריות השעה והתזמון.</p>
<p><strong>שירותים חיצוניים.</strong> האתר מוגש דרך {{HOSTING}}. כשאתם שולחים מקום, תיקון, בקשת הסרה או פנייה בטופס, בדיקת הבוטים של Cloudflare (Turnstile) רצה בדפדפן. המפה, נתוני הגובה והגופנים נטענים מהאתר עצמו, ולא משרתים של אחרים. כדי להגביל שימוש לרעה, השרת ו־Cloudflare סופרים בקשות (שליחה, בקשות הסרה, פניות, כלניות, טעינת המפה והנתונים) לפי קוד שנגזר מכתובת ה־IP; הכתובת עצמה לא נשמרת. כפתורי הניווט פותחים את Waze או את Google Maps, לפי התנאים שלהם.</p>
<p><strong>יומנים ודיווחים טכניים.</strong> השרת רושם שורות טכניות: קודים, מזהים של מקומות ושל פעולות, וספירות, בלי כתובת IP, מייל או תוכן. הן נשמרות אצל Cloudflare עד 7 ימים. הדפדפן עשוי לשלוח לנו דיווח כשמשהו בדף חורג ממדיניות האבטחה שלו, או כשקוד של האתר נכשל אצלכם; נשמרים ממנו רק סוג הכלל וסוג המקור, או סוג השגיאה ושם הקובץ באתר, בלי תוכן השגיאה, בלי כתובת הדף ובלי הכתובת שלכם.</p>
<p><strong>יומן הפעולות של המאשרים.</strong> כל פעולה של מאשר, כמו אישור, הסתרה או צפייה בפרטי הקשר של מי שביקש הסרה, נרשמת: מי, מה, על איזה מקום ומתי, בלי התוכן עצמו. היומן נשמר {{AUDIT_MAX}}, כדי שאפשר יהיה לבדוק החלטות ולתקן טעויות.</p>
<p><strong>הזכויות שלכם.</strong> לעיין במידע שלכם שנמצא אצלנו ולבקש לתקן אותו. נשיב תוך {{ACCESS_DAYS}}.</p>`,
  },
  {
    id: "accessibility",
    title: "הצהרת נגישות",
    html: `
<p>אנחנו רוצים שכל אחד ואחת יוכלו להשתמש באתר, כולל אנשים עם מוגבלות. היעד הוא ת"י 5568, שמאמץ את הנחיות WCAG 2.0 ברמה AA. <strong>כרגע האתר עומד בתקן באופן חלקי:</strong> חלק מהבדיקות נעשו, וחלק עוד לא.</p>
<p><strong>מה עשינו:</strong></p>
<ul>
<li>כל המקומות והקהילות מופיעים גם ברשימה, עם חיפוש, כחלופה למפה.</li>
<li>הכפתור הראשון בדף, "דילוג לרשימת המקומות", מוביל ישר לרשימה. כשהפתיחה מסתיימת, המיקוד עובר אליו.</li>
<li>להצהרה הזו, לפרטיות ולתנאי השימוש אפשר להגיע גם מהקישורים שבתחתית הרשימה, ומהחיפוש.</li>
<li>אפשר לנווט במקלדת בלבד, ולכל רכיב שמקבל מיקוד יש סימון נראה לעין. לכל נקודה על המפה יש שם.</li>
<li>הגלריות עוברות בחיצים, ולכל תמונה יש כפתור עם שם ותיאור.</li>
<li>הטקסט גדל עם הגדלת הדפדפן, גם כשמגדילים רק את הטקסט, והניגודיות בין טקסט לרקע נבדקה לפי התקן.</li>
<li>לכל תמונה יש טקסט חלופי, וכשמוסיפים תמונה חובה לכתוב לה תיאור.</li>
<li>האתר בעברית ומימין לשמאל, והשפה מוגדרת בדף.</li>
<li>הצליל מופעל רק בבחירה, והאנימציות מצטמצמות כשהמערכת מוגדרת להפחתת תנועה.</li>
</ul>
<p><strong>מה נבדק, ב־5 באוקטובר 2026:</strong></p>
<ul>
<li>בדיקה אוטומטית בכלי axe לפי כללי WCAG 2.0 ברמות A ו־AA, ב־Chrome, ב־Firefox ובמנוע של Safari (WebKit): הפתיחה, המפה והרשימה ביום ובלילה, דף מקום עם גלריה, "על הפרויקט", החיפוש, כל שלבי הוספת מקום, ותצוגת טלפון; וב־6 באוקטובר גם טופס בקשת ההסרה או התיקון, עם הודעת הפרטיות שלו ועם התשובה אחרי השליחה. הבדיקה רצה עם כל שינוי באתר. בדיקה אוטומטית מוצאת רק חלק מהבעיות.</li>
<li>ניווט במקלדת, ב־Chrome, ב־Firefox ובמנוע של Safari: סדר המעבר, הכפתור "דילוג לרשימת המקומות", סימון המיקוד, הגלריה (חיצים וכפתור לכל תמונה), החיפוש, והקישורים להצהרה, לפרטיות ולתנאים.</li>
<li>הגדלת הדף ל־200%, הגדלת הטקסט בלבד ל־200%, ותצוגת טלפון.</li>
<li>עברית וכיווניות מימין לשמאל.</li>
<li>קורא המסך VoiceOver במחשב Mac, ב־Safari וב־Chrome: הפתיחה ובחירת הצליל, כפתור הדילוג, הפאנל והלשוניות, רשימת המקומות, דף מקום עם גלריה, כפתורי הניווט והערת הבטיחות, החיפוש, וכל שלבי הוספת מקום. בעקבות הבדיקה תוקנו כמה דברים: הלשוניות נפתחות רק כשבוחרים בהן; כשנפתח מקום, הקריאה מתחילה בשם שלו; מצב סימון המקום על המפה מוקרא; והודעת שגיאה ישנה כבר לא נשארת אחרי שסומן מקום.</li>
</ul>
<p><strong>מה עוד לא נבדק:</strong> קוראי המסך NVDA, JAWS ו־TalkBack, ו־VoiceOver בטלפון. טופס בקשת ההסרה או התיקון וטופס הפנייה "כתבו לנו" עוד לא נבדקו במקלדת ועם קורא מסך.</p>
<p><strong>מגבלות ידועות:</strong></p>
<ul>
<li>שמות היישובים על המפה הם חלק מתמונת המפה ואינם נקראים בקורא מסך. כל המקומות והפרטים שלהם זמינים ברשימה, עם חיפוש.</li>
<li>סימון ישירות על המפה דורש עכבר או מגע. בטופס אפשר גם לבחור "הזנת נקודה במקלדת" ולהקליד קו רוחב וקו אורך ידועים, או להשתמש ב"המיקום הנוכחי שלי" כשנמצאים במקום. אם אינכם יודעים את הנקודה, אפשר לכתוב לנו ולציין את היישוב, ונעזור להוסיף את המקום.</li>
<li>במחשב, המעבר במקלדת מתחיל בנקודות שעל המפה. הכפתור הראשון בדף, "דילוג לרשימת המקומות", מדלג עליהן.</li>
<li>ב־Safari, המקש Tab עובר רק בין שדות. כדי לעבור גם בין כפתורים וקישורים, לוחצים Option+Tab, או מפעילים זאת בהגדרות של Safari.</li>
<li>הפתיחה היא סרט קצר עם תנועה וצליל לבחירה. אפשר לדלג עליה בכפתור "דילוג" או במקש Escape, והיא לא חוזרת בביקור הבא. כשהמערכת מוגדרת להפחתת תנועה, האנימציות מצטמצמות.</li>
<li>קישורים לאתרים אחרים מובילים לתוכן שאינו בשליטתנו, ונגישותו באחריות האתרים האלה.</li>
</ul>
<p><strong>נתקלתם בבעיה?</strong> לפניות בנושא נגישות: {{OPERATOR}}, בכתובת ${MAIL}. נשיב תוך 7 ימים, ונתקן לכל המאוחר תוך 60 יום. עד אז נעזור לקבל את המידע בדרך אחרת.</p>
<p><strong>בדיקות נוספות ב־13 באוקטובר 2026:</strong> מסלול בחירת נקודה בהקלדה, הודעות שגיאה ומיקוד במקלדת נבדקו אוטומטית ב־Chromium וב־WebKit בנייד, יחד עם סריקת axe. בדיקות אלה אינן בדיקה בטלפון פיזי ואינן אישור עמידה מלאה בתקן.</p>
<p>ההצהרה עודכנה ב־13 באוקטובר 2026.</p>`,
  },
  {
    id: "credits",
    title: "קרדיטים ורישיונות",
    html: `
<ul>
<li><strong>נתוני המפה:</strong> © ${link("https://www.openstreetmap.org/copyright", "OpenStreetMap contributors")}, ברישיון ${link("https://opendatacommons.org/licenses/odbl/", "ODbL")}.</li>
<li><strong>אריחים וסגנון:</strong> האריחים נבנו לאתר מנתוני OpenStreetMap במבנה ${link("https://www.openmaptiles.org/", "© OpenMapTiles")}, בעזרת ${link("https://github.com/onthegomap/planetiler", "Planetiler")}, ומוגשים מהאתר עצמו. הסגנונות, לילה ובוקר, עוצבו במיוחד לאתר.</li>
<li><strong>תבליט הקרקע:</strong> ${link("https://github.com/tilezen/joerd/blob/master/docs/attribution.md", "Mapzen Terrain Tiles")} מ־AWS Open Data, שמורים ומוגשים מהאתר עצמו. הם מבוססים בין השאר על SRTM של NASA ועל נתוני USGS.</li>
<li><strong>נתוני האתרים:</strong> המיקומים אותרו ב־OpenStreetMap וב־${link("https://www.wikidata.org", "Wikidata")} (CC0) ונבדקו ידנית. ליד כל מקום מופיע מקור המיקום שלו.</li>
<li><strong>חלוקה לאזורים:</strong> קבוצות הניווט מבוססות על קואורדינטות המקומות ושכבת הנפות ${link("https://www.geoboundaries.org/api/current/gbOpen/ISR/ADM2/", "geoBoundaries / Wikimedia Commons")} המתארת גבולות מ־2021, ברישיון ${link("https://creativecommons.org/publicdomain/zero/1.0/", "CC0")}. שכבת הגדה המערבית המשלימה היא של ${link("https://www.geoboundaries.org/api/current/gbOpen/PSE/ADM1/", "geoBoundaries / Open Data Watch")}, מ־2021, ברישיון ${link("https://creativecommons.org/licenses/by/4.0/", "CC BY 4.0")}; נבחרה ממנה צורה אחת והקואורדינטות עוגלו. זו חלוקה לצורך עיון ברשימה, ולא הגדרה של אזורי בטיחות או גבולות עדכניים.</li>
<li><strong>גופנים:</strong> {{FONTS}}, ברישיון ${link("https://openfontlicense.org", "SIL Open Font License 1.1")}. הגופנים מאוחסנים באתר עצמו דרך Fontsource. ${link("/licenses/fonts/", "קבצי הרישיון")}.</li>
<li><strong>צילומים:</strong> הצילומים של אתרי ההנצחה, של נופי הנגב המערבי ושל הכותרות בפתיחה מגיעים מ־Wikimedia Commons, ברישיונות חופשיים. הרישיון והצלם של כל קובץ נבדקו מול דף הקובץ עצמו. ליד כל צילום מופיעים שם הצלם, הרישיון וקישור לקובץ המקורי. צילום שהוקטן או נחתך מופץ באותו רישיון כמו המקור.</li>
<li><strong>איורים:</strong> איורי צבעי המים (הכלנית, הניצן, זר הכלניות, שדה הכלניות בזריחה, פינת הזיכרון בעמוד האודות ודם המכבים בכרטיסי השיתוף) נוצרו בבינה מלאכותית, במודלי תמונה של OpenAI, לפי הנחיות שנכתבו לאתר. אף איור באתר אינו מתאר אדם אמיתי או אירוע אמיתי. הכלנית שעל המפה, הסמל והאייקונים צוירו בקוד במיוחד לאתר.</li>
<li><strong>צלילים:</strong> המוזיקה וצלילי הפתיחה (אוויר הלילה, השעון, הנייר והשחר) נוצרו בבינה מלאכותית ב־${link("https://elevenlabs.io", "elevenlabs.io")}, לפי הנחיות שנכתבו לאתר. אין בהם צליל של האירועים עצמם ולא קול של אדם.</li>
<li><strong>טקסטים:</strong> התיאורים נכתבו במקור עבור "מקום לזכור". לא הועתקו טקסטים או תמונות מאתרי יזכור, לעד או ויקיפדיה.</li>
<li><strong>ספריות קוד:</strong> MapLibre GL JS (BSD-3-Clause), React (MIT), shadcn/ui (MIT), Radix UI (MIT), Tailwind CSS (MIT), Motion (MIT), Vaul (MIT), cmdk (MIT), Zustand (MIT), idb-keyval (Apache-2.0), Sonner (MIT), Lucide (ISC). בשרת: Hono (MIT), Zod (MIT), jose (MIT), PMTiles (BSD-3-Clause), ו־resvg-wasm (MPL-2.0, בלי שינויים; ${link("https://github.com/yisibl/resvg-js", "קוד המקור")}).</li>
<li><strong>אין שימוש בסמלים רשמיים:</strong> באתר אין סמל מדינה, סמל צה"ל, סמל יזכור או כל סמל רשמי אחר.</li>
</ul>`,
  },
]

/**
 * The notices the server-stage forms show beside themselves, as the law asks (Privacy Protection Law s.11):
 * who controls the data, whether giving it is required, what it is for, who receives it, and the right to see and correct it.
 * Each key carries its version, and every submission and report stores the key it was shown, so a change in wording
 * gets a new key rather than an edit in place. Retention, processors and the hiding rules follow the design agreed
 * with the architecture session; when one of them changes, the notice changes with it.
 */
const WHO = `<p><strong>מי אחראי על המידע:</strong> {{OPERATOR}}, שמפעיל את האתר באופן פרטי והתנדבותי. ליצירת קשר: ${MAIL}.</p>`
const SEEN_BY = `<p><strong>מי יראה את המידע:</strong> מפעיל האתר ועד שני מאשרים מתנדבים, כל אחד בחשבון אישי. שני ספקים מעבדים את המידע עבורנו:</p><ul><li><strong>Cloudflare:</strong> המידע שבאתר מאוחסן אצלה באיחוד האירופי, אבל מעובד ברשת השרתים העולמית שלה, ולכן גם מחוץ לישראל ולאיחוד. גם בדיקת הבוטים (Turnstile) היא שלה.</li><li><strong>{{MAIL_PROVIDER}}:</strong> שם נשמרים מיילים שתשלחו לנו, בתיבת הדואר של הפרויקט. הם מאוחסנים ב{{MAIL_STORED_IN}}, והספק עשוי לעבד אותם גם במדינות אחרות.</li></ul><p>איננו מוכרים מידע ואיננו מוסרים אותו לאף אחד אחר.</p>`
const RIGHTS = `<p><strong>הזכויות שלכם:</strong> לעיין במידע שלכם ולבקש לתקן אותו. כתבו לנו, ונשיב תוך {{ACCESS_DAYS}}.</p>`
const KEPT = (what: string, from: string) =>
  `<p><strong>כמה זמן:</strong> ${what} נמחקים {{CONTACT_AFTER_CLOSE}} אחרי שהטיפול הסתיים, ולכל המאוחר {{CONTACT_MAX}} אחרי ${from}. מהגיבויים שלנו הם נמחקים תוך {{BACKUP_TAIL}} נוספים. מיילים שהתכתבנו בהם נשמרים בתיבת הדואר לכל היותר {{MAIL_MAX}} מהיום שהתקבלו או נשלחו, ונמחקים קודם כשצריך. אצל ספק הדואר הם נמחקים תוך {{MAIL_TAIL}} נוספים.</p>`

// Phase 1 has no Turnstile yet, so the processors this form names leave it out.
const SEEN_BY_NOW = SEEN_BY.replace(" גם בדיקת הבוטים (Turnstile) היא שלה.", "")

/** What the form says today: sent for review, no email field, the photo stays on the device. */
const SUBMISSION_NOW = `${WHO}
<p><strong>אין חובה למסור את המידע.</strong> בלי פרטי המקום לא נוכל לבדוק את ההצעה ולפרסם אותה. השם שלכם רשות. בגרסה הזו אין שדה למייל, ואין עדיין דף שבו רואים מה קרה עם ההצעה: כדי לברר, לתקן אותה או למשוך אותה, כתבו לנו.</p>
<p><strong>למה:</strong> כדי לבדוק את ההצעה ולפרסם אותה באתר אם תאושר.</p>
<p><strong>מה יתפרסם:</strong> אחרי אישור, סוג המקום, השם, הנקודה על המפה, היישוב, למי הוא מוקדש, הסיפור והקישור. השם שלכם לא יתפרסם.</p>
<p><strong>תמונה:</strong> בגרסה הזו התמונה לא נשלחת. התמונה נשארת במכשיר שלכם, מוקטנת ובלי נתוני המיקום שהמצלמה שומרת בקובץ.</p>
${SEEN_BY_NOW}
<p><strong>מיקום:</strong> אם בחרתם "המיקום הנוכחי שלי", נשמרת רק הנקודה של המקום, בלי השעה ובלי הדיוק של האיתור. הנקודה מתפרסמת במדויק. אם המקום בשטח פרטי, אל תשלחו נקודה מדויקת בלי רשות הבעלים: כתבו לנו, ונציג אותו במיקום משוער.</p>
<p><strong>כמה זמן:</strong> השם שלכם נמחק {{CONTACT_AFTER_CLOSE}} אחרי שהטיפול בהצעה הסתיים, ולכל המאוחר {{CONTACT_MAX}} אחרי השליחה. מהגיבויים שלנו הוא נמחק תוך {{BACKUP_TAIL}} נוספים. מיילים שהתכתבנו בהם נשמרים בתיבת הדואר לכל היותר {{MAIL_MAX}} מהיום שהתקבלו או נשלחו, ונמחקים קודם כשצריך. אצל ספק הדואר הם נמחקים תוך {{MAIL_TAIL}} נוספים.</p>
${RIGHTS}`

// The terms of sending, as version 3 shows them; later versions repeat them word for word.
const SUBMISSION_TERMS = `
<p><strong>תנאי השליחה.</strong> בשליחת ההצעה אני מאשר או מאשרת:</p>
<ul>
<li>אני בן או בת 18 ומעלה, או שהורה או אפוטרופוס הסכים.</li>
<li>הפרטים נכונים למיטב ידיעתי. אם הוספתי פרטים אישיים על מי שהמקום מנציח, אני בן משפחה או שקיבלתי את רשות המשפחה.</li>
<li>אני נותן או נותנת למפעיל האתר רשות, לא בלעדית ובלי תמורה, להציג באתר ובתמונות השיתוף שלו את מה ששלחתי. הזכויות נשארות שלי, ואפשר לבקש להסיר את התוכן בכל עת.</li>
<li>ההצעה תיבדק לפני שתתפרסם, ויכולה להתאשר או להידחות. איש לא ישכתב את מה שכתבתי.</li>
<li>לא כללתי תיאור של נסיבות המוות מעבר למה שהמשפחה בחרה לשתף, פוליטיקה או האשמות, פרטים על אנשים חיים בלי הסכמתם, קישורי תרומה או פרסום, הזדהות עם טרור או הכחשה של הטבח.</li>
</ul>`

// Version 3 with the tracking page: the status and the withdrawal are now in the link, not by email to us.
const SUBMISSION_TRACKED = SUBMISSION_NOW.replace(
  "השם שלכם רשות. בגרסה הזו אין שדה למייל, ואין עדיין דף שבו רואים מה קרה עם ההצעה: כדי לברר, לתקן אותה או למשוך אותה, כתבו לנו.</p>",
  "השם שלכם רשות. בגרסה הזו אין שדה למייל. את מצב ההצעה רואים בקישור המעקב, ושם אפשר גם למשוך אותה. כדי לתקן אותה, כתבו לנו.</p>",
).replace(
  SEEN_BY_NOW,
  `${SEEN_BY_NOW}
<p><strong>קישור המעקב</strong> מוצג לכם אחרי השליחה ונשמר במכשיר שלכם. מי שיש לו את הקישור יכול לראות את מצב ההצעה ולמשוך אותה, ולכן כדאי לא להעביר אותו הלאה. משיכה מוחקת מיד מהשרת את ההצעה ואת השם שלכם; מהגיבויים שלנו הם נמחקים תוך {{BACKUP_TAIL}} נוספים.</p>`,
)

// Version 4 with corrections: a returned or published place is corrected through the tracking link, and a returned one
// that isn't corrected goes after 30 days.
const SUBMISSION_CORRECTABLE = SUBMISSION_TRACKED.replace(
  "את מצב ההצעה רואים בקישור המעקב, ושם אפשר גם למשוך אותה. כדי לתקן אותה, כתבו לנו.",
  "את מצב ההצעה רואים בקישור המעקב, ושם אפשר גם לתקן אותה או למשוך אותה. אם החזרנו אותה אליכם לתיקון עם הערה, שם שולחים אותה מחדש. הצעה שהוחזרה ולא תוקנה תוך 30 יום נמחקת.",
)
const SUBMISSION_TERMS_RETURNS = SUBMISSION_TERMS.replace(
  "ההצעה תיבדק לפני שתתפרסם, ויכולה להתאשר או להידחות.",
  "ההצעה, וכל תיקון שלה, ייבדקו לפני שיתפרסמו, ויכולים להתאשר, להידחות או לחזור אליי לתיקון עם הערה.",
)

// Version 5 with the browser check live: Cloudflare's Turnstile is named among the processors again.
const SUBMISSION_GUARDED = SUBMISSION_CORRECTABLE.replace(SEEN_BY_NOW, SEEN_BY)

// Version 6 with the optional email: verified first, then the tracking link and decisions; kept and erased with the name.
const SUBMISSION_WITH_EMAIL = [
  ["השם שלכם רשות. בגרסה הזו אין שדה למייל.", "השם שלכם והמייל רשות. בלי מייל לא נוכל לעדכן אתכם, ואת מצב ההצעה תראו בקישור המעקב."],
  [
    "<strong>למה:</strong> כדי לבדוק את ההצעה ולפרסם אותה באתר אם תאושר.",
    "<strong>למה:</strong> כדי לבדוק את ההצעה, לפרסם אותה באתר אם תאושר, ולעדכן אתכם אם השארתם מייל. אימות המייל רק מוודא שהכתובת שלכם; הוא לא מאמת קרבה משפחתית או בעלות על תמונה.",
  ],
  ["השם שלכם לא יתפרסם.", "השם שלכם והמייל לא יתפרסמו."],
  ["<strong>כמה זמן:</strong> השם שלכם נמחק", "<strong>כמה זמן:</strong> השם והמייל שלכם נמחקים"],
  ["מהגיבויים שלנו הוא נמחק", "מהגיבויים שלנו הם נמחקים"],
  [
    "<p><strong>קישור המעקב</strong>",
    "<p><strong>מייל:</strong> אם השארתם כתובת, נשלח אליה קודם מייל אימות, בלי פרטים על המקום. רק אחרי שתאשרו אותה באתר נשלח אליה את קישור המעקב, ועדכון כשתתקבל החלטה, כולל הערת המאשרים אם החזרנו את ההצעה לתיקון. קישור האימות בתוקף 7 ימים.</p>\n<p><strong>קישור המעקב</strong>",
  ],
].reduce((text, [from, to]) => {
  if (!text.includes(from)) throw new Error(`notice 2026-10-7: "${from}" not found`)
  return text.replace(from, to)
}, SUBMISSION_GUARDED)

/** Applies exact replacements, and fails loudly if a phrase is missing: a later version is never a silent no-op. */
const amend = (version: string, text: string, changes: [string, string][]) =>
  changes.reduce((t, [from, to]) => {
    if (!t.includes(from)) throw new Error(`notice ${version}: "${from}" not found`)
    return t.replace(from, to)
  }, text)

// Version 7 with the photo sent for review: it is published only with an approved place, and the terms cover it.
const SUBMISSION_WITH_PHOTO = amend("2026-10-8", SUBMISSION_WITH_EMAIL, [
  [
    "<p><strong>תמונה:</strong> בגרסה הזו התמונה לא נשלחת. התמונה נשארת במכשיר שלכם, מוקטנת ובלי נתוני המיקום שהמצלמה שומרת בקובץ.</p>",
    "<p><strong>תמונה:</strong> אם צירפתם תמונה, היא נשלחת לבדיקה יחד עם המקום, מוקטנת ובלי נתוני המיקום ושאר הנתונים שהמצלמה שומרת בקובץ. היא מתפרסמת רק אם המקום אושר, עם התיאור ושם הצלם שכתבתם. תמונה שלא אושרה נמחקת תוך {{REJECTED_PHOTO}}.</p>",
  ],
  ["היישוב, למי הוא מוקדש, הסיפור והקישור.", "היישוב, למי הוא מוקדש, הסיפור, הקישור והתמונה עם התיאור ושם הצלם."],
])
const SUBMISSION_TERMS_PHOTO = amend("2026-10-8", SUBMISSION_TERMS_RETURNS, [
  [
    "<li>ההצעה, וכל תיקון שלה,",
    "<li>את התמונה צילמתי בעצמי, או שקיבלתי רשות לפרסם אותה, ומי שמופיע בה הסכים. אין בה גופה או פצוע.</li>\n<li>ההצעה, וכל תיקון שלה,",
  ],
])

// Version 8 with private property in the form: approximate by default, exact only with the owner's permission.
const SUBMISSION_PRIVATE = amend("2026-10-9", SUBMISSION_WITH_PHOTO, [
  [
    "אם המקום בשטח פרטי, אל תשלחו נקודה מדויקת בלי רשות הבעלים: כתבו לנו, ונציג אותו במיקום משוער.",
    "אם סימנתם שהמקום בשטח פרטי, נציג אותו במיקום משוער, ברמת היישוב, בלי ניווט אליו, ונשמור רק את הנקודה המעוגלת. מיקום מדויק בשטח פרטי יוצג רק אם סימנתם שהבעלים הסכימו, יחד עם מה שכתבתם על הדרך לבקר.",
  ],
])

// Version 9, said once and exactly: the tracking link was named twice in a row, and a withdrawal deletes more than
// the place and the name (worker/db/places.ts withdraw: contacts and the revision's content; the photos too).
const SUBMISSION_EXACT = amend("2026-10-10", SUBMISSION_PRIVATE, [
  [
    "בלי מייל לא נוכל לעדכן אתכם, ואת מצב ההצעה תראו בקישור המעקב. את מצב ההצעה רואים בקישור המעקב, ושם אפשר",
    "בלי מייל לא נוכל לעדכן אתכם. את מצב ההצעה רואים בקישור המעקב, ושם אפשר",
  ],
  ["משיכה מוחקת מיד מהשרת את ההצעה ואת השם שלכם;", "משיכה מוחקת מיד מהשרת את ההצעה, את השם והמייל שלכם ואת התמונה;"],
])

// Version 10 with what a withdrawal does to a photo when the file can't be deleted at once: it leaves the site at once
// (only published photos are served), and the file goes later (worker/routes/submissions.ts withdraw, files: pending).
const SUBMISSION_PHOTO_LATER = amend("2026-10-11", SUBMISSION_EXACT, [
  [
    "משיכה מוחקת מיד מהשרת את ההצעה, את השם והמייל שלכם ואת התמונה;",
    "משיכה מוחקת מיד מהשרת את ההצעה ואת השם והמייל שלכם, ומורידה מיד את התמונה מהאתר; קובץ התמונה נמחק מהאחסון מיד, ואם המחיקה נכשלת, הוא נמחק בהמשך;",
  ],
])

// Version 12 with the retention job built (phase 5): a refused submission goes too, and a published place's refused or
// returned correction goes alone, the place staying as it was published.
const SUBMISSION_ABANDONED = amend("2026-10-12", SUBMISSION_PHOTO_LATER, [
  [
    "הצעה שהוחזרה ולא תוקנה תוך 30 יום נמחקת.",
    "הצעה שהוחזרה אליכם ולא תוקנה תוך {{RETURNED_DAYS}} נמחקת, וגם הצעה שנדחתה נמחקת {{REJECTED_TEXT_DAYS}} אחרי ההחלטה: נשארת רק רשומה ריקה, וקישור המעקב יראה שההצעה נמחקה. אם המקום כבר פורסם, והחזרנו או דחינו תיקון שלו, נמחק רק התיקון, והמקום נשאר כפי שפורסם.",
  ],
])

// Version 13: the tracking link kept on the sender's device and the one sent by email end differently. The emailed
// link's capability is deleted with the address, so it stops then, and after an erasure it no longer opens at all.
const SUBMISSION_EMAIL_LINK = amend("2026-10-13", SUBMISSION_ABANDONED, [
  [
    "נשארת רק רשומה ריקה, וקישור המעקב יראה שההצעה נמחקה.",
    "נשארת רק רשומה ריקה. קישור המעקב שנשמר במכשיר שלכם יראה שההצעה נמחקה, וקישור המעקב שנשלח אליכם במייל כבר לא ייפתח.",
  ],
  [
    "קישור האימות בתוקף 7 ימים.</p>",
    "קישור האימות בתוקף 7 ימים. קישור המעקב שנשלח במייל פועל כל עוד המייל שלכם שמור אצלנו, ומפסיק לעבוד כשהוא נמחק (ראו «כמה זמן»). הקישור שנשמר במכשיר שלכם ממשיך לעבוד, ובכל מקרה אפשר לכתוב לנו.</p>",
  ],
])

// The removal and correction request, as the form first described it.
const REPORT_V1 = `
${WHO}
<p><strong>פרטי הקשר רשות.</strong> גם בלעדיהם נטפל בבקשה, אבל לא נוכל לעדכן אתכם או לשאול שאלות.</p>
<p><strong>למה:</strong> כדי לטפל בבקשה ולתעד מה הוחלט.</p>
<p><strong>מה קורה עם הבקשה:</strong> אדם יבדוק כל בקשה בדחיפות. בקשה של בן משפחה או של בעל הזכויות עשויה להביא להסתרה זמנית של הפרט שציינתם, כאמצעי זהירות, עד שהבדיקה תסתיים. מוסתר רק הפרט שבבקשה, או המקום כולו אם הבקשה עליו.</p>
<p><strong>בדיקה:</strong> נבדוק את הבקשה מול מקורות פומביים, וגם מולכם אם השארתם פרטים. ייתכן שנפנה גם למשפחה או לגוף שהקים את אתר ההנצחה. תוכן שהוסתר יכול לחזור רק אחרי בדיקה מתועדת, ולעולם לא רק בגלל מחלוקת בין בני משפחה.</p>
${SEEN_BY}
${KEPT("פרטי הקשר ונוסח הבקשה", "הבקשה")}
<p>ההחלטה עצמה נשמרת, בלי פרטי קשר.</p>
${RIGHTS}`

const REPORT_V2 = amend("report 2026-10-2", REPORT_V1, [
  [
    "<p><strong>פרטי הקשר רשות.</strong> גם בלעדיהם נטפל בבקשה, אבל לא נוכל לעדכן אתכם או לשאול שאלות.</p>",
    "<p><strong>המייל רשות.</strong> אין בטופס שדה לשם. גם בלי מייל נטפל בבקשה, אבל לא נוכל לעדכן אתכם או לשאול שאלות. לא נבקש תעודה מזהה או מסמכים.</p>",
  ],
  [
    "מוסתר רק הפרט שבבקשה, או המקום כולו אם הבקשה עליו.</p>",
    "מוסתר רק הפרט שבבקשה, או המקום כולו אם הבקשה עליו. בקשה על מקום שהאתר הוסיף בעצמו נבדקת בידי אדם, ושום דבר בו לא מוסתר אוטומטית.</p>\n<p><strong>התראה למאשרים:</strong> על כל בקשה המאשרים מקבלים מייל, ותזכורת עד שמישהו מטפל בה. במייל יש רק קישור לתור ומה נעשה אוטומטית, בלי ההסבר שלכם ובלי פרטי הקשר.</p>\n<p><strong>מניעת שימוש לרעה:</strong> כדי לזהות הצפה של הטופס או שליחה חוזרת של אותה בקשה, נשמרים לזמן קצר שני קודים: אחד שנגזר מכתובת הרשת שלכם, ואחד שנגזר מנוסח ההסבר. אי אפשר לשחזר מהם את הכתובת או את הנוסח, והם נמחקים תוך {{REPORT_ABUSE_HOURS}} מקבלת הבקשה. מהגיבויים שלנו הם נמחקים תוך {{BACKUP_TAIL}} נוספים.</p>",
  ],
])

// Version 2 with what the form keeps in the browser while a request's arrival isn't confirmed (draft, phase 4; the
// privacy session reviews the wording).
const REPORT_V3 = amend("report 2026-10-3", REPORT_V2, [
  [
    "<p><strong>התראה למאשרים:</strong>",
    "<p><strong>בדפדפן שלכם:</strong> רגע לפני השליחה, הבקשה נשמרת בדפדפן הזה כפי שכתבתם אותה, כולל ההסבר והמייל, עד שנדע מה קרה איתה: שהגיעה אלינו, או שלא התקבלה. כך, אם השליחה נקטעת, אפשר לשלוח אותה שוב כאותה בקשה. כשנדע, אנחנו מוחקים אותה מהדפדפן. אם לא, אפשר לשלוח אותה שוב רק עד {{REPORT_OUTBOX_HOURS}} מהשליחה הראשונה, והיא לא נשלחת שוב מעצמה; אחר כך אנחנו מוחקים אותה. אם הדפדפן היה סגור כשהזמן עבר, היא נמחקת בפעם הבאה שהאתר ייפתח בו: כל עוד האתר סגור, אין לנו דרך למחוק אותה. אם הדפדפן לא מאפשר באותו רגע למחוק בקשה שהגיעה אלינו, או שהזמן שלה עבר, הדף הפתוח כבר לא שולח אותה שוב ולא מציג אותה, וממשיך לנסות למחוק אותה כל עוד הוא פתוח. אם הדף נטען מחדש לפני שהמחיקה הצליחה, היא עשויה להופיע בו שוב עד {{REPORT_OUTBOX_HOURS}} מהשליחה הראשונה, ואחר כך נמחקת כמו כל בקשה שהזמן שלה עבר. בקשה שלא התקבלה אצלנו כבר בניסיון הראשון, או שביקשתם להסיר מהדפדפן, ולא הצלחנו למחוק אותה, נשארת בטופס כפי שנשלחה, כדי שתוכלו לשלוח אותה שוב או לנסות שוב להסיר אותה. עד שתימחק, או עד שהזמן שלה יעבור, אי אפשר לשלוח במקומה בקשה חדשה על אותו מקום. אפשר להסיר אותה בכל רגע בכפתור «הסרה מהמכשיר הזה», או במחיקת נתוני האתר בהגדרות הדפדפן. הסרה מהדפדפן לא מבטלת בקשה שכבר הגיעה אלינו: אדם יבדוק אותה כרגיל. עד שהבקשה נמחקת, מי שמשתמש באותו דפדפן יכול לראות אותה, ולכן במחשב משותף כדאי להסיר אותה. אם הדפדפן לא מאפשר לשמור, הבקשה נשמרת רק בדף הפתוח, עד שתרעננו או תסגרו אותו, ולכל היותר {{REPORT_OUTBOX_HOURS}}.</p>\n<p><strong>התראה למאשרים:</strong>",
  ],
])

// Only new consent records use the checked mailbox policy; previous versions stay word for word.
const MAILBOX_POLICY = `מיילים שהתכתבנו בהם מועברים לאשפה אחרי {{MAIL_MAX}} ממועד קבלת כל הודעה. המנגנון מתוזמן מדי שעה, בכפוף לזמינות ולמכסות Google; תשובה חדשה באותו שרשור נבחנת לפי גילה. אפשר לבקש מחיקה מוקדמת. לפי מדיניות Gmail אפשר לשחזר הודעה מהאשפה עד {{MAIL_TAIL}}, ולאחר מכן היא נמחקת מהתיבה. זהו חלון שחזור מתועד של הספק, ולא מדידה שלנו של מחיקה פיזית של עותקים וגיבויים פנימיים. המיזם אינו מרוקן את האשפה אוטומטית; מנגנון השמירה אינו קורא את תוכן ההודעות.`
const withMailboxPolicy = (html: string) =>
  html
    .replaceAll(
      "מיילים שהתכתבנו בהם נשמרים בתיבת הדואר לכל היותר {{MAIL_MAX}} מהיום שהתקבלו או נשלחו, ונמחקים קודם כשצריך. אצל ספק הדואר הם נמחקים תוך {{MAIL_TAIL}} נוספים.",
      MAILBOX_POLICY,
    )
    .replaceAll("הם מאוחסנים ב{{MAIL_STORED_IN}}, והספק עשוי לעבד אותם גם במדינות אחרות.", "הספק מעבד מידע ב{{MAIL_STORED_IN}}.")
const SUBMISSION_BROWSER_RECEIPT = `${SUBMISSION_EMAIL_LINK}${SUBMISSION_TERMS_PHOTO}
<p><strong>שמירה במכשיר בשליחה הזו:</strong> הטופס אינו נשמר בדפדפן לפני אישור שההצעה התקבלה בשרת. אם השליחה נכשלה או סורבה, אין עותק מקומי ואין ניסיון שליחה אוטומטי. אפשר לנסות שוב כל עוד החלון פתוח; בסגירתו הפרטים נמחקים מהטופס. אם התשובה אבדה, ייתכן שההצעה כבר הגיעה לשרת. אחרי אישור קבלה נשמר עותק למעקב; אם נודע דרך המעקב שההצעה נדחתה, העותק יוסר מהמכשיר. כשל בהעלאת תמונה אחרי קבלת ההצעה אינו מבטל את ההצעה; התמונה עשויה להישלח שוב בנפרד.</p>`

export const NOTICES = {
  // Drafted for the full flow (email, tracking link, photo upload) that later phases build; the form no longer shows it.
  "notice.submission@2026-10-1": `
${WHO}
<p><strong>אין חובה למסור את המידע.</strong> בלי פרטי המקום לא נוכל לבדוק את ההצעה ולפרסם אותה. המייל רשות: בלעדיו לא נוכל לעדכן אתכם, ואת מצב ההצעה תראו בקישור המעקב.</p>
<p><strong>למה:</strong> כדי לבדוק את ההצעה, לפרסם אותה באתר אם תאושר, ולחזור אליכם כשצריך. אימות המייל רק מוודא שהכתובת שלכם; הוא לא מאמת קרבה משפחתית או בעלות על תמונה.</p>
<p><strong>מה יתפרסם:</strong> אחרי אישור, פרטי המקום, הסיפור והתמונה. השם שלכם יופיע רק אם בחרתם בזה. המייל לא יתפרסם.</p>
${SEEN_BY}
<p><strong>מיקום:</strong> לפני השליחה תראו את הנקודה שתפורסם. אם בחרתם "המיקום שלי", נשמרת רק הנקודה של המקום, בלי השעה ובלי הדיוק של האיתור. מקום בשטח פרטי מוצג במיקום משוער, בלי ניווט אליו, אלא אם המשפחה ביקשה אחרת.</p>
<p><strong>קישור המעקב</strong> נשמר במכשיר שלכם. מי שיש לו את הקישור יכול לראות את ההצעה, לתקן אותה או למשוך אותה, ולכן כדאי לא להעביר אותו הלאה.</p>
${KEPT("פרטי הקשר", "השליחה")}
<p>תמונה שלא אושרה נמחקת תוך {{REJECTED_PHOTO}}.</p>
${RIGHTS}
<p>את ההצעה עצמה אפשר למשוך בכל עת, בקישור המעקב.</p>`,

  // What the add form offers today: no email field, no tracking page, and the photo stays on the device.
  "notice.submission@2026-10-2": `${SUBMISSION_NOW}`,

  // Version 2 plus the terms of sending: once places are published, the sender's permission to show what they wrote,
  // their age and the content rules have to be agreed to, not only the privacy notice read.
  "notice.submission@2026-10-3": `${SUBMISSION_NOW}${SUBMISSION_TERMS}`,

  // Version 3 for the flow with a tracking page: the sender sees the status and withdraws by the link.
  "notice.submission@2026-10-4": `${SUBMISSION_TRACKED}${SUBMISSION_TERMS}`,

  // Version 4 with corrections and returns through the tracking link.
  "notice.submission@2026-10-5": `${SUBMISSION_CORRECTABLE}${SUBMISSION_TERMS_RETURNS}`,

  // Version 5 with Turnstile running before a place or a correction is sent.
  "notice.submission@2026-10-6": `${SUBMISSION_GUARDED}${SUBMISSION_TERMS_RETURNS}`,

  // Version 6 with the optional email.
  "notice.submission@2026-10-7": `${SUBMISSION_WITH_EMAIL}${SUBMISSION_TERMS_RETURNS}`,

  // Version 7 with the photo sent for review.
  "notice.submission@2026-10-8": `${SUBMISSION_WITH_PHOTO}${SUBMISSION_TERMS_PHOTO}`,

  // Version 8 with private property marked in the form.
  "notice.submission@2026-10-9": `${SUBMISSION_PRIVATE}${SUBMISSION_TERMS_PHOTO}`,

  // Version 9 without the repeated sentence, and with everything a withdrawal deletes.
  "notice.submission@2026-10-10": `${SUBMISSION_EXACT}${SUBMISSION_TERMS_PHOTO}`,

  // Version 10 with a photo file that may be deleted later than the rest.
  "notice.submission@2026-10-11": `${SUBMISSION_PHOTO_LATER}${SUBMISSION_TERMS_PHOTO}`,

  "notice.submission@2026-10-12": `${SUBMISSION_ABANDONED}${SUBMISSION_TERMS_PHOTO}`,
  "notice.submission@2026-10-13": `${SUBMISSION_EMAIL_LINK}${SUBMISSION_TERMS_PHOTO}`,

  // The UX preview stores a tracking copy only after acceptance; previous consent records remain unchanged.
  "notice.submission@2026-10-14": SUBMISSION_BROWSER_RECEIPT,
  "notice.submission@2026-10-15": withMailboxPolicy(SUBMISSION_BROWSER_RECEIPT),

  "notice.report@2026-10-1": `${REPORT_V1}`,

  // Version 1 with what the request form and the server do now (phase 4): email is the only contact field, a request on
  // the site's own places is never hidden automatically, two short-lived codes catch abuse, and the moderators' alert
  // carries none of the request.
  "notice.report@2026-10-2": `${REPORT_V2}`,

  // Version 2 with the request kept in the browser until its arrival is known, for at most 24 hours from the first try.
  "notice.report@2026-10-3": `${REPORT_V3}`,
  "notice.report@2026-10-4": withMailboxPolicy(REPORT_V3),

  "terms.submission@2026-10-1": `
<p>בשליחת ההצעה אני מאשר או מאשרת:</p>
<ul>
<li>אני בן או בת 18 ומעלה, או שהורה או אפוטרופוס הסכים.</li>
<li>הפרטים נכונים למיטב ידיעתי. אם הוספתי פרטים אישיים על מי שהמקום מנציח, אני בן משפחה או שקיבלתי את רשות המשפחה.</li>
<li>את התמונה צילמתי בעצמי, או שקיבלתי רשות לפרסם אותה, ומי שמופיע בה הסכים. אין בה גופה או פצוע.</li>
<li>אני נותן או נותנת למפעיל האתר רשות, לא בלעדית ובלי תמורה, להציג את התוכן באתר ובתמונות השיתוף שלו. הזכויות נשארות שלי, ואפשר לבקש להסיר את התוכן בכל עת.</li>
<li>ההצעה תיבדק לפני שתתפרסם, ויכולה להתאשר, להידחות או לחזור אליי לתיקון. איש לא ישכתב את התוכן שלי.</li>
<li>לא כללתי תיאור של נסיבות המוות מעבר למה שהמשפחה בחרה לשתף, פוליטיקה או האשמות, פרטים על אנשים חיים בלי הסכמתם, קישורי תרומה או פרסום, הזדהות עם טרור או הכחשה של הטבח.</li>
</ul>`,
} as const

export type NoticeKey = keyof typeof NOTICES

/** A notice with every value in place, the way the forms show it. */
export const noticeHtml = (key: NoticeKey) => fillLegal(NOTICES[key])
