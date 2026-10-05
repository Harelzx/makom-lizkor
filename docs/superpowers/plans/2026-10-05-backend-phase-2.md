<div dir="rtl">

# תוכנית מימוש: שלב 2, הגשות מלאות

> **לסוכנים שמבצעים את התוכנית:** תת־סקיל חובה: `superpowers:executing-plans` (נבחר Native). כל צעד מסומן ב־checkbox (`- [ ]`).

**המטרה:** הגשה שלא הולכת לאיבוד ולא נכפלת, ואחריה הזרימה המלאה מה־spec: קישור מעקב, תיקונים ו־`returned`, Turnstile ו־rate limits, מייל אופציונלי, תמונה, ומיקום משוער בשטח פרטי.

**הארכיטקטורה:** בלי שינוי בהחלטות שנקבעו. אותו Worker, אותו D1, אותן סכמות ב־`src/shared/`. התוכנית מוסיפה מפתח idempotency להגשה (כמו לכלניות ב־spec, סעיף 4), outbox בלקוח, ואת ה־endpoints שה־spec מגדיר בסעיף 10.

**כלים:** כמו בשלב 1. אין תלויות חדשות במשימות 1–2.

**ה־spec:** `docs/superpowers/specs/2026-10-05-backend-system-design.md`. התוכנית המדורגת: `docs/superpowers/plans/2026-10-05-backend-phased-plan.md`.

## אילוצים גלובליים

כל האילוצים של שלב 1 חלים. בנוסף:

- **מקומי בלבד, נתונים סינתטיים.** אין פריסה, אין רכישה ואין יצירת משאב בענן. מה שאפשר לבדוק רק בענן (Turnstile אמיתי, Email Service, Rate Limiting binding, מטמון הקצה) נרשם כבדיקה ל־staging.
- **גרסת ההודעה עוקבת אחרי הזרימה.** כל משימה שמשנה מה הטופס אוסף או מה קורה למידע מוסיפה מפתח חדש ל־`NOTICES` ול־`SUBMISSION_NOTICES`, ולא עורכת טקסט קיים. הבדיקה ב־`worker/test/notice.test.ts` שומרת על ההתאמה.
- **שגיאה שנדחתה לעומת תקלה זמנית:** כל תשובה של השרת שמסווגת בלקוח היא אחת משתיים. `rejected`: 400, 409, 413, 415 ו־422, בלי ניסיון חוזר. `temporary`: אין רשת, timeout, 429 ו־5xx, עם ניסיון חוזר אוטומטי באותו מפתח.
- **אין תוכן אישי בלוגים.** מפתח idempotency, טוקן ומייל לא נכתבים ללוג, ונשמרים במסד רק כ־SHA-256.

## מוקדי סקירה

1. **התשובה הלכה לאיבוד אחרי שהשרת שמר.** ניסיון חוזר עם אותו מפתח מחזיר את אותה הצעה ולא יוצר שנייה. משימה 1 (שרת) ומשימה 2 (e2e).
2. **שני ניסיונות עם אותו מפתח באותו רגע.** שורה אחת, ושניהם מקבלים את אותו `id`. משימה 1.
3. **IndexedDB לא זמין** (גלישה בסתר, מכסה מלאה, חסימה). האתר נפתח, ההגשה נשלחת, והמבקר יודע שלא נשמר עותק במכשיר. משימה 2.
4. **השרת דחה את ההצעה.** המבקר רואה שהיא לא התקבלה, הכפתור לא נתקע, ואין ניסיון חוזר אינסופי. משימה 2.
5. **הדפדפן נסגר באמצע שליחה.** בפתיחה הבאה ההצעה נשלחת שוב, באותו מפתח. משימה 2.

---

## מפת המשימות

