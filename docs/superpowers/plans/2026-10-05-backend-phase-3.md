<div dir="rtl">

# תוכנית מימוש: שלב 3, כלניות ודפי שיתוף

> **לסוכנים שמבצעים את התוכנית:** תת־סקיל חובה: `superpowers:executing-plans` (Native). כל צעד מסומן ב־checkbox (`- [ ]`). הרל לא זמין: החלטות שגרתיות עוברות ליועץ (ראו `CLAUDE.md`, «Delegated adviser»).

**המטרה:** כלנית שמבקר משאיר נספרת פעם אחת ליום לכל מכשיר ומקום, בספירה משותפת לכולם; וקישור שיתוף אמיתי, `/place/<id>`, שנפתח מיד ומציג תצוגה מקדימה עם שם המקום.

**הארכיטקטורה:** בלי שינוי בהחלטות שנקבעו. אותו Worker, אותו D1. ההחלטות של שלב 3 נקבעו ביועץ (`20261005T195531Z-a1310bb9`, verdict `revise`), והתוכנית בנויה עליהן:

1. **ספירה משותפת רק למקומות שפורסמו ב־D1** (תרומות, `p_…`). המקומות המקוריים (`places.json`) מקבלים שורות ב־D1 רק בשלב 7, ועד אז הכלניות שלהם נשארות במכשיר, בניסוח שאומר זאת. ה־foreign key ב־`tribute_events` נשמר.
2. **אין מזהה מכשיר זמני.** אם אין מזהה שנשמר ב־IndexedDB ונקרא בחזרה, לא נשלחת ספירה משותפת: הפרחים נשארים מקומיים. בלי fingerprinting.
3. **nonce חדש מהשרת בכל ניסיון**, ומפתח idempotency קבוע לכל כלנית בדרך. כלנית שנשלחה שוב אחרי חצות לפי ירושלים לא נספרת שוב.
4. **`/place/:id` דרך ה־Worker,** עם `HTMLRewriter`, ו־`replaceState` אל `#/place/<id>` בלקוח: הנתב הקיים נשאר הנתב היחיד. 404 ו־410 הם `no-store` ו־`noindex`, בלי שום תוכן מוסתר.
5. **תמונת השיתוף היא `/og.png` הכללית** (כתובת מוחלטת), עם שם ותיאור לכל מקום. תמונה לכל מקום נשארת עבודה פתוחה לשלב 4 (ה־Workflow ו־Browser Run, ב־staging).

**ה־spec:** `docs/superpowers/specs/2026-10-05-backend-system-design.md`, סעיפים 2.6, 4, 5, 10 ו־19.

## אילוצים גלובליים

כל האילוצים של שלבים 1–2 חלים. בנוסף:

- **הרשת מחוץ ל־`store.ts` ולפתיחה.** הכלנית בממשק נשארת מיידית ומקומית; השליחה נטענת דינמית (`src/lib/tributes.ts`).
- **הסוד של מזהה המכשיר** (`TRIBUTE_SECRET`) נדרש. בלעדיו השרת מחזיר `503 not_configured`, גם בייצור. בתבנית `.dev.vars.example` ערך סינתטי בלבד.
- **המכשיר:** השרת שומר רק `HMAC(TRIBUTE_SECRET, deviceId|day)`. ה־IP לא נשמר בקוד שלנו; זה לא אומר שהספק לא רושם אותו.
- **`tribute_events` נשמרות 8 ימים** (spec 7): המחיקה שייכת ל־cron של שלב 5. עד אז היא תלות פתוחה, לא יכולת קיימת.
- **מטמון הקצה לא מאומת מקומית.** הכותרות נכתבות לפי spec 5; ההתנהגות בקצה נבדקת ב־staging.

## מוקדי סקירה

1. **כלנית שנשלחה פעמיים** (התשובה אבדה, שתי לשוניות, ניסיון חוזר אחרי חצות): נספרת פעם אחת. משימה 1.
2. **מכשיר שלא שומר כלום:** הפרחים מופיעים, שום דבר לא נשלח, והניסוח לא מבטיח ספירה. משימה 2.
3. **שם מקום עם `</script>` או מירכאות** בדף השיתוף: לא שובר את ה־HTML ולא מריץ קוד. משימה 3.
4. **קישור למקום שהוסתר או נמשך:** 410, בלי התוכן, ובלי שה־snapshot האופליין יפתח אותו שוב. משימה 3.
5. **קישורי `#/place/…` ישנים,** רענון ו־Back: עובדים כמו קודם. משימה 3.

---

