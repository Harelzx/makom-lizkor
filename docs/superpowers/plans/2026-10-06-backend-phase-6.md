<div dir="rtl">

# תוכנית מימוש: שלב 6, תפעול ושחרור (הפריטים המקומיים)

> **לסוכנים שמבצעים את התוכנית:** תת־סקיל `superpowers:executing-plans` (Native). היועץ: ראו `CLAUDE.md`, «Delegated adviser» (workflow 5.1).

**המטרה:** כל מה שאפשר לבנות ולבדוק מקומית לפני staging. כלומר:

- **אבחון בצבירים בלבד:** `/api/ops`, ולוגים בסכמה;
- **כותרות האבטחה ו־CSP במצב Report-Only:** הוכחה מקומית שהמדיניות לא נפגעת באתר;
- **הגדרות הייצור** נבדקות כקוד;
- **קובצי ה־CI, השחרור וה־rollback:** ה־manifest והבדיקות שלהם;
- **כללי deny** לסוכנים;
- **סקריפטים לבדיקות הקצה ולבדיקת העומס.**

**ה־spec:**

| סעיף      | נושא                                       |
| --------- | ------------------------------------------ |
| 10        | `/api/ops`                                 |
| 11        | כותרות, CSP, לוגים                         |
| 12.1–12.3 | הסוכנים, deny, ה־manifest, מרשם הגישה      |
| 13        | שכבת המדיניות, האינוריאנטים, staging, עומס |
| 14.2      | השחרור וה־rollback                         |

**מחוץ לשלב הזה** (החלטות חשבון של הראל, ונשארים ברשימת ההשקה):

- חשבון staging;
- ריפו ב־GitHub ו־GitHub Pro עם environment;
- דומיין;
- Workers Paid;
- הרצה אמיתית של בדיקות הקצה ושל העומס.

שום קובץ workflow לא נדחף ולא מורץ. כל השערים נשארים, כולל `RETENTION.verified=false`.

## תיקוני היועץ (a49, ‏`20261006T181947Z-7dacbf41`)

- **שיעורי שגיאה ב־`/api/ops`:** לא נשמרים ב־D1, אבל גם לא יורדים מהפלט. מגיעים ממקור צבירים שמבוסס על הלוגים:
  - חלון ויחידות מוגדרים;
  - מכנה של בקשות, אם מדווחים אחוז;
  - כשאין טלמטריה, הערך הוא «לא זמין», לא אפס.

  מקומית: מקור סינתטי. החיבור לספק ובדיקת ההרשאות שלו הם עבודת שחרור.

- **P6-LOG-1:**
  - הלוגר בודק ערכים, לא רק שמות שדות. ערך פסול נשמט, ונרשם רק שם השדה (`dropped`). הקלט שנדחה אף פעם לא נכתב.
  - בדיווח CSP אין host: יש קטגוריית מקור מרשימה סגורה, ו־directive מרשימה ידועה.
- **ביקורת חיובית:** אוסף ה־CSP מוכח תחילה כמי שתופס הפרה מכוונת. רק אז אפס הפרות בזרימות הרגילות הוא ראיה.
- **`_headers`:** נבדק ב־runtime של ה־preview עצמו.
- **השחרור:** ה־manifest, ה־CI, ה־checkout וה־deploy קשורים לאותו commit.
- **`release:check`:** עוצר רק נתיבים שמפעילים אותו.
- **rollback:** תואם לסכמה. לא מחזיר נתונים ישנים ולא מבטל הגנות מחיקה.
- **deny:** רק תוספות, וה־hooks נשמרים. ההשפעה על סשנים אחרים נרשמת ב־handoff.
- **מרשם הגישה:** בנוי על ידי סשן הפרטיות (`9e07c29`). כאן רק `check:access` ב־CI, ו־service token של `/api/ops` כהרשאה של הבעלים.

## משימה 1: הגדרות הייצור ככלל נבדק