| # | משימה | פירוט |
|---|---|---|
| 1 | idempotency בהגשה (שרת) | **מלא, למטה** |
| 2 | התאוששות בלקוח: outbox, דחייה מול תקלה זמנית, אחסון שנכשל | **מלא, למטה** |
| 3 | דף מעקב: סטטוס ומשיכה | בהיקף; מפורט לפני הביצוע |
| 4 | `returned` ותיקונים | בהיקף |
| 5 | Turnstile, rate limits ומפסק זרם על התור | בהיקף |
| 6 | מייל אופציונלי ואימותו | בהיקף |
| 7 | תמונה | בהיקף |
| 8 | מיקום משוער בשטח פרטי, ו־snapshot אופליין | בהיקף |

### מבנה הקבצים (משימות 1–2)

| קובץ | אחריות |
|---|---|
| `migrations/0002_submit_keys.sql` | עמודות המפתח וטביעת הגוף, ואינדקס ייחודי |
| `worker/db/places.ts` (שינוי) | `insertSubmission` מחזיר `created` או `replayed`, או `mismatch` |
| `worker/routes/submissions.ts` (שינוי) | כותרת `Idempotency-Key`, 201 / 200 / 409 |
| `worker/test/idempotency.test.ts` | הבדיקות של משימה 1 |
| `src/lib/api.ts` (שינוי) | `submitPlace(input, key)` מחזיר `SendResult` |
| `src/lib/outbox.ts` | `retryWaiting()`: שולח שוב הצעות שממתינות |
| `src/lib/storage.ts` (שינוי) | אחסון שלא מפיל את האתר כשהוא לא זמין |
| `src/store.ts` (שינוי) | `addLocal` ו־`updateLocal` מחזירים אם נשמר |
| `src/types.ts` (שינוי) | `LocalFields`: `submitKey`, `submission`, `send`, `sendError` |
| `src/components/add-place.tsx`, `place-detail.tsx` (שינוי) | זרימת השמירה, ההודעות והמצב בכרטיס |
| `src/lib/feed.ts` (שינוי) | מפעיל את ה־outbox בכל התעוררות |
| `e2e/submission-recovery.spec.ts` | הבדיקות של משימה 2 |

---

### משימה 1: idempotency בהגשה

**קבצים:**
- ליצור: `migrations/0002_submit_keys.sql`, `worker/test/idempotency.test.ts`
- לשנות: `worker/db/places.ts`, `worker/routes/submissions.ts`, `worker/test/helpers.ts` (כל הגשה בבדיקות שולחת מפתח)

**ממשקים:**
- צורך: `sha256Hex`, `newToken`, `placeId`, `ulid` מ־`worker/lib/ids.ts`.
- מייצר:
  - כותרת `Idempotency-Key`: 22 עד 64 תווים מ־`[A-Za-z0-9_-]`. חובה.
  - `insertSubmission(db, input, key, now): Promise<{ kind: "created" | "replayed"; id: string; trackingToken: string } | { kind: "mismatch" }>`.
  - תשובות: `201 {id, trackingToken}` להגשה חדשה; `200 {id, trackingToken}` לחזרה על אותה הגשה; `409 idempotency_key_reused` לאותו מפתח עם גוף אחר; `400 idempotency_key_required`.
  - **בחזרה, הטוקן מתחלף.** השרת שומר רק גיבוב, ולכן אין לו את הטוקן הראשון להחזיר. הטוקן הראשון לא הגיע לדפדפן, כך שאיש לא מחזיק אותו. מי שמחזיק את המפתח הוא אותו דפדפן שהגיש.

- [ ] **צעד 1: בדיקות שנכשלות**