## מפת המשימות

| #   | משימה             | עיקר                                                                                                               |
| --- | ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | כלניות בשרת       | מיגרציה `0005_tributes`, `POST /api/v1/tributes`, `GET /api/v1/tributes`, יום לפי ירושלים, HMAC, nonce, rate limit |
| 2   | כלניות בלקוח      | מזהה מכשיר עמיד, outbox של כלנית אחת לכל מקום, תוקף 7 ימים, הספירה המשותפת בכרטיס                                  |
| 3   | דפי שיתוף         | `/place/:id` עם `HTMLRewriter`, JSON של המקום, 404/410, נתיב אמיתי בלקוח, כפתור השיתוף                             |
| 4   | סקירה, דוח וסגירה | סוקר רענן על כל השלב, תיקונים, דוח ליועץ, מיזוג מקומי                                                              |

### משימה 1: כלניות בשרת

**קבצים:** `migrations/0005_tributes.sql`, `worker/db/tributes.ts`, `worker/routes/tributes.ts`, `worker/lib/day.ts`, `worker/index.ts`, `wrangler.jsonc` (`TRIBUTE_LIMIT`), `.dev.vars.example` (`TRIBUTE_SECRET`), `src/shared/contract.ts` (`TributeInput`, `TributeResult`, `TributeTotals`), `worker/test/tributes.test.ts`.

**חוזה:**

- `POST /api/v1/tributes` עם `Idempotency-Key` (32 תווי hex) וגוף `{placeId, deviceId}` (`deviceId`: 32 תווי hex).
  - `200 {counted: true}`: הכלנית הזו נספרה עכשיו.
  - `200 {counted: true, reason: "replayed"}`: אותו מפתח כבר נספר. שום דבר לא זז.
  - `200 {counted: false, reason: "already_today"}`: המכשיר כבר השאיר כלנית במקום הזה היום.
  - `200 {counted: false, reason: "not_published"}`: אין מקום שפורסם עם המזהה הזה.
  - `409 idempotency_key_reused`: אותו מפתח, מקום אחר. `400` לקלט פגום. `429` מעל התקרה. `503 not_configured` בלי סוד.
- `GET /api/v1/tributes` → `{totals: {[placeId]: n}}`, רק למקומות שפורסמו עכשיו ושיש להם כלנית. `Cache-Control: no-store`, `Cloudflare-CDN-Cache-Control: max-age=60`.

**בדיקות (נכתבות לפני הקוד):**

- [ ] כלנית ראשונה נספרת; אותו מפתח שוב, גם במקביל, נספר פעם אחת.
- [ ] מפתח אחר, אותו מכשיר, מקום ויום: `already_today`, הסכום לא זז.
- [ ] אותו מכשיר אחרי חצות לפי ירושלים: נספר שוב. אותו מפתח אחרי חצות: לא נספר שוב.
- [ ] היום לפי ירושלים בשעון קיץ ובשעון חורף (21:30 UTC הוא כבר מחר בקיץ, עדיין היום בחורף).
- [ ] מקום `pending`, `withdrawn` או לא קיים: `not_published`, ואין שורה. מקום שהוסתר (נמשך) לא מופיע ב־`GET`.
- [ ] `deviceId` לא נשמר: בטבלה רק HMAC, שונה בין ימים.
- [ ] בלי `TRIBUTE_SECRET`: 503. בייצור בלי סוד: 503.

### משימה 2: כלניות בלקוח

**קבצים:** `src/lib/storage.ts` (`deviceId()`, `changeTributeOutbox()`), `src/lib/tributes.ts` (`queueTribute`, `drainTributes`, `fetchTotals`), `src/lib/api.ts` (`sendTribute`, `getTributeTotals`), `src/store.ts` (`tributeTotals`, `setTributeTotals`; בלי רשת), `src/components/tribute.tsx`, `src/App.tsx` (ההפעלה ביום, לצד הפיד), `e2e/tributes.spec.ts`.

- **מזהה מכשיר:** 16 בתים אקראיים, נשמרים ב־IndexedDB ונקראים בחזרה. כל כשל → `null` → אין שליחה.
- **outbox:** רשומה אחת לכל מקום (`{key, at}`), מפתח אקראי שנשמר עד שמתקבלת תשובה. הקשות נוספות בזמן שיש רשומה לא מוסיפות שליחה. רשומה בת יותר מ־7 ימים נמחקת בלי שליחה. אישור מוחק רק את הרשומה עם אותו מפתח, בטרנזקציה.
- **הכרטיס:** הקשה מוסיפה פרח מקומי תמיד. במקום שפורסם ב־D1 מוצגת גם השורה «השאירו כאן N כלניות». במקום מקורי או מקומי: «נשמר רק במכשיר הזה».