- **ב־`wrangler.jsonc`:** `workers_dev: false` ו־`preview_urls: false`. ‏`observability.logs.invocation_logs: false` כבר שם. Tracing כבוי.
- **בדיקת Worker שקוראת את `wrangler.jsonc` עצמו** (כמו בדיקת ה־vars הקיימת). היא נכשלת כש:
  - אחד הדגלים חסר או `true`;
  - D1 או bucket בלי `jurisdiction: "eu"` (D1: לפי ההגדרה שקיימת היום, ובלי להמציא שדה שהספק לא מכיר).
- **ב־`release:check`:** אותו כלל, כדי שגם פריסה ידנית תיעצר.

## משימה 2: לוגים בסכמה (spec 11)

- **`worker/lib/log.ts`:** ‏`log(level, event, fields)` עם רשימת שדות מותרת:
  - `event`, `level`, `code`, `part`, `job`, `op`, `place`, `failure`, `count`/`counts`, `error` (שם המחלקה בלבד), `status`, `found`;
  - כל ערך הוא מזהה, קוד או מספר.

  כל `console.*` בקוד ה־Worker עובר אליו.

- **בדיקה סטטית:** אין `console.` מחוץ ל־`log.ts`.
- **בדיקת זמן ריצה לכל ה־suite:** ‏setup של Vitest עוטף את `console`. כל שורה שנכתבה בזמן הבדיקות נבדקת מול הסכמה: JSON, שדות מהרשימה, ובלי מייל, IP, טוקן או גוף בקשה (לפי תבניות). ה־suite נכשל על שורה חריגה. כך הכלל נבדק על כל מסלול שהבדיקות מפעילות, לא רק על דוגמאות.

## משימה 3: `/api/ops` (spec 10, 12.1)

- **הנתיב:** ‏`GET /api/ops/summary`.
- **מי ניגש:** Access service token בלבד. מאמתים את `Cf-Access-Jwt-Assertion` (‏`aud`, ‏`iss`), ומשווים את `common_name` לרשימת מזהי ה־service token מותרים (`OPS_SERVICE_TOKENS`, var). מודרטור לא נכנס דרכו.
- **בפיתוח:** מנפיק ה־JWT של `/__dev` מקבל גם זהות service token.
- **מה מוחזר:** צבירים בלבד:
  - ספירת מקומות לפי מצב;
  - גודל התור ומי שממתין יותר מ־14 יום;
  - בקשות הסרה לפי מצב;
  - פעולות שדורשות תשומת לב (לפי הסוג);
  - הריצה האחרונה של המחיקה (זמן, הצלחה, ספירות), של הייצוא (זמן, הצלחה) ושל התרגיל (זמן, הצלחה, קוד כשל);
  - ממצאי בדיקת המחיקה (קודים וספירות);
  - ההתראות שנשלחו (לפי job, זמן).
- **שיעורי שגיאה לפי קוד:** לא נשמרים במסד. כתיבה לכל תגובת שגיאה הייתה הופכת עומס לכתיבות. מקורם בלוגים המובנים (משימה 2), דרך טוקן ה־Metadata Read-Only. מתועד.
- **סכמת Zod נוקשה לפלט:** מספרים, תאריכי ISO, קודים מרשימה סגורה. ה־snapshot שלה בבדיקה, ושינוי בו מסומן ב־manifest (משימה 5).
- **כותרות:** ‏`private, no-store`.
- **בדיקות:**
  - בלי טוקן: 403;
  - מודרטור: 403;
  - טוקן לא ברשימה: 403;
  - הפלט עומד בסכמה;
  - אין בו אף מחרוזת חופשית: נבדק עם נתוני דמו שיש בהם שמות, מיילים והערות.

## משימה 4: כותרות אבטחה ו־CSP במצב Report-Only (spec 11)