```ts
// worker/test/idempotency.test.ts
import { env, exports } from "cloudflare:workers"
import { describe, expect, it } from "vitest"
import { CURRENT_SUBMISSION_NOTICE } from "@/shared/contract"

const body = (name: string) => ({ kind: "bench", name_he: name, lat: 31.42, lng: 34.49, consent_version: CURRENT_SUBMISSION_NOTICE })
const key = () => crypto.randomUUID().replaceAll("-", "")
const post = (b: unknown, k?: string) =>
  exports.default.fetch("http://local/api/v1/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(k ? { "Idempotency-Key": k } : {}) },
    body: JSON.stringify(b),
  })
const count = (name: string) => env.DB.prepare("SELECT COUNT(*) AS n FROM revisions WHERE name_he = ?").bind(name).first<number>("n")

describe("a retried submission", () => {
  it("is one place when the first answer never arrived", async () => {
    const k = key()
    const first = await post(body("ספסל דמו אבוד"), k) // the browser never sees this answer
    expect(first.status).toBe(201)
    const again = await post(body("ספסל דמו אבוד"), k)
    expect(again.status).toBe(200)
    const a = await first.json<{ id: string }>()
    const b = await again.json<{ id: string; trackingToken: string }>()
    expect(b.id).toBe(a.id)
    expect(await count("ספסל דמו אבוד")).toBe(1)
    // the token from the retry is the one that works now
    const status = await exports.default.fetch(`http://local/api/v1/submissions/${b.id}`, { headers: { Authorization: `Bearer ${b.trackingToken}` } })
    expect(status.status).toBe(200)
  })
  it("is one place when both tries arrive at once", async () => {
    const k = key()
    const [x, y] = await Promise.all([post(body("ספסל דמו כפול"), k), post(body("ספסל דמו כפול"), k)])
    expect([x.status, y.status].sort()).toEqual([200, 201])
    expect((await x.json<{ id: string }>()).id).toBe((await y.json<{ id: string }>()).id)
    expect(await count("ספסל דמו כפול")).toBe(1)
  })
  it("refuses the same key with different content", async () => {
    const k = key()
    expect((await post(body("ספסל דמו א"), k)).status).toBe(201)
    const other = await post(body("ספסל דמו ב"), k)
    expect(other.status).toBe(409)
    expect(await other.json()).toMatchObject({ code: "idempotency_key_reused" })
    expect(await count("ספסל דמו ב")).toBe(0)
  })
  it("requires a key", async () => {
    const res = await post(body("ספסל דמו בלי מפתח"))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: "idempotency_key_required" })
  })
  it("keeps only the key's hash", async () => {
    const k = key()
    const { id } = await (await post(body("ספסל דמו גיבוב"), k)).json<{ id: string }>()
    const row = await env.DB.prepare("SELECT submit_key_hash FROM places WHERE id = ?").bind(id).first<string>("submit_key_hash")
    expect(row).toMatch(/^[0-9a-f]{64}$/)
    expect(row).not.toContain(k)
  })
})
```

ב־`worker/test/helpers.ts`, ובכל בדיקה ששולחת `POST /api/v1/submissions` ישירות, מוסיפים `"Idempotency-Key": crypto.randomUUID().replaceAll("-", "")` לכותרות.

- [ ] **צעד 2: מריצים ומוודאים שהבדיקות נכשלות**

```bash
scripts/heavy npm test
```

צפוי: FAIL (אין עמודה `submit_key_hash`, והחזרה יוצרת שורה שנייה).

- [ ] **צעד 3: מממשים**

```sql
-- migrations/0002_submit_keys.sql
-- A retried submission is the same submission: the browser sends one key per place, and the key (hashed) is unique.
-- The body's fingerprint tells a retry apart from a different submission that reuses a key.
ALTER TABLE places ADD COLUMN submit_key_hash TEXT;
ALTER TABLE places ADD COLUMN submit_body_hash TEXT;
CREATE UNIQUE INDEX places_submit_key ON places(submit_key_hash) WHERE submit_key_hash IS NOT NULL;
```

ב־`worker/db/places.ts`, `insertSubmission` מקבל את המפתח:
- מחשב `keyHash = sha256Hex(key)` ו־`bodyHash = sha256Hex(JSON.stringify(input))` (הקלט אחרי Zod, כך שאותה בקשה נותנת אותה טביעה).
- מוסיף את שתי העמודות ל־`INSERT INTO places`.
- אם ה־batch נכשל על `UNIQUE constraint failed: places.submit_key_hash`, קורא את השורה הקיימת לפי `keyHash`:
  - אם `submit_body_hash` שונה, מחזיר `{ kind: "mismatch" }`;
  - אחרת מחליף את `tracking_token_hash` בגיבוב של טוקן חדש, ומחזיר `{ kind: "replayed", id, trackingToken }`.
- כל שגיאה אחרת נזרקת הלאה.

```ts
export async function insertSubmission(db: D1Database, input: SubmissionInput, key: string, now: Date) {
  const keyHash = await sha256Hex(key)
  const bodyHash = await sha256Hex(JSON.stringify(input))
  const id = placeId(now.getTime())
  const trackingToken = newToken()
  // …the same statements as before, with submit_key_hash and submit_body_hash in the places INSERT…
  try {
    await db.batch(stmts)
    return { kind: "created" as const, id, trackingToken }
  } catch (err) {
    if (!String(err).includes("places.submit_key_hash")) throw err
  }
  // The key was used before: the same submission sent again (its answer was lost), or a different one reusing it.
  const prior = await db
    .prepare("SELECT id, submit_body_hash AS body FROM places WHERE submit_key_hash = ?")
    .bind(keyHash)
    .first<{ id: string; body: string }>()
  if (!prior || prior.body !== bodyHash) return { kind: "mismatch" as const }
  // Only the hash of the first token exists, so the retry gets a fresh one; the first never reached the browser.
  const fresh = newToken()
  await db.prepare("UPDATE places SET tracking_token_hash = ? WHERE id = ?").bind(await sha256Hex(fresh), prior.id).run()
  return { kind: "replayed" as const, id: prior.id, trackingToken: fresh }
}
```

ב־`worker/routes/submissions.ts`:

```ts
const KEY = /^[A-Za-z0-9_-]{22,64}$/