**בדיקות e2e:**

- [ ] הקשה על תרומה שפורסמה: שליחה אחת, הסכום עולה ב־1 גם בדפדפן אחר. עשר הקשות: עשרה פרחים מקומיים, שליחה אחת.
- [ ] התשובה אבדה: השליחה החוזרת באותו מפתח, נספר פעם אחת.
- [ ] IndexedDB חסום: הפרחים מופיעים, אין בקשת `POST /tributes`.
- [ ] מקום מקורי: אין בקשת רשת, והניסוח מקומי.
- [ ] רשומה בת 8 ימים ב־outbox לא נשלחת ונמחקת.

### משימה 3: דפי שיתוף

**קבצים:** `wrangler.jsonc` (`"/place/*"` ב־`run_worker_first`, `assets.binding: "ASSETS"`, `PUBLIC_ORIGIN` ריק בייצור), `worker/routes/share.ts`, `worker/db/places.ts` (`publicPlace(id)` שמשתף את המיפוי עם `readFeed`), `worker/lib/curated.ts` (פיגום זמני: המקומות המקוריים מ־`src/data/places.json`, יוסר בשלב 7), `src/store.ts` (`/place/<id>` → `#/place/<id>` לפני הרינדור הראשון), `src/components/place-detail.tsx` (קישור השיתוף), `src/lib/feed.ts` (מזהים שהוסרו), `scripts/release-check.mjs` (`PUBLIC_ORIGIN`), `worker/test/share.test.ts`, `e2e/share.spec.ts`.

- **מקום שפורסם:** `index.html` דרך `env.ASSETS`, ו־`HTMLRewriter` כותב `<title>`, `og:title`, `og:description`, `og:url`, `og:image` מוחלט, `<link rel="canonical">`, ו־`<script type="application/json" id="place-data">` עם השדות הציבוריים בלבד (`<` מקודד כ־`<`). `Cache-Control: no-cache`, `Cloudflare-CDN-Cache-Control: max-age=60`.
- **לא קיים, ממתין או נדחה** (מעולם לא היה ציבורי): 404. **נמשך או נמחק:** 410. בשניהם `no-store`, `<meta name="robots" content="noindex">`, בלי `place-data` ובלי השם. ב־410 גם `<meta name="place-status" content="gone">`, והלקוח מוחק את המזהה מה־snapshot ולא פותח אותו.
- **המקור המוחלט:** `PUBLIC_ORIGIN` בייצור (ריק עד שיש דומיין, ו־`release:check` חוסם); בפיתוח, המקור של הבקשה, כולל `http`.

**בדיקות:**

- [ ] Worker: תגי og ו־canonical לתרומה ולמקום מקורי; שם עם `</script>`, `"` ו־`<img onerror>` לא שובר את הדף; 404 ו־410 בלי השם, `no-store`, `noindex`; מקום `pending` הוא 404.
- [ ] e2e: `/place/<id>` פותח את הכרטיס בלי הפתיחה, הכתובת הופכת ל־`/#/place/<id>`, ו־Back סוגר; `#/place/<id>` ישן עובד; רענון; כפתור השיתוף נותן `/place/<id>`; קישור 410 לא נפתח גם כשה־snapshot מכיל את המקום.

### משימה 4: סקירה, דוח וסגירה

- [ ] כל הסוויטות על הקוד הסופי: `scripts/heavy npm test`, `scripts/heavy npm run e2e`, `scripts/heavy npm run e2e:prod`, `npm run test:scripts`, typecheck, lint, format.
- [ ] סוקר רענן על כל טווח השלב; תיקון Critical ו־Important עם בדיקה שנכשלה קודם.
- [ ] דוח `--review-report` ליועץ עם הטווח המדויק; מיזוג מקומי (`--no-ff`) רק אחרי `proceed`.
- [ ] `scripts/milestone`, ועדכון `docs/agent-handoff.md`.

## עבודה פתוחה שלא בשלב הזה

- תמונת שיתוף לכל מקום (שלב 4, Workflow ו־Browser Run, ב־staging).
- כלניות למקומות המקוריים (שלב 7, כשיהיו להם שורות ב־D1).
- מחיקת `tribute_events` אחרי 8 ימים (שלב 5).
- `purge` לפי תגים ובדיקת המטמון בקצה (שלבים 4 ו־6, staging).

</div>