- **`public/_headers`** לנכסים הסטטיים (נתמך ב־build, ב־preview וב־deploy, לפי תיעוד Cloudflare מ־2026-10-06):
  - `Content-Security-Policy-Report-Only`:
    - `'self'`;
    - Turnstile: ‏`challenges.cloudflare.com`, ושני ה־hostnames שה־spec מזכיר, אחרי אימות בתיעוד;
    - אריחי OpenFreeMap ו־AWS;
    - `blob:` ל־worker של MapLibre;
    - `style-src 'unsafe-inline'`;
    - `frame-ancestors 'none'`;
    - `report-uri /api/csp-report`.
  - בנוסף: HSTS, ‏`nosniff`, ‏`Referrer-Policy: strict-origin-when-cross-origin`, ‏`Permissions-Policy` (מיקום: `self` בלבד; השאר כבוי) ו־COOP.
- **אותן כותרות על כל תגובה שה־Worker עצמו מייצר:** middleware אחד. דפי השיתוף מקבלים את אותה מדיניות. המדיה שומרת את ה־`sandbox` שלה.
- **`POST /api/csp-report`:** רושם רק את ה־directive שהופר (מהרשימה הידועה) ואת **סוג** המקור החסום (מהרשימה הסגורה `CSP_SOURCES`), לא את ה־host, לפי a49 וסשן הפרטיות. כתובת הדף, ה־referrer, הקובץ וה־sample נקראים ולא נשמרים. עם rate limit (`CSP_LIMIT`, ‏20 בדקה לכתובת, במפתח מגובב; מעבר לו 429 בלי שורה). מחזיר 204, גם לדיווח פגום.
- **בדיקות:**
  - Worker: כל מסלול מחזיר את הכותרות.
  - e2e על build הייצור (preview): הכותרות על `/`, על נכס ועל `/place/<id>`.
  - **ביקורת חיובית** (`e2e/security-headers.spec.ts`): הפרה מכוונת (תמונה מ־`csp-control.invalid`) מגיעה לאוסף ונענית ב־204, ושורת `csp_report` אחת נרשמת. הבדיקה גם דורשת שזו תהיה ההפרה היחידה בדף. בהרצה הראשונה היא תפסה שני דיווחי `script-src eval` אמיתיים: הבדיקה של zod אם `new Function` זמין. תוקן ב־`z.config({ jitless: true })` ב־`src/shared/contract.ts`.
  - **ריצת e2e מלאה על preview בלי אף הפרת Report-Only.** אוסף את הודעות ה־console ואת הדיווחים שהגיעו ל־`/api/csp-report`. זו הראיה שאפשר יהיה לעבור לאכיפה; המעבר עצמו אחרי staging.

- **הכרעות (בביצוע):**
  - **Turnstile:** רק `challenges.cloudflare.com`, ב־`script-src`, ב־`connect-src` וב־`frame-src`. זה ה־host היחיד שבתיעוד של Cloudflare (דף ה־CSP ו־llms-full, ‏2026-10-06). את "שני ה־hostnames החדשים" שב־spec לא מצאנו שם: טענה לא מאומתת, ולא מנחשים. ה־e2e לא טוען את Turnstile (אין sitekey), ולכן Turnstile תחת המדיניות נבדק רק ב־staging.
  - **`worker-src 'self'`:** בלי `blob:`. ה־worker של MapLibre הוא קובץ module של האתר (`?worker&url`). ריצת ה־preview לא דיווחה דבר.
  - **`X-Frame-Options: DENY`** בנוסף ל־`frame-ancestors 'none'`: `frame-ancestors` לא חוסם במצב Report-Only.
  - **HSTS** בלי `includeSubDomains` ובלי `preload`, עד שהדומיין ידוע.
  - **תגובה עם `Content-Security-Policy` משלה** (ה־sandbox של תמונה) שומרת אותו, ולא מקבלת את מדיניות הדף לצדו. את שאר הכותרות היא מקבלת.
  - **מקור אחד לשני הנושאים:** `worker/lib/security-headers.ts`. `public/_headers` נכתב ממנו (`node scripts/security-headers.mjs`), ובדיקה ב־`test:scripts` נכשלת כשהם שונים.
  - **הראיה לאפס הפרות בריצה מלאה:** שורות `csp_report` בפלט ה־WebServer של ריצת ה־prod. מותרת רק אחת: של הביקורת החיובית (`img-src`, ‏`unknown`). ב־dev ייתכנו דיווחים מ־HMR של Vite. הם לא ממצא, ואין להרחיב בגללם את `connect-src`.