submissions.post(
  "/",
  zValidator("json", SubmissionInput, (r, c) => (r.success ? undefined : problem(c, 400, "invalid_input"))),
  async (c) => {
    const key = c.req.header("Idempotency-Key") ?? ""
    if (!KEY.test(key)) return problem(c, 400, "idempotency_key_required")
    const r = await insertSubmission(c.env.DB, c.req.valid("json"), key, clock(c.req.raw, c.env))
    if (r.kind === "mismatch") return problem(c, 409, "idempotency_key_reused")
    return c.json({ id: r.id, trackingToken: r.trackingToken }, r.kind === "created" ? 201 : 200, PRIVATE)
  },
)
```

- [ ] **צעד 4: מריצים ומוודאים שהבדיקות עוברות**

```bash
scripts/heavy npm test
```

צפוי: הכל עובר, כולל הבדיקות של שלב 1.

- [ ] **צעד 5: commit**

```bash
git add -A && git commit -m "Make a retried submission the same submission: one key per place, unique by hash"
```

---

### משימה 2: התאוששות בלקוח

**קבצים:**
- ליצור: `src/lib/outbox.ts`, `e2e/submission-recovery.spec.ts`
- לשנות: `src/lib/api.ts`, `src/lib/storage.ts`, `src/store.ts`, `src/types.ts`, `src/lib/feed.ts`, `src/components/add-place.tsx`, `src/components/place-detail.tsx`

**ממשקים:**
- צורך: הכותרת `Idempotency-Key` והתשובות 201/200/409 ממשימה 1.
- מייצר:
  - `type SendResult = { ok: true; id: string; trackingToken: string } | { ok: false; kind: "rejected"; code: string } | { ok: false; kind: "temporary" }`.
  - `submitPlace(input: SubmissionInput, key: string): Promise<SendResult>`.
  - `newSubmitKey(): string` (128 ביט, base64url).
  - ב־`LocalFields`: `submitKey?: string`, `submission?: SubmissionInput` (הגוף המדויק שנשלח, כדי שניסיון חוזר יישלח זהה), `send?: "sending" | "waiting" | "sent" | "rejected"`, `sendError?: string`.
  - בחנות: `addLocal(p): Promise<boolean>` ו־`updateLocal(id, patch: Partial<LocalFields>): Promise<boolean>`. שתיהן מעדכנות את הזיכרון תמיד, ומחזירות `false` כשהשמירה במכשיר נכשלה. הן לא זורקות.
  - `retryWaiting(): Promise<void>`: שולח שוב כל הצעה עם `send` של `waiting`, באותו מפתח ובאותו גוף.

**ההתנהגות:**

| מצב | הודעה (toast) | בכרטיס | ניסיון חוזר |
|---|---|---|---|
| נשלח ונשמר | "ההצעה נשלחה לבדיקה. היא תופיע לכולם אחרי אישור." | "נשלח לבדיקה, ויופיע לכולם אחרי אישור." | — |
| נשלח, לא נשמר במכשיר | "ההצעה נשלחה לבדיקה. לא הצלחנו לשמור עותק במכשיר הזה." | — (אין עותק) | — |
| תקלה זמנית | "לא הצלחנו לשלוח כרגע. ננסה שוב לבד כשהחיבור יחזור." | "ממתין לשליחה. ננסה שוב לבד." | בכל התעוררות (30 שניות, חזרה ללשונית, חיבור שחזר) ובפתיחה הבאה |
| נדחה | "ההצעה לא התקבלה. המקום נשמר במכשיר הזה, ואפשר לכתוב לנו." | "ההצעה לא התקבלה, ולכן לא נשלחה לבדיקה. המקום נשמר רק במכשיר הזה." | אף פעם |

- **הסדר בשמירה:** קודם מוסיפים את העותק המקומי עם `send: "sending"`, `submitKey` ו־`submission`; אחר כך שולחים; אחר כך מעדכנים לפי התוצאה. כך דפדפן שנסגר באמצע שליחה משאיר הצעה שאפשר לשלוח שוב.
- **בפתיחה (`init`):** הצעה במצב `sending` הופכת ל־`waiting`. היא מהביקור הקודם, ושום שליחה לא רצה עכשיו.
- **אחסון שלא זמין:** `storage.ts` יוצר את ה־store בעצלתיים בתוך `try`, כדי ש־`indexedDB.open` שזורק לא יפיל את האתר. `loadLocal` מחזיר `[]`, ו־`saveLocal` זורק, ו־`addLocal` מתרגם את זה ל־`false`.
- **הכפתור:** `sending.current` מתאפס ב־`finally`, בכל מסלול.

- [ ] **צעד 1: בדיקות e2e שנכשלות**

```ts
// e2e/submission-recovery.spec.ts
import { expect, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test"

const DAY = { timeout: 20_000 }
const GEO: BrowserContextOptions = { geolocation: { latitude: 31.42, longitude: 34.49 }, permissions: ["geolocation"] }

async function day(b: Browser, init?: string) {
  const page = await (await b.newContext(GEO)).newPage()
  if (init) await page.addInitScript(init)
  await page.goto("/")
  await page.getByRole("button", { name: "דילוג", exact: true }).click()
  await expect(page.getByRole("button", { name: /^חיפוש מקום/ })).toBeVisible(DAY)
  return page
}

async function fillAndSave(page: Page, name: string) {
  await page.getByRole("button", { name: "הוספת מקום" }).first().click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "המיקום הנוכחי שלי" }).click()
  await dialog.getByRole("button", { name: "המשך" }).click()
  await dialog.getByLabel("שם המקום").fill(name)
  await dialog.getByRole("button", { name: "המשך" }).click()
  for (const box of await dialog.getByRole("checkbox").all()) await box.check()
  await dialog.getByRole("button", { name: "שמירה והנחת כלנית" }).click()
  await expect(dialog).toBeHidden({ timeout: 15_000 })
}

