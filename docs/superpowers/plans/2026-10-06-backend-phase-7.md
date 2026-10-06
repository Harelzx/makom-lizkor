<div dir="rtl">

# שלב 7: D1 כמקור האמת

> לביצוע: superpowers:executing-plans, בסשן הזה. כל משימה נפתחת בבדיקה אדומה.

**המטרה:** הרשומות ה־curated נשמרות ב־D1 עם מקור ורישוי לכל שדה. `places.json` יוצא מה־bundle של הלקוח ומה־bundle של ה־Worker. הלקוח מקבל את כל המקומות מהפיד, והפתיחה לא מחכה לרשת.

**Spec:** ‏`docs/superpowers/specs/2026-10-05-backend-system-design.md`: עקרונות 1 ו־2, סעיף 3 (`place_sources`, רשומות curated), סעיף 9, טבלת ה־API (‏`POST /api/admin/places`), סעיף 13 (‏`places.json` לא ב־bundle), וסעיף 19 (השלכות על הלקוח).

**מקומית בלבד, נתונים סינתטיים ו־fixtures.** שום דבר לא נפרס. אכלוס D1 של הייצור הוא החלטה של Harel (שאלה 1).

## אילוצים גלובליים

- **הפתיחה לא מחכה לרשת:** שום דבר ב־`intro.tsx`, ב־`celebration.tsx` או ב־`store.ts` לא ממתין ל־API (עיקרון 1).
- **90 הרשומות הן fixtures:** הן נטענות ל־D1 המקומי (dev, e2e ובדיקות ה־Worker), ואסור שיגיעו ל־bundle של הייצור (עיקרון 2, סעיף 13).
- **מיגרציות expand בלבד:** בלי DROP, RENAME, עמודת חובה בלי ברירת מחדל, trigger או אינדקס ייחודי על טבלה קיימת. ‏`scripts/rollback-check.mjs` אוכף.
- **קישור קיים ממשיך לעבוד:** `#/place/<id>` ו־`/place/<id>` של מקום curated נפתחים מיד, כמו היום.

## מוקדי סקירה

1. **ביקור ראשון בלי snapshot, ברשת איטית:** הפתיחה רצה עד הסוף בזמנה. הנפילה מנחיתה פחות אורות, או אף אחד. אין המתנה ואין שגיאה.
2. **קישור ישן `#/place/<curated-id>` לפני שהפיד הגיע:** לא נופל ל־`#/`. הוא מחכה לפיד, ונופל רק כשהפיד חי ואין בו את המקום.
3. **דיווח על מקום curated כשהפיד חי:** לא מסווג כ"במקום אחר" (`pending-reports`).
4. **מקום curated שהוסתר בדיווח:** נעלם מהפיד ומדף השיתוף (410), כמו תרומה. היום אין לו מצב `gone`.
5. **פרסום curated בלי מקורות:** נדחה (סעיף 3). גם עריכה שמסירה את המקור האחרון של שדה.

---

## משימה 1: הסכמה

- **מיגרציה `0017_curated.sql`:**
  - `revisions.curated TEXT`: ‏JSON, ‏NULL בתרומות. מכיל את מה שרק ל־curated יש: `established`, ‏`links[]`, ‏`coord_source`, ‏`coord_source_url`, ‏`region`, ‏`photos[]` (TASL מלא), ‏`revival`.
  - **`place_sources`:**
    - `id`, ‏`place_id` (שמפנה ל־`places`), ‏`revision_id`;
    - `field`, אחד מ־`coords`/`text`/`photo`/`revival`;
    - `source`, אחד מ־`osm`/`wikidata`/`commons`/`survey`/`operator`/`web`/`contributor`;
    - `license`, ‏`url`, ‏`retrieved_at`;
    - אינדקס לפי `place_id`.
- **ב־`src/shared/contract.ts`:**
  - `CuratedFields`: ‏zod strict;
  - `PlaceSource`;
  - `PublicPlace` הופך לאיחוד: תרומה, או curated עם `kind` מורחב (community, shelter, site, museum) ועם `curated`.
- **בדיקות:**
  - המיגרציה עוברת את `rollback-check` מול `HEAD`;
  - ה־schema דוחה שדה לא ידוע;
  - **אינוריאנט:** פרסום curated דורש מקור `coords` ומקור `text`, ומקור `photo` לכל תמונה (מוקד 5).

## משימה 2: ה־fixtures

- **ב־`scripts/build-data.mjs`:** כותב גם `fixtures/curated.json`, מחוץ ל־`src/`. הקובץ כולל את המקומות, את השדות ה־curated ואת המקורות. מקורות הנתונים:
  - **`coord_source` ו־`coord_source_url`:** מקור `coords` (osm עם ODbL, wikidata עם CC0, manual כ־`survey`).
  - **`links[]`:** מקור `text` מסוג `web`, בלי רישיון. התקציר הוא כתיבה של המפעיל: מקור `operator`.
  - **`photos.json`:** מקור `photo` מסוג `commons`, עם הרישיון וה־URL.
  - **`revival.json`:** מקור `revival`, עם `as_of` כ־`retrieved_at`.
  - **`retrieved_at` כשאין תאריך:** תאריך ה־commit של `data-src`. הכלל נרשם בקובץ.
- **`scripts/curated-sql.mjs`:** ממיר את הקובץ ל־SQL אידמפוטנטי (`INSERT OR REPLACE`) עם מזהי ה־slug הקיימים. מוחל ב:
  - `npm run db:seed:local`;
  - ה־fresh state של ה־e2e (`playwright.config.ts`);
  - ה־setup של בדיקות ה־Worker.