## משימה 5: CI, שחרור, rollback ו־manifest (spec 12.2, 14.2)

קבצים בלבד, לא נדחפים.

- **`.github/workflows/ci.yml`:**
  - static, Worker, client, scripts ו־e2e dev;
  - ריצה על כל push ו־PR;
  - בלי environment ובלי secrets של ייצור.
- **`release.yml`:**
  - מופעל ב־`workflow_dispatch`, עם מזהה השחרור;
  - רץ ב־`environment: production`;
  - הצעדים, לפי סדר 14.2: SHA ב־`main` → CI ירוק → `release:check` → bookmark של Time Travel → מיגרציות → deploy → בדיקות ייצור → הודעה.
- **`rollback.yml`:** ‏`workflow_dispatch` עם מזהה גרסה → `wrangler rollback`.
- **`scripts/release-manifest.mjs`:** ה־diff מהשחרור הקודם, ה־SQL של המיגרציות החדשות, והדגשות סיכון:
  - `worker/db/**`;
  - יעדי `fetch` חדשים;
  - `.github/**`;
  - תלויות ו־`patches/`;
  - snapshot הפלט של `/api/ops`;
  - `.claude/settings*.json`.
- **`scripts/ci-policy.mjs`:** רק `release.yml` ו־`rollback.yml` משתמשים ב־environment ‏`production`, ושום job ב־CI לא קורא secret של ייצור.
- **בדיקות:**
  - node:test ל־manifest על ריפו git זמני עם commits בדויים;
  - node:test ל־policy;
  - פענוח ה־YAML.

## משימה 6: כללי deny לסוכנים (spec 12.2)

- **ב־`.claude/settings.json`:** ‏`permissions.deny` עבור:
  - `gh workflow run release*`/`rollback*` והקריאה הישירה ל־API שלהם;
  - יצירת tags של שחרור;
  - `wrangler deploy` (מחוץ ל־CI);
  - `wrangler tail`;
  - `wrangler login`.
- **הקובץ משותף לכל הסשנים** (ה־hooks שם):
  - **אימות:** JSON תקין;
  - **שימור:** ה־hooks נשארים כמו שהם;
  - **הודעה:** milestone.
- **מעקה ברמת ה־harness, לא אכיפה:** ה־spec אומר זאת במפורש.

## משימה 7: מרשם הגישה (spec 12.3), עם סשן הפרטיות

- `docs/access-registry.json`: אנשים והרשאות לפי סוג.
- **בדיקת CI:** נכשלת על אדם רביעי ועל הרשאה בלי אדם. היא מתואמת עם שער רשימת המודרטורים של סשן הפרטיות (`release-moderators`) כדי לא לשכפל אותו.
- **לפני הבנייה:** שואלים את סשן הפרטיות מי מחזיק את הקובץ.

## משימה 8: בדיקות קצה ועומס (spec 13)

- **`scripts/edge-check.mjs <base-url>`:**
  - הכותרות;
  - `private, no-store` על כל תגובה מאומתת;
  - שתי הרשאות שונות לא מקבלות לעולם `HIT`;
  - מדידת purge עד תוכן טרי;
  - `workers.dev` סגור.

  מקומית רץ על preview, בחלקים שחלים שם. ב־staging רץ במלואו.

- **`tests/load/oct7.js` (k6):**
  - הפרופיל: 50 rps ו־spike של פי 10;
  - ספים: p95 מתחת ל־300ms, cache hit מעל 95% ואפס 5xx.

  מקומית: הרצת עשן קצרה אם k6 מותקן. המספרים עצמם רק ב־staging.

## בדיקות השלב

- בכל משימה הבדיקה הממוקדת שלה, אדומה קודם.
- בנקודת הביקורת:
  - static, ‏Worker, ‏client, ‏scripts;
  - dev ו־prod מלאים, בעותק המנותק;
  - מדידת התזמון.

</div>