async function queued(b: Browser, name: string) {
  const ctx = await b.newContext()
  await ctx.request.post("/__dev/login", { data: { email: "dev@example.test" } })
  const { items } = (await (await ctx.request.get("/api/admin/queue")).json()) as { items: { name_he: string }[] }
  return items.filter((i) => i.name_he === name).length
}

test("an answer lost after the server saved is retried as the same place, once", async ({ browser }) => {
  const name = `ספסל דמו אבד ${Date.now()}`
  const page = await day(browser)
  const keys: string[] = []
  let first = true
  await page.route("**/api/v1/submissions", async (route) => {
    keys.push(route.request().headers()["idempotency-key"])
    if (!first) return route.continue()
    first = false
    await route.fetch() // the server saves it…
    await route.abort("failed") // …and the answer never arrives
  })
  await fillAndSave(page, name)
  await expect(page.getByText("ננסה שוב לבד", { exact: false }).first()).toBeVisible()
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
  await expect(page.getByText("נשלח לבדיקה, ויופיע לכולם אחרי אישור.")).toBeVisible({ timeout: 10_000 })
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  expect(await queued(browser, name)).toBe(1)
})

test("a submission the server refuses says so, keeps the place, and isn't sent again", async ({ browser }) => {
  const page = await day(browser)
  let posts = 0
  await page.route("**/api/v1/submissions", (route) => {
    posts++
    return route.fulfill({ status: 400, contentType: "application/problem+json", body: JSON.stringify({ status: 400, code: "invalid_input" }) })
  })
  await fillAndSave(page, `ספסל דמו נדחה ${Date.now()}`)
  await expect(page.getByText("ההצעה לא התקבלה", { exact: false }).first()).toBeVisible()
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
  await page.waitForTimeout(1000)
  expect(posts).toBe(1)
  // the form works again: the button isn't stuck
  await page.getByRole("button", { name: "הוספת מקום" }).first().click()
  await expect(page.getByRole("dialog")).toBeVisible()
})