- **בדיקות:**
  - ה־SQL שנוצר נטען ל־D1 מקומי ונותן 90 מקומות `published` עם מקורות;
  - ריצה כפולה לא משנה דבר;
  - `places.json` ו־`fixtures/curated.json` מסכימים.

## משימה 3: ה־Worker קורא מ־D1

- **`readFeed` ו־`toPublic`** מחזירים גם curated. תרומה ממשיכה להיראות בדיוק כמו היום.
- **`publicPlace`** מחזיר גם curated. דף השיתוף של מקום curated:
  - מקבל `#place-data`;
  - מחזיר 410 כשהמקום הוסתר (מוקד 4).
- **`reports.targetOf`** קורא מ־D1. ‏`worker/lib/curated.ts` נמחק.
- **הכלניות של curated נספרות בשרת:** יש להן שורת `places`. ‏`shared()` בלקוח משתנה בהתאם.
- **בדיקות:**
  - הפיד מכיל את ה־curated;
  - דף שיתוף curated נותן 200 עם `#place-data`, ואחרי הסתרה 410;
  - דיווח על curated עובד כמו היום;
  - כלנית על curated נספרת;
  - בדיקה שה־bundle של ה־Worker לא מכיל את ה־JSON (משימה 6).

## משימה 4: `POST /api/admin/places` (curated בלבד)

- **מודרטור יוצר או עורך רשומה curated:** revision חדש, ושורות `place_sources`. ‏`expectedRev`, ‏`Idempotency-Key`. תרומה מחזירה 403.
- **כלל המקורות (משימה 1)** נאכף כאן. הפרסום עובר דרך ה־ops וה־ledger הקיימים, כדי שהסתרה, שחזור ו־replay יחולו גם על curated.
- **ממשק עריכה בעמוד הניהול:** לא בשלב הזה (שאלה 4).
- **בדיקות:** יצירה, עריכה עם rev, 403 על תרומה, דחייה בלי מקורות, וחזרה באותו key.

## משימה 5: הלקוח בלי seed

- **`store.ts`:**
  - `seed` יוצא;
  - `allPlaces` הוא `remote ∪ local`;
  - `linkedPlaceId` סומך על כל מזהה תקין עד שהפיד חי (מוקד 2);
  - דף שיתוף נותן את המקום מ־`#place-data`.
- **הפיד בפתיחה:** נטען ברקע מתחילת הפתיחה (dynamic import, בלי `await` בשום מקום בפתיחה), במקום רק ב־`day`. ה־snapshot מ־IndexedDB נטען ראשון. הנפילה קוראת את מה שיש ברגע ה־`fall` (מוקד 1).
- **`OWN_LABELS`:** ‏`map.setFilter` כשהקהילות מגיעות, במקום קבוע מה־JSON.
- **הצרכנים שעוברים לרשימה המלאה:**
  - `journeyStops`, ‏`RevivalStrip` והספירות ב־About;
  - `pending-reports`, כש־`shown` הוא `remote` (מוקד 3);
  - הספירה ב־`intro.tsx`: מוצגת רק כשיש מספר. בלי מספר, הניסוח בלעדיו.
- **בדיקות:**
  - e2e של ביקור ראשון כשהפיד מעוכב ב־route (מוקד 1);
  - קישור `#/place/` ישן לפני הפיד (מוקד 2);
  - דיווח על curated כשהפיד חי (מוקד 3);
  - כל המפרטים הקיימים, עם ה־fixtures ב־D1.

## משימה 6: אין `places.json` ב־bundle

- **`scripts/bundle-check.mjs`:** אחרי build, מחפש ב־`dist/client` וב־`dist/makom_lizkor` מזהים ותקצירים של ה־fixtures. נכשל על כל אחד.
  - רץ ב־`ci.yml` וב־`release.yml`, לפני ה־deploy, ו־`ci-policy` דורש אותו.
  - מוכח אדום על ה־build הנוכחי.
- **`src/data/places.json`** נשאר קובץ פיתוח, או עובר ל־`fixtures/`. ‏`context.json` ו־`landscapes.json` אינם רשומות מקומות, ונשארים (שאלה 3).

## משימה 7: תיעוד

- **CLAUDE.md:** צינור הנתונים, הפתיחה, הניתוב, והפיד שנטען מתחילת הפתיחה.
- **`docs/data-notes.md`:** כלל `retrieved_at`.
- **ה־handoff.**

## שאלות ליועץ

1. **אכלוס הייצור.** ה־spec קורא ל־90 הרשומות fixtures, אבל הן התוכן שהאתר מציג היום.
   - ההצעה: אותו importer (`curated-sql.mjs`) מוכן כצעד שחרור. הבעלים מריץ אותו פעם אחת, אחרי שאישר את התוכן ואת הרישוי (ODbL על קואורדינטות מ־OSM).
   - מקומית בונים הכול. הייצור מחכה ל־Harel.
2. **הפיד בפתיחה:** נטען ברקע מתחילת הפתיחה, ולא רק ב־`day`. זה משנה את הכלל ב־CLAUDE.md, אבל לא את עיקרון 1.
3. **התמונות של curated:** נשארות קבצים סטטיים ב־`public/photos`, עם ה־TASL ב־D1, ולא עוברות ל־R2.
   - **נימוק:** אלה נכסים ברישיון Commons, לא רשומות.
   - **הנימוק לצד השני:** "מקור אמת אחד".
4. **עורך curated בעמוד הניהול:** ה־API בשלב הזה, והממשק אחר כך. האם זה מספיק לשלב?
5. **תמונת שיתוף לכל curated (L4):** לא בשלב הזה. curated נשאר עם `/og.png`.

</div>