test("when the browser can't store anything, the site opens and the place is still sent", async ({ browser }) => {
  const name = `ספסל דמו בלי אחסון ${Date.now()}`
  const page = await day(browser, "indexedDB.open = () => { throw new DOMException('blocked', 'SecurityError') }")
  await fillAndSave(page, name)
  await expect(page.getByText("לא הצלחנו לשמור עותק במכשיר הזה", { exact: false })).toBeVisible()
  expect(await queued(browser, name)).toBe(1)
})

test("a place whose sending was cut off by closing the tab is sent on the next visit", async ({ browser }) => {
  const name = `ספסל דמו נסגר ${Date.now()}`
  const ctx = await browser.newContext(GEO)
  const page = await ctx.newPage()
  await page.route("**/api/v1/submissions", () => new Promise(() => {})) // never answers
  await page.goto("/")
  await page.getByRole("button", { name: "דילוג", exact: true }).click()
  await expect(page.getByRole("button", { name: /^חיפוש מקום/ })).toBeVisible(DAY)
  await page.getByRole("button", { name: "הוספת מקום" }).first().click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "המיקום הנוכחי שלי" }).click()
  await dialog.getByRole("button", { name: "המשך" }).click()
  await dialog.getByLabel("שם המקום").fill(name)
  await dialog.getByRole("button", { name: "המשך" }).click()
  for (const box of await dialog.getByRole("checkbox").all()) await box.check()
  await dialog.getByRole("button", { name: "שמירה והנחת כלנית" }).click()
  await page.waitForTimeout(500)
  await page.close()
  const next = await ctx.newPage()
  await next.goto("/")
  await expect.poll(() => queued(browser, name), { timeout: 20_000 }).toBe(1)
})
```

- [ ] **צעד 2: מריצים ומוודאים שהבדיקות נכשלות**

```bash
scripts/heavy npx playwright test e2e/submission-recovery.spec.ts
```

צפוי: FAIL. אין ניסיון חוזר, ההודעות לא קיימות, ו־`indexedDB.open` שזורק מפיל את האתר.

- [ ] **צעד 3: מממשים**

```ts
// src/lib/api.ts
import type { SubmissionInput } from "@/shared/contract"

export type SendResult =
  | { ok: true; id: string; trackingToken: string }
  | { ok: false; kind: "rejected"; code: string }
  | { ok: false; kind: "temporary" }

/** One key per place, made before the first try and kept with the place, so every retry is the same submission. */
export function newSubmitKey(): string {
  const b = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

const REJECTED = new Set([400, 409, 413, 415, 422])

/** The server either took the place, refused it (don't send it again), or couldn't be reached (send it again later). */
export async function submitPlace(input: SubmissionInput, key: string): Promise<SendResult> {
  try {
    const res = await fetch("/api/v1/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 201 || res.status === 200) return { ok: true, ...((await res.json()) as { id: string; trackingToken: string }) }
    if (REJECTED.has(res.status)) {
      const code = ((await res.json().catch(() => ({}))) as { code?: string }).code ?? `http_${res.status}`
      return { ok: false, kind: "rejected", code }
    }
    return { ok: false, kind: "temporary" }
  } catch {
    return { ok: false, kind: "temporary" }
  }
}
```

```ts
// src/lib/outbox.ts
import { submitPlace } from "@/lib/api"
import { useStore } from "@/store"

let busy = false

/** Sends again every place still waiting, with the key and body of its first try; refused ones are never resent. */
export async function retryWaiting(): Promise<void> {
  if (busy) return
  busy = true
  try {
    for (const p of useStore.getState().local) {
      const l = p.local
      if (l?.send !== "waiting" || !l.submitKey || !l.submission) continue
      const r = await submitPlace(l.submission, l.submitKey)
      if (r.ok) await useStore.getState().updateLocal(p.id, { send: "sent", remoteId: r.id, trackingToken: r.trackingToken })
      else if (r.kind === "rejected") await useStore.getState().updateLocal(p.id, { send: "rejected", sendError: r.code })
      else break // still unreachable: the next wake tries again
    }
  } finally {
    busy = false
  }
}
```

ב־`src/lib/storage.ts`, ה־store נוצר בעצלתיים:

```ts
let store: UseStore | null | undefined
/** Null when the browser won't give us IndexedDB (a private window, a blocked site): the site works without it. */
function db(): UseStore | null {
  if (store === undefined) {
    try {
      store = createStore("makom-lizkor-v2", "v1")
    } catch {
      store = null
    }
  }
  return store
}
```

`loadLocal` ו־`loadTributes` מחזירים ריק כש־`db()` הוא `null`. `saveLocal` זורק `new Error("storage_unavailable")`. `saveTributes` ממשיך לבלוע.

ב־`src/store.ts`:

```ts
addLocal: async (p) => {
  const local = [...get().local, p]
  set({ local })
  return persist(local)
},
updateLocal: async (id, patch) => {
  const local = get().local.map((p) => (p.id === id && p.local ? { ...p, local: { ...p.local, ...patch } } : p))
  set({ local })
  return persist(local)
},
```

עם `persist` מקומי: `saveLocal(local).then(() => true, () => false)`. ב־`init`, אחרי הטעינה, כל `send === "sending"` הופך ל־`waiting`.

ב־`src/lib/feed.ts`, `onWake` וגם הבדיקה הראשונה מפעילים את `retryWaiting()` אחרי בדיקת הפיד.

ב־`add-place.tsx`, `save()`:
1. בונה את `submission` ואת `submitKey = newSubmitKey()`, ומכניס אותם ל־`place.local` עם `send: "sending"`.
2. `const stored = await addLocal(place)`.
3. `const r = await submitPlace(submission, submitKey)`.
4. מעדכן עם `updateLocal` לפי התוצאה, ובוחר הודעה מהטבלה למעלה, לפי `r` ו־`stored`.
5. כל הגוף בתוך `try`/`finally` שמאפס את `sending.current` ואת `busy`.

ב־`place-detail.tsx`, הכיתוב בכרטיס לפי `local.send` (הטבלה למעלה). מקום ישן בלי `send` ועם `remoteId` נחשב `sent`.

- [ ] **צעד 4: מריצים ומוודאים שהבדיקות עוברות**

```bash
scripts/heavy npx playwright test e2e/submission-recovery.spec.ts e2e/backend-flow.spec.ts
```

צפוי: הכל עובר.

- [ ] **צעד 5: typecheck, lint, format, הסוויטות המלאות, commit**

```bash
npm run typecheck && npm run lint && npm run format && npm run format:check
```
```bash
scripts/heavy npm test
```
```bash
scripts/heavy npm run e2e
```
```bash
git add -A && git commit -m "Recover a submission: retry with the same key, tell a refusal from an outage, survive a browser that can't store"
```

---

## משימות 3–8: היקף

כל אחת מקבלת צעדים מפורטים, באותו סגנון, לפני שמתחילים אותה.

3. **דף מעקב.**
   - נתיב `#/track/<id>`. הטוקן נשמר בעותק המקומי, ומוצג כקישור להעתקה, כשהוא אחרי ה־`#` (spec, סעיף 11).
   - `GET /api/v1/submissions/:id` (קיים) מראה סטטוס; `POST …/withdraw` מושך הצעה ממתינה.
   - גרסת הודעה חדשה, כי עכשיו יש דף מעקב.
4. **`returned` ותיקונים.**
   - מודרטור מחזיר עם הערה; המגיש שולח revision חדש מדף המעקב (`POST …/revisions`).
   - מודרטורים לא עורכים. ה־revision החדש עובר את אותו CAS.
   - המחיקה אחרי 30 יום היא cron של שלב 5.
5. **Turnstile ו־rate limits.**
   - Turnstile עם מפתחות הבדיקה הרשמיים, ואימות בצד השרת של `hostname` ו־`action`.
   - ספירה מדויקת ב־D1 לכל טביעת מכשיר (`device_key`); ה־binding כתקרה גסה.
   - מפסק זרם: מעל סף בתור, `503` עם `Retry-After`. הלקוח מסווג אותו כתקלה זמנית.
   - **ל־staging:** Turnstile אמיתי וה־binding.
6. **מייל אופציונלי.**
   - שדה רשות; adapter בשם `EmailSender`. בפיתוח הוא כותב לטבלת outbox מקומית.
   - האימות לא חוסם הגשה. תוכן פרטי נשלח רק לכתובת מאומתת.
   - **ל־staging:** Email Service.
7. **תמונה.**
   - multipart, 4 MB, בדיקת magic bytes, ו־R2 תחת `quarantine/`. הלקוח כבר מקטין ומוחק EXIF.
   - בפרסום התמונה עוברת ל־`public/`.
8. **שטח פרטי ואופליין.**
   - בחירה בטופס; מיקום משוער ברמת היישוב, בלי ניווט.
   - snapshot אחרון של הפיד לאופליין, שמוחלף בשלמותו (spec, סעיף 5).

**נשאר ב־backlog** (המינורים מהסקירה של שלב 1):
- NFC אחרי הניקוי;
- `res.ok` על `/version`, והגרסה מגוף ה־409;
- JOIN מיותר בגרסה ישנה;
- Content-Type מפורש בניהול;
- הודעת 500 בעמוד הניהול;
- שורות דמו שמצטברות ב־D1 המקומי;
- תיבת האזור ב־`toPlace`;
- טוקן המעקב בקובץ הייצוא.

</div>
