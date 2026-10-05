<div dir="rtl">

# תוכנית מימוש מדורגת: שרת "מקום לזכור"

> **לסוכנים שמבצעים את התוכנית:** תת־סקיל חובה: `superpowers:subagent-driven-development` (מומלץ) או `superpowers:executing-plans`. כל צעד מסומן ב־checkbox (`- [ ]`).

**המטרה:** מימוש מדורג של השרת שתוכנן ב־spec. שלב 1 מספק זרימה מקומית שעובדת מקצה לקצה: מבקר מציע מקום בלי מייל, מודרטור מאשר, המקום מתפרסם, ודפדפן אחר רואה אותו.

**הארכיטקטורה:**
- Worker אחד שכתוב ב־Hono ורץ בתוך `npm run dev` דרך `@cloudflare/vite-plugin`.
- D1 מקומי עם מיגרציות SQL. סכמות Zod משותפות לשרת וללקוח, ב־`src/shared/`.
- הלקוח מושך פיד עם גרסה, וממזג את המקומות המפורסמים לחנות הקיימת.

**כלים וגרסאות:**
- Hono 4.13, `@hono/zod-validator` 0.9, Zod 4, jose 6.
- wrangler 4.147, `@cloudflare/vite-plugin` 1.62.
- Vitest **4.1**: הגרסה האחרונה היא 5, אבל `@cloudflare/vitest-plugin` 1.3 דורש `^4.1.0`.
- Playwright: קיים.

**ה־spec:** `docs/superpowers/specs/2026-10-05-backend-system-design.md`. מי שמבצע קורא את שניהם.

## אילוצים גלובליים

- **Prettier:** בלי נקודה־פסיק, מירכאות כפולות, trailing commas, `printWidth` 140. לפני שמסיימים: `npm run format`, ואחריו `npm run format:check`.
- **פקודות כבדות** (התקנות, `playwright test`, `npm run e2e`/`build`, ו־`vitest`, שמתווסף בשלב 1) רצות רק דרך `scripts/heavy <command>`. אם הוא מחזיר 75, לא מנסים שוב בלולאה.
- **פורטים** של ה־worktree הזה: dev 5402, e2e 5502. הם מגיעים מ־`scripts/parallel/ports.mjs`, ואסור לקבע אותם בקוד.
- **הממשק בעברית** ו־RTL. הבדיקות מוצאות אלמנטים לפי השם הנגיש בעברית. טקסט עברי לא מקבל ריווח אותיות.
- **הפתיחה לא מחכה לרשת:** אסור לייבא קוד רשת ל־`intro.tsx`, `celebration.tsx` או `store.ts`. סנכרון הפיד נטען דינמית מ־`App.tsx` כשהפאזה היא `day`.
- **הערות בקוד** מסבירות *למה*, בפרוזה, בקול הקוד הקיים.
- **שעון השרת:** השרת קורא זמן רק דרך `clock()` (`worker/lib/clock.ts`).
- **תגובות מאומתות** (ממשק הניהול וקישור המעקב) מקבלות תמיד `Cache-Control: private, no-store`.
- **לוגים:** שורות JSON משלנו בלבד. אף פעם לא גוף בקשה, IP, טוקן, מייל או User-Agent.
- **נתונים סינתטיים בלבד.** שמות בדיקה מסומנים «דמו», כתובות ב־`example.test`.
- **אין פריסה ציבורית.** התוכנית לא יוצרת חשבון ייצור ולא פורסת לשם.

## מוקדי סקירה

אלה חמישה מצבים שה־spec מרמז עליהם ושעלולים לפגוע במשתמש. לכל אחד מהם בדיקה במשימה שאחראית עליו:

1. **שם עם תווי בקרה של כיווניות או עם LRM.** התווים המסוכנים מוסרים, LRM ו־RLM נשמרים. נבדק במשימה 2.
2. **שני מודרטורים מאשרים או דוחים את אותה הצעה בו־זמנית.** אחד מצליח, השני מקבל `409`, ואין פרסום כפול. נבדק במשימה 4.
3. **מי שהציע מקום רואה אותו פעמיים** אחרי האישור: העותק המקומי והעותק המפורסם. העותק המקומי מוסתר כשהעותק המרוחק קיים. נבדק במשימה 6.
4. **ה־API למטה.** האתר נפתח, הפתיחה מסתיימת, ואין הודעות שגיאה למבקר. נבדק במשימה 7.
5. **קישור משותף למקום `p_…` שנפתח לפני שהפיד הגיע.** הוא לא נופל לתצוגה הכללית, והמקום נפתח כשהפיד מגיע. נבדק במשימה 6.

---

## מפת השלבים

| שלב | מה הוא מספק | תלוי ב־ |
|---|---|---|
| **1. הזרימה המקומית** (מפורט כאן) | הגשה בלי מייל, מודרציה, פרסום, דפדפן אחר רואה | — |
| 2. הגשות מלאות | Turnstile, rate limits, העלאת תמונה וקידוד מחדש, קישור מעקב, תיקונים, `returned`, מייל אופציונלי ואימותו, snapshot אופליין, מפסק זרם על התור, מיקום משוער במקום פרטי | 1 |
| 3. כלניות ודפי שיתוף | `tribute_*` ו־batch, outbox, `/place/:id` עם HTMLRewriter, תמונות OG, נתיבים אמיתיים | 1 |
| 4. דיווחים, הסרות ו־ledger | `reports`, הפרדיקט, `field_suppressions`, התראות דחופות, קודי שחזור, Workflow האישור עם intent ו־commit ב־R2, Workers Cache ו־purge לפי תגים | 2, 3 |
| 5. שמירה, גיבוי ושחזור | cron למחיקה, ייצוא מוצפן עם manifest, גיבוי תמונות, בדיקות מחיקה, תרגילים, מסלולי A ו־B, בדיקה ב־staging עם זמן מכווץ שמתנה את `RETENTION.verified` | 4 |
| 6. תפעול ושחרור | `/api/ops` ובדיקת סכמת לוגים, חשבון staging, ריפו ב־GitHub, CI, `release.yml` עם `release:check`, `rollback.yml`, כללי deny לסוכנים, כותרות ו־CSP במצב Report-Only, בדיקות קצה אמיתי, עומס | 1–5 |
| 7. D1 כמקור האמת | רשומות curated עם provenance, הוצאת `places.json` מה־bundle של הייצור, אכלוס אסינכרוני | 6 |

**כל שלב מ־2 והלאה מקבל תוכנית מפורטת משלו**, לפי אותו סקיל, לפני שמתחילים לבצע אותו. הטבלה הזו מגדירה היקף, לא צעדים.

## משימות פיתוח לעומת חוסמי השקה

**משימות פיתוח (השלבים):** אפשר לבצע אותן עכשיו, על נתונים סינתטיים, בלי דומיין, בלי תיבת מייל ובלי נוסח משפטי סופי.

**חוסמי השקה ציבורית** (לא חוסמים פיתוח):

1. **פרטים שעדיין חסרים:**
   - דומיין;
   - ספק לתיבת המייל, וההגדרה שלו נמדדת (`MAIL_DELETION_TAIL`);
   - זהות המפעיל.
2. **`release:check` עובר:**
   - אין placeholders;
   - `RETENTION.verified`, אחרי הבדיקה של שלב 5;
   - הוחלט על מסלול A.
3. **הנוסח המשפטי:** ההודעות ו־`database-definitions.md` מאושרים, ועורך דין בדק.
4. **בדיקות ידניות:** צ'קליסט נגישות, ובדיקה עם קורא מסך אמיתי.
5. **הגדרות חשבון:** מרשם גישה, MFA בכל החשבונות, GitHub Pro ו־environment, ו־"Help improve Claude" כבוי.
6. **ראיות מסביבת ההרצה:**
   - התרגילים ובדיקות המחיקה עברו בייצור;
   - CSP עבר לאכיפה;
   - עומס ובדיקות קצה עברו ב־staging.

---

## שלב 1: הזרימה המקומית

### מבנה הקבצים

| קובץ | אחריות |
|---|---|
| `wrangler.jsonc` | הגדרת ה־Worker לפיתוח: assets, D1 ו־vars של פיתוח |
| `vite.config.ts` (שינוי) | `cloudflare()` ו־`input` לשני עמודים |
| `vitest.config.ts`, `tsconfig.worker.json` | בדיקות ב־workerd, וטיפוסים ל־Worker |
| `migrations/0001_places.sql` | `places`, `revisions`, `contacts`, `feed_state`, `audit_log` |
| `src/shared/text.ts` | ניקוי טקסט עברי |
| `src/shared/contract.ts` | סכמות Zod משותפות וגרסת הפיד |
| `worker/index.ts` | הרכבת האפליקציה וטיפול בשגיאות |
| `worker/lib/{clock,ids,http,access}.ts` | זמן, מזהים וטוקנים, תשובות שגיאה, אימות מודרטור |
| `worker/db/places.ts` | שאילתות ומעברי מצב |
| `worker/routes/{submissions,feed,admin,dev}.ts` | נקודות הקצה |
| `worker/test/*` | בדיקות אינטגרציה |
| `src/lib/api.ts`, `src/lib/feed.ts` | קריאות מהלקוח וסנכרון הפיד |
| `src/store.ts`, `src/types.ts`, `src/App.tsx`, `src/components/add-place.tsx`, וכל מי שקורא ל־`allPlaces` | שילוב בלקוח |
| `admin/index.html`, `src/admin/{main,queue}.tsx` | עמוד הניהול המינימלי |
| `e2e/backend-flow.spec.ts`, `playwright.config.ts` (שינוי) | בדיקת הזרימה |

### משימה 1: Worker בתוך שרת הפיתוח

**קבצים:**
- ליצור: `wrangler.jsonc`, `worker/index.ts`, `vitest.config.ts`, `tsconfig.worker.json`, `worker/test/health.test.ts`, `worker/test/apply-migrations.ts`, `migrations/.gitkeep`
- לשנות: `vite.config.ts`, `tsconfig.json`, `package.json`, `.claude/heavy-commands.txt`, `.gitignore`

**ממשקים:**
- מייצר: `export default app` (Hono). הטיפוס `Env` נוצר על ידי `npx wrangler types` לתוך `worker-configuration.d.ts`.

- [ ] **צעד 1: התקנת תלויות**

```bash
scripts/heavy npm install hono@^4.13 @hono/zod-validator@^0.9 zod@^4 jose@^6
```
```bash
scripts/heavy npm install -D wrangler@^4.147 @cloudflare/vite-plugin@^1.62 vitest@^4.1 @cloudflare/vitest-plugin@^1.3 fast-check@^4
```

- [ ] **צעד 2: `wrangler.jsonc`**

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "makom-lizkor",
  "main": "./worker/index.ts",
  "compatibility_date": "2026-10-05",
  // The SPA is served as static assets; only these paths run the Worker.
  "assets": { "not_found_handling": "single-page-application", "run_worker_first": ["/api/*", "/__dev/*"] },
  "d1_databases": [
    { "binding": "DB", "database_name": "makom-dev", "database_id": "00000000-0000-0000-0000-000000000000", "migrations_dir": "migrations" },
  ],
  // Development values only. The production config (phase 6) sets ENVIRONMENT=production and has no DEV_ACCESS_SECRET.
  "vars": {
    "ENVIRONMENT": "development",
    "EPOCH": "0",
    "MODERATORS": "dev@example.test",
    "DEV_ACCESS_SECRET": "development-only-not-a-secret",
    "ACCESS_TEAM_DOMAIN": "",
    "ACCESS_AUD": "",
  },
  "observability": { "logs": { "invocation_logs": false } },
}
```

- [ ] **צעד 3: `worker/index.ts` מינימלי ובדיקת health שנכשלת**

```ts
// worker/test/health.test.ts
import { SELF } from "cloudflare:test"
import { expect, it } from "vitest"

it("answers health checks", async () => {
  const res = await SELF.fetch("http://local/api/v1/health")
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
})
```

```ts
// worker/test/apply-migrations.ts
import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
```

```ts
// vitest.config.ts
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin"
import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

const migrations = await readD1Migrations(resolve(import.meta.dirname, "migrations"))

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" }, miniflare: { bindings: { TEST_MIGRATIONS: migrations } } })],
  resolve: { alias: [{ find: "@", replacement: resolve(import.meta.dirname, "./src") }] },
  test: { include: ["worker/test/**/*.test.ts"], setupFiles: ["./worker/test/apply-migrations.ts"] },
})
```

```json
// tsconfig.worker.json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.worker.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "types": ["@cloudflare/vitest-plugin/types"],
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["worker", "src/shared", "worker-configuration.d.ts", "vitest.config.ts"]
}
```

ב־`tsconfig.json` מוסיפים `{ "path": "./tsconfig.worker.json" }` ל־`references`.

ב־`package.json` מוסיפים:
- `"test": "vitest run"`
- `"cf-typegen": "wrangler types"`
- `"db:migrate:local": "wrangler d1 migrations apply makom-dev --local"`

ב־`.claude/heavy-commands.txt` מוסיפים את השורה:

```
^(npx\s+)?vitest(\s|$)|^npm\s+(run\s+)?test(\s|$)
```

ב־`.gitignore` מוסיפים `.wrangler/`.

הבדיקה צריכה גם את `env.TEST_MIGRATIONS` בטיפוס. מוסיפים את הקובץ `worker/test/env.d.ts`:

```ts
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[]
  }
}
```

- [ ] **צעד 4: מריצים ומוודאים שהבדיקה נכשלת**

הרצה:
```bash
npx wrangler types
```
```bash
scripts/heavy npm test
```

צפוי: FAIL (אין handler, או 404).

- [ ] **צעד 5: מממשים**

```ts
// worker/index.ts
import { Hono } from "hono"

const app = new Hono<{ Bindings: Env }>()

app.get("/api/v1/health", (c) => c.json({ ok: true }))

export default app
```

ב־`vite.config.ts` מוסיפים את ה־import `import { cloudflare } from "@cloudflare/vite-plugin"`. משנים את ה־plugins ל־`plugins: [react(), tailwindcss(), cloudflare()]`. השורה `worker: { format: "es" }` של MapLibre נשארת.

- [ ] **צעד 6: מריצים ומוודאים שהבדיקה עוברת. אחר כך מוודאים שהשרת עונה**

```bash
scripts/heavy npm test
```

צפוי: PASS.

כדי לבדוק את שרת הפיתוח מקימים אותו דרך כלי ה־preview, על פורט ה־dev של ה־worktree. אחר כך:

```bash
curl -s localhost:5402/api/v1/health
```

צפוי: `{"ok":true}`, ובנוסף `/` עדיין מגיש את האתר.

- [ ] **צעד 7: typecheck, lint, format, commit**

```bash
npm run typecheck && npm run lint && npm run format && npm run format:check
git add -A && git commit -m "Run a Hono Worker inside the dev server, with tests in workerd"
```

### משימה 2: סכמה, טקסט, מזהים וזמן

**קבצים:**
- ליצור:
  - `migrations/0001_places.sql`
  - `src/shared/text.ts`, `src/shared/contract.ts`
  - `worker/lib/clock.ts`, `worker/lib/ids.ts`
  - `worker/test/schema.test.ts`, `worker/test/text.test.ts`, `worker/test/ids.test.ts`

**ממשקים:**
- `cleanText(input: string, opts?: { multiline?: boolean }): string | null`. מחזיר `null` כשהטקסט מכיל תו בקרה אסור.
- `text({ max, multiline? })`: סכמת Zod.
- `SUBMITTABLE_KINDS`.
- `SubmissionInput`, `PublicPlace` ו־`Feed` (סכמות וטיפוסים).
- `parseVersion(v): { epoch: number; n: number } | null` ו־`isNewer(a, b): boolean`.
- `clock(req: Request, env: Env): Date`.
- `ulid(ms?)`, `placeId()`, `newToken()`, `sha256Hex(s)`, `sameHash(a, b)`.

- [ ] **צעד 1: בדיקות שנכשלות**

```ts
// worker/test/text.test.ts
import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { cleanText } from "@/shared/text"

describe("cleanText", () => {
  it("removes bidi overrides but keeps the marks Hebrew needs", () => {
    expect(cleanText("ספסל‮של‬ נועה")).toBe("ספסלשל נועה")
    expect(cleanText("קיבוץ 3‏")).toBe("קיבוץ 3‏")
  })
  it("rejects control characters and folds whitespace on one line", () => {
    expect(cleanText("a\u0007b")).toBeNull()
    expect(cleanText("  שורה\nשנייה ")).toBe("שורה שנייה")
    expect(cleanText("שורה\r\nשנייה", { multiline: true })).toBe("שורה\nשנייה")
  })
  it("never lets a bidi control through, and is idempotent", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (s) => {
        const once = cleanText(s)
        if (once === null) return true
        return !/[‪-‮⁦-⁩]/.test(once) && cleanText(once) === once
      }),
    )
  })
})
```

```ts
// worker/test/schema.test.ts
import { env } from "cloudflare:workers"
import { expect, it } from "vitest"
import { SUBMITTABLE_KINDS } from "@/shared/contract"
import { ADDABLE_KINDS } from "@/data/taxonomy"

it("refuses a status outside the state machine", async () => {
  await expect(
    env.DB.prepare("INSERT INTO places (id, origin, status, rev, created_at, status_changed_at) VALUES ('p_x','contribution','live',1,'t','t')").run(),
  ).rejects.toThrow(/CHECK/)
})

it("keeps a private-property place approximate unless permission is recorded", async () => {
  await env.DB.prepare("INSERT INTO places (id, origin, status, rev, created_at, status_changed_at) VALUES ('p_y','contribution','pending',1,'t','t')").run()
  await expect(
    env.DB.prepare(
      "INSERT INTO revisions (id, place_id, n, state, kind, name_he, lat, lng, location_precision, on_private_property, consent_version, created_at) VALUES ('r_y','p_y',1,'pending','bench','דמו',31.4,34.5,'exact',1,'v','t')",
    ).run(),
  ).rejects.toThrow(/CHECK/)
})

it("starts the feed at version zero", async () => {
  expect(await env.DB.prepare("SELECT n FROM feed_state WHERE id = 1").first("n")).toBe(0)
})

it("accepts exactly the kinds the form offers", () => {
  expect([...SUBMITTABLE_KINDS].sort()).toEqual([...ADDABLE_KINDS].sort())
})
```

```ts
// worker/test/ids.test.ts
import { expect, it } from "vitest"
import { placeId, sameHash, sha256Hex, ulid } from "../lib/ids"
import { isNewer } from "@/shared/contract"

it("makes time-sortable ids", () => {
  expect(ulid(1000) < ulid(2000)).toBe(true)
  expect(placeId()).toMatch(/^p_[0-9A-HJKMNP-TV-Z]{26}$/)
})
it("compares token hashes", async () => {
  const h = await sha256Hex("abc")
  expect(await sameHash(h, await sha256Hex("abc"))).toBe(true)
  expect(await sameHash(h, await sha256Hex("abd"))).toBe(false)
})
it("orders feed versions by epoch first", () => {
  expect(isNewer("0.3", "0.2")).toBe(true)
  expect(isNewer("1.0", "0.9")).toBe(true)
  expect(isNewer("0.2", "0.2")).toBe(false)
})
```

- [ ] **צעד 2: מריצים ומוודאים שהבדיקות נכשלות**

```bash
scripts/heavy npm test
```

צפוי: FAIL (מודולים חסרים, אין טבלאות).

- [ ] **צעד 3: מממשים**

```sql
-- migrations/0001_places.sql
CREATE TABLE places (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL CHECK (origin IN ('curated', 'contribution')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'returned', 'published', 'hidden', 'rejected', 'withdrawn', 'erased')),
  rev INTEGER NOT NULL,
  published_revision_id TEXT,
  tracking_token_hash TEXT,
  last_transition_id TEXT,
  created_at TEXT NOT NULL,
  status_changed_at TEXT NOT NULL
);

CREATE TABLE revisions (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id),
  n INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'returned', 'approved', 'rejected', 'superseded', 'withdrawn')),
  kind TEXT,
  name_he TEXT,
  lat REAL,
  lng REAL,
  location_precision TEXT CHECK (location_precision IN ('exact', 'approximate')),
  on_private_property INTEGER NOT NULL DEFAULT 0,
  location_permission_at TEXT,
  access_note_he TEXT,
  place_he TEXT,
  in_memory_of TEXT,
  story_he TEXT,
  link_url TEXT,
  consent_version TEXT,
  decision_note TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  CHECK (NOT on_private_property OR location_precision = 'approximate'
         OR (location_permission_at IS NOT NULL AND access_note_he IS NOT NULL))
);
CREATE INDEX revisions_by_place ON revisions(place_id, n);

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  place_id TEXT REFERENCES places(id),
  report_id TEXT,
  name TEXT,
  email TEXT,
  email_verified_at TEXT,
  consent_version TEXT,
  created_at TEXT NOT NULL,
  ceiling_at TEXT NOT NULL,
  purge_after TEXT NOT NULL,
  CHECK ((place_id IS NULL) <> (report_id IS NULL)),
  CHECK (purge_after <= ceiling_at)
);

CREATE TABLE feed_state (id INTEGER PRIMARY KEY CHECK (id = 1), n INTEGER NOT NULL, changed_at TEXT NOT NULL);
INSERT INTO feed_state (id, n, changed_at) VALUES (1, 0, '1970-01-01T00:00:00.000Z');

-- What happened, never what was written: field names only, so erasing content never needs to scrub this table.
CREATE TABLE audit_log (id TEXT PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, entity_id TEXT NOT NULL, fields TEXT);
```

```ts
// src/shared/text.ts
// Invisible characters that can show text in a different order from the one stored ("Trojan Source").
// LRM and RLM (U+200E/F) stay: Hebrew mixed with numbers and English needs them.
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/g
const ZERO_WIDTH = /[​⁠﻿]/g
const FORBIDDEN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/

/** Normalized text, or null when it carries a control character we refuse to store. */
export function cleanText(input: string, opts: { multiline?: boolean } = {}): string | null {
  let s = input.normalize("NFC").replace(BIDI_CONTROLS, "").replace(ZERO_WIDTH, "").replace(/\r\n?/g, "\n")
  s = opts.multiline ? s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() : s.replace(/\s+/g, " ").trim()
  return FORBIDDEN.test(s) ? null : s
}
```

```ts
// src/shared/contract.ts
import { z } from "zod"
import { cleanText } from "./text"

/** Must match ADDABLE_KINDS in src/data/taxonomy.ts; a test keeps them equal. Communities are out of scope. */
export const SUBMITTABLE_KINDS = ["bench", "lookout", "grove", "garden", "plaque", "monument", "other"] as const

export const text = ({ max, multiline = false }: { max: number; multiline?: boolean }) =>
  z
    .string()
    .transform((s, ctx) => {
      const clean = cleanText(s, { multiline })
      if (clean === null) ctx.addIssue({ code: "custom", message: "control_character" })
      return clean ?? ""
    })
    .pipe(z.string().min(1).max(max))

export const SubmissionInput = z
  .object({
    kind: z.enum(SUBMITTABLE_KINDS),
    name_he: text({ max: 80 }),
    lat: z.number().min(29.4).max(33.45),
    lng: z.number().min(34.2).max(35.95),
    place_he: text({ max: 80 }).optional(),
    in_memory_of: text({ max: 120 }).optional(),
    story_he: text({ max: 2000, multiline: true }).optional(),
    link_url: z.url({ protocol: /^https$/ }).max(300).optional(),
    submitter_name: text({ max: 80 }).optional(),
    on_private_property: z.boolean().default(false),
    consent_version: z.string().min(1).max(64),
  })
  .strict()
export type SubmissionInput = z.infer<typeof SubmissionInput>

export const PublicPlace = z.object({
  id: z.string(),
  kind: z.enum(SUBMITTABLE_KINDS),
  name_he: z.string(),
  lat: z.number(),
  lng: z.number(),
  precision: z.enum(["exact", "approx"]),
  place_he: z.string(),
  summary_he: z.string(),
  in_memory_of: z.string().optional(),
  link_url: z.string().optional(),
})
export type PublicPlace = z.infer<typeof PublicPlace>

export const Feed = z.object({ v: z.string(), places: z.array(PublicPlace) })
export type Feed = z.infer<typeof Feed>

/** Feed versions are "epoch.n"; the epoch moves only on a restore, so it compares first. */
export function parseVersion(v: string): { epoch: number; n: number } | null {
  const m = /^(\d+)\.(\d+)$/.exec(v)
  return m ? { epoch: +m[1], n: +m[2] } : null
}
export function isNewer(a: string, b: string): boolean {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) return false
  return x.epoch > y.epoch || (x.epoch === y.epoch && x.n > y.n)
}
```

```ts
// worker/lib/clock.ts
/** The server's only clock. Tests may set it with X-Test-Now, and only in development. */
export function clock(req: Request, env: Env): Date {
  const forced = env.ENVIRONMENT === "development" ? req.headers.get("X-Test-Now") : null
  const d = forced ? new Date(forced) : new Date()
  return Number.isNaN(d.getTime()) ? new Date() : d
}
```

```ts
// worker/lib/ids.ts
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

/** A ULID: 10 characters of time, then 16 of randomness, so ids sort by creation. */
export function ulid(ms = Date.now()): string {
  let t = ""
  for (let i = 0, x = ms; i < 10; i++, x = Math.floor(x / 32)) t = B32[x % 32] + t
  let r = ""
  for (const b of crypto.getRandomValues(new Uint8Array(16))) r += B32[b % 32]
  return t + r
}
export const placeId = (ms?: number) => `p_${ulid(ms)}`

/** 128 random bits, base64url: the submitter's tracking capability. Only its hash is stored. */
export function newToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("")
}
/** Constant time, so the comparison doesn't leak how much of a hash matched. */
export async function sameHash(a: string, b: string): Promise<boolean> {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  return x.byteLength === y.byteLength && crypto.subtle.timingSafeEqual(x, y)
}
```

- [ ] **צעד 4: מריצים ומוודאים שהבדיקות עוברות**

```bash
scripts/heavy npm test
```

צפוי: כל הבדיקות עוברות.

- [ ] **צעד 5: typecheck, lint, format, commit**

```bash
npm run typecheck && npm run lint && npm run format && npm run format:check
git add -A && git commit -m "Add the places schema, Hebrew text cleaning, ids and the server clock"
```

### משימה 3: הגשה בלי מייל, וסטטוס דרך קישור המעקב

**קבצים:**
- ליצור:
  - `worker/lib/http.ts`, `worker/db/places.ts`, `worker/routes/submissions.ts`
  - `worker/test/submissions.test.ts`
- לשנות: `worker/index.ts`

**ממשקים:**
- `problem(c, status, code, extra?)`: מחזיר `application/problem+json`.
- `insertSubmission(db, input, now): Promise<{ id: string; trackingToken: string }>`.
- `submissionStatus(db, id, token): Promise<{ status: string } | null>`.

- [ ] **צעד 1: בדיקות שנכשלות**

```ts
// worker/test/submissions.test.ts
import { SELF, env } from "cloudflare:test"
import { describe, expect, it } from "vitest"

const valid = { kind: "bench", name_he: "ספסל דמו", lat: 31.42, lng: 34.49, consent_version: "notice.submission@2026-10-1" }
const post = (body: unknown) =>
  SELF.fetch("http://local/api/v1/submissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })

describe("POST /api/v1/submissions", () => {
  it("accepts a place without any email, and stores only the token's hash", async () => {
    const res = await post(valid)
    expect(res.status).toBe(201)
    expect(res.headers.get("Cache-Control")).toBe("private, no-store")
    const { id, trackingToken } = await res.json<{ id: string; trackingToken: string }>()
    expect(id).toMatch(/^p_/)
    const row = await env.DB.prepare("SELECT status, tracking_token_hash FROM places WHERE id = ?").bind(id).first<{ status: string; tracking_token_hash: string }>()
    expect(row?.status).toBe("pending")
    expect(row?.tracking_token_hash).not.toContain(trackingToken)
  })
  it("strips bidi controls from the name", async () => {
    const { id } = await (await post({ ...valid, name_he: "ספסל‮ דמו" })).json<{ id: string }>()
    expect(await env.DB.prepare("SELECT name_he FROM revisions WHERE place_id = ?").bind(id).first("name_he")).toBe("ספסל דמו")
  })
  it("refuses unknown fields, a place outside Israel and a community", async () => {
    for (const body of [{ ...valid, extra: 1 }, { ...valid, lat: 40 }, { ...valid, kind: "community" }]) {
      const res = await post(body)
      expect(res.status).toBe(400)
      expect(res.headers.get("Content-Type")).toContain("application/problem+json")
    }
  })
})

describe("GET /api/v1/submissions/:id", () => {
  it("shows the status only to the holder of the tracking token", async () => {
    const { id, trackingToken } = await (await post(valid)).json<{ id: string; trackingToken: string }>()
    const ok = await SELF.fetch(`http://local/api/v1/submissions/${id}`, { headers: { Authorization: `Bearer ${trackingToken}` } })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ status: "pending" })
    const wrong = await SELF.fetch(`http://local/api/v1/submissions/${id}`, { headers: { Authorization: "Bearer nope" } })
    expect(wrong.status).toBe(404)
  })
})
```

- [ ] **צעד 2: מריצים ומוודאים שהבדיקות נכשלות**

```bash
scripts/heavy npm test
```

צפוי: FAIL (404).

- [ ] **צעד 3: מממשים**

```ts
// worker/lib/http.ts
import type { Context } from "hono"

/** RFC 9457 problem details; the client turns `code` into Hebrew, the server never writes UI text. */
export function problem(c: Context, status: 400 | 401 | 403 | 404 | 409 | 500, code: string, extra: Record<string, unknown> = {}) {
  return c.body(JSON.stringify({ type: "about:blank", status, code, ...extra }), status, { "Content-Type": "application/problem+json" })
}

/** Anything authenticated must never sit in a shared cache. */
export const PRIVATE = { "Cache-Control": "private, no-store" } as const
```

```ts
// worker/db/places.ts
import type { SubmissionInput } from "@/shared/contract"
import { newToken, placeId, sameHash, sha256Hex, ulid } from "../lib/ids"

const MONTH_MS = 30 * 24 * 3600 * 1000

export async function insertSubmission(db: D1Database, input: SubmissionInput, now: Date) {
  const id = placeId(now.getTime())
  const trackingToken = newToken()
  const at = now.toISOString()
  const precision = input.on_private_property ? "approximate" : "exact"
  const stmts = [
    db
      .prepare("INSERT INTO places (id, origin, status, rev, tracking_token_hash, created_at, status_changed_at) VALUES (?, 'contribution', 'pending', 1, ?, ?, ?)")
      .bind(id, await sha256Hex(trackingToken), at, at),
    db
      .prepare(
        `INSERT INTO revisions (id, place_id, n, state, kind, name_he, lat, lng, location_precision, on_private_property, place_he, in_memory_of, story_he, link_url, consent_version, created_at)
         VALUES (?, ?, 1, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        `r_${ulid(now.getTime())}`,
        id,
        input.kind,
        input.name_he,
        input.lat,
        input.lng,
        precision,
        input.on_private_property ? 1 : 0,
        input.place_he ?? null,
        input.in_memory_of ?? null,
        input.story_he ?? null,
        input.link_url ?? null,
        input.consent_version,
        at,
      ),
  ]
  // The submitter's name is personal data: it lives with the contacts, under a fixed deletion ceiling.
  if (input.submitter_name) {
    const ceiling = new Date(now.getTime() + 12 * MONTH_MS).toISOString()
    stmts.push(
      db
        .prepare("INSERT INTO contacts (id, place_id, name, consent_version, created_at, ceiling_at, purge_after) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(`c_${ulid(now.getTime())}`, id, input.submitter_name, input.consent_version, at, ceiling, ceiling),
    )
  }
  await db.batch(stmts)
  return { id, trackingToken }
}

export async function submissionStatus(db: D1Database, id: string, token: string) {
  const row = await db.prepare("SELECT status, tracking_token_hash AS h FROM places WHERE id = ?").bind(id).first<{ status: string; h: string | null }>()
  if (!row?.h || !(await sameHash(row.h, await sha256Hex(token)))) return null
  return { status: row.status }
}
```

**הערה:** תקרת 12 החודשים כאן היא קירוב של 30 יום לחודש. בשלב 5 היא מוחלפת בחישוב לפי לוח השנה ובקריאה מ־`RETENTION`, שבא מסשן הפרטיות.

```ts
// worker/routes/submissions.ts
import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { SubmissionInput } from "@/shared/contract"
import { insertSubmission, submissionStatus } from "../db/places"
import { clock } from "../lib/clock"
import { PRIVATE, problem } from "../lib/http"

export const submissions = new Hono<{ Bindings: Env }>()

submissions.post(
  "/",
  zValidator("json", SubmissionInput, (r, c) => (r.success ? undefined : problem(c, 400, "invalid_input"))),
  async (c) => {
    const created = await insertSubmission(c.env.DB, c.req.valid("json"), clock(c.req.raw, c.env))
    return c.json(created, 201, PRIVATE)
  },
)

submissions.get("/:id", async (c) => {
  const token = /^Bearer (.+)$/.exec(c.req.header("Authorization") ?? "")?.[1]
  // An unknown id and a wrong token look the same, so the endpoint reveals nothing about which ids exist.
  const status = token ? await submissionStatus(c.env.DB, c.req.param("id"), token) : null
  return status ? c.json(status, 200, PRIVATE) : problem(c, 404, "not_found")
})
```

ב־`worker/index.ts` מוסיפים את ה־import ואת ה־route:

```ts
import { submissions } from "./routes/submissions"

app.route("/api/v1/submissions", submissions)
```

- [ ] **צעד 4: מריצים ומוודאים שהבדיקות עוברות**

```bash
scripts/heavy npm test
```

צפוי: PASS.

- [ ] **צעד 5: typecheck, lint, format, commit**

```bash
npm run typecheck && npm run lint && npm run format && npm run format:check
git add -A && git commit -m "Accept submissions without email and show their status to the tracking token"
```

### משימה 4: אימות מודרטור ומעברי מצב

**קבצים:**
- ליצור:
  - `worker/lib/access.ts`
  - `worker/routes/admin.ts`, `worker/routes/dev.ts`
  - `worker/test/admin.test.ts`, `worker/test/helpers.ts`
- לשנות: `worker/db/places.ts`, `worker/index.ts`

**ממשקים:**
- `moderator(req, env): Promise<{ ok: true; email: string } | { ok: false; status: 401 | 403 }>`.
- `listQueue(db)`: מחזיר `Array<{ id; rev; revisionId; kind; name_he; place_he; in_memory_of; story_he; created_at }>`.
- `transition(db, { placeId, revisionId, action: "approve" | "reject", expectedRev, actor }, now): Promise<"ok" | "conflict">`.

- [ ] **צעד 1: בדיקות שנכשלות**

```ts
// worker/test/helpers.ts
import { SELF, env } from "cloudflare:test"
import { SignJWT } from "jose"

export async function devToken(email: string) {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("dev-access")
    .setAudience("makom-dev")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(env.DEV_ACCESS_SECRET))
}

export async function submit(name = "ספסל דמו") {
  const res = await SELF.fetch("http://local/api/v1/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "bench", name_he: name, lat: 31.42, lng: 34.49, consent_version: "notice.submission@2026-10-1" }),
  })
  return res.json<{ id: string; trackingToken: string }>()
}
```

```ts
// worker/test/admin.test.ts
import { SELF, env } from "cloudflare:test"
import { describe, expect, it } from "vitest"
import { devToken, submit } from "./helpers"

const admin = async (path: string, init: RequestInit = {}, email = "dev@example.test") =>
  SELF.fetch(`http://local${path}`, {
    ...init,
    headers: { "Cf-Access-Jwt-Assertion": await devToken(email), "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin", ...init.headers },
  })

const queued = async (id: string) => {
  const { items } = await (await admin("/api/admin/queue")).json<{ items: { id: string; rev: number; revisionId: string }[] }>()
  return items.find((i) => i.id === id)!
}

describe("admin", () => {
  it("refuses without a token, refuses someone not on the list, and never caches", async () => {
    expect((await SELF.fetch("http://local/api/admin/queue")).status).toBe(401)
    const outsider = await admin("/api/admin/queue", {}, "someone@example.test")
    expect(outsider.status).toBe(403)
    expect(outsider.headers.get("Cache-Control")).toBe("private, no-store")
  })
  it("refuses a cross-site change", async () => {
    const res = await admin("/api/admin/places/p_x/transitions", { method: "POST", body: "{}", headers: { "Sec-Fetch-Site": "cross-site" } })
    expect(res.status).toBe(403)
  })
  it("approves once: the feed moves on, and a second decision on the same revision conflicts", async () => {
    const { id } = await submit()
    const item = await queued(id)
    const before = await env.DB.prepare("SELECT n FROM feed_state").first<number>("n")
    const body = JSON.stringify({ action: "approve", revisionId: item.revisionId, expectedRev: item.rev })
    const [a, b] = await Promise.all([
      admin(`/api/admin/places/${id}/transitions`, { method: "POST", body }),
      admin(`/api/admin/places/${id}/transitions`, { method: "POST", body: body.replace("approve", "reject") }),
    ])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(await env.DB.prepare("SELECT n FROM feed_state").first<number>("n")).toBe((before ?? 0) + (a.status === 200 ? 1 : 0))
    const audit = await env.DB.prepare("SELECT action, fields FROM audit_log WHERE entity_id = ?").bind(id).all()
    expect(audit.results).toHaveLength(1)
  })
})
```

- [ ] **צעד 2: מריצים ומוודאים שהבדיקות נכשלות**

```bash
scripts/heavy npm test
```

צפוי: FAIL.

- [ ] **צעד 3: מממשים**

```ts
// worker/lib/access.ts
import { createRemoteJWKSet, jwtVerify } from "jose"

const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function readToken(req: Request): string | null {
  const header = req.headers.get("Cf-Access-Jwt-Assertion")
  if (header) return header
  return /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(req.headers.get("Cookie") ?? "")?.[1] ?? null
}

/**
 * In production, Cloudflare Access signs in at the edge and passes a JWT; we verify it again here, so a route
 * that somehow skipped Access still gets nothing. In development, a dev-only issuer stands in for Access.
 */
export async function moderator(req: Request, env: Env): Promise<{ ok: true; email: string } | { ok: false; status: 401 | 403 }> {
  const token = readToken(req)
  if (!token) return { ok: false, status: 401 }
  try {
    const dev = env.ENVIRONMENT === "development" && env.DEV_ACCESS_SECRET
    const { payload } = dev
      ? await jwtVerify(token, new TextEncoder().encode(env.DEV_ACCESS_SECRET), { issuer: "dev-access", audience: "makom-dev" })
      : await jwtVerify(token, keysFor(env.ACCESS_TEAM_DOMAIN), { issuer: `https://${env.ACCESS_TEAM_DOMAIN}`, audience: env.ACCESS_AUD })
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : ""
    const allowed = env.MODERATORS.split(",").map((e) => e.trim().toLowerCase())
    return allowed.includes(email) ? { ok: true, email } : { ok: false, status: 403 }
  } catch {
    return { ok: false, status: 401 }
  }
}

function keysFor(team: string) {
  let k = jwks.get(team)
  if (!k) jwks.set(team, (k = createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`))))
  return k
}
```

```ts
// add to worker/db/places.ts
export async function listQueue(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.rev, r.id AS revisionId, r.kind, r.name_he, r.place_he, r.in_memory_of, r.story_he, p.created_at
       FROM places p JOIN revisions r ON r.place_id = p.id AND r.state = 'pending'
       WHERE p.status = 'pending' ORDER BY p.created_at`,
    )
    .all()
  return results
}

/**
 * A compare-and-set on the place's rev: two moderators deciding at once can't both win. Every later statement
 * checks the transition id this request wrote, so the revision, the feed version and the audit row move only
 * if this transition actually happened.
 */
export async function transition(
  db: D1Database,
  t: { placeId: string; revisionId: string; action: "approve" | "reject"; expectedRev: number; actor: string },
  now: Date,
): Promise<"ok" | "conflict"> {
  const tid = `t_${ulid(now.getTime())}`
  const at = now.toISOString()
  const happened = "EXISTS (SELECT 1 FROM places WHERE id = ?1 AND last_transition_id = ?2)"
  const status = t.action === "approve" ? "published" : "rejected"
  const state = t.action === "approve" ? "approved" : "rejected"
  const [placeUpdate] = await db.batch([
    db
      .prepare(
        `UPDATE places SET status = ?3, rev = rev + 1, last_transition_id = ?2, status_changed_at = ?4,
           published_revision_id = CASE WHEN ?3 = 'published' THEN ?5 ELSE published_revision_id END
         WHERE id = ?1 AND rev = ?6 AND status = 'pending'
           AND EXISTS (SELECT 1 FROM revisions WHERE id = ?5 AND place_id = ?1 AND state = 'pending')`,
      )
      .bind(t.placeId, tid, status, at, t.revisionId, t.expectedRev),
    db.prepare(`UPDATE revisions SET state = ?3, decided_at = ?4 WHERE id = ?5 AND ${happened}`).bind(t.placeId, tid, state, at, t.revisionId),
    db.prepare(`UPDATE feed_state SET n = n + 1, changed_at = ?3 WHERE id = 1 AND ?4 = 'published' AND ${happened}`).bind(t.placeId, tid, at, status),
    db
      .prepare(`INSERT INTO audit_log (id, at, actor, action, entity_id, fields) SELECT ?3, ?4, ?5, ?6, ?1, 'status' WHERE ${happened}`)
      .bind(t.placeId, tid, `a_${ulid(now.getTime())}`, at, t.actor, t.action),
  ])
  return placeUpdate.meta.changes === 1 ? "ok" : "conflict"
}
```

```ts
// worker/routes/admin.ts
import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { z } from "zod"
import { listQueue, transition } from "../db/places"
import { moderator } from "../lib/access"
import { clock } from "../lib/clock"
import { PRIVATE, problem } from "../lib/http"

export const admin = new Hono<{ Bindings: Env; Variables: { actor: string } }>()

admin.use("*", async (c, next) => {
  // Every admin answer, errors included, stays out of shared caches.
  c.header("Cache-Control", PRIVATE["Cache-Control"])
  // The admin authenticates by cookie, so a change must come from our own pages.
  if (c.req.method !== "GET" && c.req.header("Sec-Fetch-Site") !== "same-origin") return problem(c, 403, "cross_site")
  const who = await moderator(c.req.raw, c.env)
  if (!who.ok) return problem(c, who.status, who.status === 401 ? "sign_in" : "not_allowed")
  c.set("actor", who.email)
  await next()
})

admin.get("/queue", async (c) => c.json({ items: await listQueue(c.env.DB) }))

const Transition = z.object({ action: z.enum(["approve", "reject"]), revisionId: z.string(), expectedRev: z.number().int() }).strict()

admin.post(
  "/places/:id/transitions",
  zValidator("json", Transition, (r, c) => (r.success ? undefined : problem(c, 400, "invalid_input"))),
  async (c) => {
    const body = c.req.valid("json")
    const result = await transition(c.env.DB, { placeId: c.req.param("id"), ...body, actor: c.get("actor") }, clock(c.req.raw, c.env))
    return result === "ok" ? c.json({ ok: true }) : problem(c, 409, "changed_meanwhile")
  },
)
```

```ts
// worker/routes/dev.ts
import { Hono } from "hono"
import { SignJWT } from "jose"

/** Development only: stands in for the Access sign-in, so the admin page and e2e tests can log in locally. */
export const dev = new Hono<{ Bindings: Env }>()

dev.post("/login", async (c) => {
  if (c.env.ENVIRONMENT !== "development" || !c.env.DEV_ACCESS_SECRET) return c.notFound()
  const { email } = await c.req.json<{ email: string }>()
  const token = await new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("dev-access")
    .setAudience("makom-dev")
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(new TextEncoder().encode(c.env.DEV_ACCESS_SECRET))
  return c.body(null, 204, { "Set-Cookie": `CF_Authorization=${token}; Path=/; HttpOnly; SameSite=Lax` })
})
```

ב־`worker/index.ts` מוסיפים את ה־imports ואת ה־routes:

```ts
import { admin } from "./routes/admin"
import { dev } from "./routes/dev"

app.route("/api/admin", admin)
app.route("/__dev", dev)
```

ב־`wrangler.jsonc` מוסיפים את `"/__dev/*"` ל־`run_worker_first`, אם עוד לא קיים.

- [ ] **צעד 4: מריצים ומוודאים שהבדיקות עוברות**

```bash
scripts/heavy npm test
```

צפוי: PASS.

- [ ] **צעד 5: typecheck, lint, format, commit**

```bash
npm run typecheck && npm run lint && npm run format && npm run format:check
git add -A && git commit -m "Verify moderators and approve or reject submissions with a compare-and-set"
```

### משימה 5: פיד עם גרסה

**קבצים:**
- ליצור: `worker/routes/feed.ts`, `worker/test/feed.test.ts`
- לשנות: `worker/db/places.ts`, `worker/index.ts`

**ממשקים:**
- `GET /api/v1/version` מחזיר `{ v }`.
- `GET /api/v1/feed?v=` מחזיר `Feed`, או `409 { v }` כשהגרסה לא נוכחית.
- `readFeed(db, epoch): Promise<Feed>`.

- [ ] **צעד 1: בדיקות שנכשלות**

```ts
// worker/test/feed.test.ts
import { SELF } from "cloudflare:test"
import { expect, it } from "vitest"
import { devToken, submit } from "./helpers"

const version = async () => (await (await SELF.fetch("http://local/api/v1/version")).json<{ v: string }>()).v

it("publishes only approved places, under the version that was read with them", async () => {
  const { id } = await submit("גן דמו")
  const v0 = await version()
  const feed0 = await (await SELF.fetch(`http://local/api/v1/feed?v=${v0}`)).json<{ places: { id: string }[] }>()
  expect(feed0.places.some((p) => p.id === id)).toBe(false)

  const headers = { "Cf-Access-Jwt-Assertion": await devToken("dev@example.test"), "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" }
  const { items } = await (await SELF.fetch("http://local/api/admin/queue", { headers })).json<{ items: { id: string; rev: number; revisionId: string }[] }>()
  const item = items.find((i) => i.id === id)!
  await SELF.fetch(`http://local/api/admin/places/${id}/transitions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "approve", revisionId: item.revisionId, expectedRev: item.rev }),
  })

  const stale = await SELF.fetch(`http://local/api/v1/feed?v=${v0}`)
  expect(stale.status).toBe(409)
  const v1 = await version()
  const res = await SELF.fetch(`http://local/api/v1/feed?v=${v1}`)
  expect(res.headers.get("Cache-Control")).toBe("no-store")
  expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBe("max-age=60")
  expect(res.headers.get("Cache-Tag")).toBe("feed")
  const feed1 = await res.json<{ places: { id: string; name_he: string }[] }>()
  expect(feed1.places.find((p) => p.id === id)?.name_he).toBe("גן דמו")
})
```

- [ ] **צעד 2: מריצים ומוודאים שהבדיקה נכשלת**

```bash
scripts/heavy npm test
```

צפוי: FAIL.

- [ ] **צעד 3: מממשים**

```ts
// add to worker/db/places.ts
import type { Feed, PublicPlace } from "@/shared/contract"

/** One batch, so the version and the places come from the same moment. */
export async function readFeed(db: D1Database, epoch: string): Promise<Feed> {
  const [state, rows] = await db.batch([
    db.prepare("SELECT n FROM feed_state WHERE id = 1"),
    db.prepare(
      `SELECT p.id, r.kind, r.name_he, r.lat, r.lng, r.location_precision, r.place_he, r.story_he, r.in_memory_of, r.link_url
       FROM places p JOIN revisions r ON r.id = p.published_revision_id WHERE p.status = 'published'`,
    ),
  ])
  const n = (state.results[0] as { n: number }).n
  const places = (rows.results as Record<string, string | number | null>[]).map(
    (r): PublicPlace => ({
      id: r.id as string,
      kind: r.kind as PublicPlace["kind"],
      name_he: r.name_he as string,
      lat: r.lat as number,
      lng: r.lng as number,
      precision: r.location_precision === "approximate" ? "approx" : "exact",
      place_he: (r.place_he as string | null) ?? "",
      summary_he: (r.story_he as string | null) ?? "",
      in_memory_of: (r.in_memory_of as string | null) ?? undefined,
      link_url: (r.link_url as string | null) ?? undefined,
    }),
  )
  return { v: `${epoch}.${n}`, places }
}
```

```ts
// worker/routes/feed.ts
import { Hono } from "hono"
import { readFeed } from "../db/places"

export const feed = new Hono<{ Bindings: Env }>()

// The browser never keeps these (no-store), so its HTTP cache can't bring a hidden place back; the edge keeps
// them briefly, under a tag that a takedown purges (phase 4).
const edge = (seconds: number, tag: string) => ({
  "Cache-Control": "no-store",
  "Cloudflare-CDN-Cache-Control": `max-age=${seconds}`,
  "Cache-Tag": tag,
})

feed.get("/version", async (c) => {
  const n = await c.env.DB.prepare("SELECT n FROM feed_state WHERE id = 1").first<number>("n")
  return c.json({ v: `${c.env.EPOCH}.${n ?? 0}` }, 200, edge(10, "feed"))
})

feed.get("/feed", async (c) => {
  const current = await readFeed(c.env.DB, c.env.EPOCH)
  if (c.req.query("v") !== current.v) return c.json({ code: "stale_version", v: current.v }, 409, { "Cache-Control": "no-store" })
  return c.json(current, 200, edge(60, "feed"))
})
```

ב־`worker/index.ts` מוסיפים את ה־import ואת ה־route:

```ts
import { feed } from "./routes/feed"

app.route("/api/v1", feed)
```

- [ ] **צעד 4: מריצים ומוודאים שהבדיקה עוברת**

```bash
scripts/heavy npm test
```

צפוי: PASS.

- [ ] **צעד 5: typecheck, lint, format, commit**

```bash
npm run typecheck && npm run lint && npm run format && npm run format:check
git add -A && git commit -m "Serve a versioned feed of approved places with edge-only cache headers"
```

### משימה 6: הלקוח שולח, מושך פיד ומציג

**קבצים:**
- ליצור: `src/lib/api.ts`, `src/lib/feed.ts`
- לשנות:
  - `src/types.ts`, `src/store.ts`, `src/App.tsx`, `src/components/add-place.tsx`
  - הקוראים ל־`allPlaces`: `src/components/search.tsx:24`, `src/components/explorer.tsx:30`, `src/components/community-detail.tsx:19`, `src/components/lists.tsx:41`, `src/components/lists.tsx:109`, `src/map/map-canvas.tsx:28`

**ממשקים:**
- `submitPlace(input: SubmissionInput): Promise<{ id: string; trackingToken: string } | null>`.
- `startFeedSync(): () => void`.
- בחנות:
  - `remote: Place[]`;
  - `feedVersion: string | null`;
  - `setRemote(v: string, places: Place[])`;
  - `allPlaces({ seed, remote, local })`.
- ב־`LocalFields`:
  - `remoteId?: string`;
  - `trackingToken?: string`.

- [ ] **צעד 1: מממשים את הקבצים החדשים**

```ts
// src/lib/api.ts
import type { SubmissionInput } from "@/shared/contract"

/** Null when the server can't be reached: the place is still kept on this device, and the visitor is told so. */
export async function submitPlace(input: SubmissionInput): Promise<{ id: string; trackingToken: string } | null> {
  try {
    const res = await fetch("/api/v1/submissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })
    return res.status === 201 ? await res.json() : null
  } catch {
    return null
  }
}
```

```ts
// src/lib/feed.ts
import { Feed, isNewer, type PublicPlace } from "@/shared/contract"
import { useStore } from "@/store"
import type { Place } from "@/types"

const EVERY_MS = 30_000

function toPlace(p: PublicPlace): Place {
  return {
    id: p.id,
    name_he: p.name_he,
    kind: p.kind,
    lat: p.lat,
    lng: p.lng,
    precision: p.precision,
    place_he: p.place_he,
    summary_he: p.summary_he,
    links: p.link_url ? [{ label_he: "אתר הנצחה", url: p.link_url }] : [],
    coord_source: "community",
    region: p.lat < 31.7 && p.lng < 34.75 && p.lat > 31.1 ? "envelope" : "country",
  }
}

/**
 * Keeps the approved places current while the tab is in view: every 30 seconds, and at once whenever the tab
 * comes back, the window gets focus or the connection returns. A newer version replaces the list whole.
 */
export function startFeedSync(): () => void {
  let busy = false
  const check = async (retry = true): Promise<void> => {
    if (busy || document.visibilityState !== "visible") return
    busy = true
    try {
      const { v } = (await (await fetch("/api/v1/version", { cache: "no-store" })).json()) as { v: string }
      const mine = useStore.getState().feedVersion
      if (mine && !isNewer(v, mine)) return
      const res = await fetch(`/api/v1/feed?v=${encodeURIComponent(v)}`, { cache: "no-store" })
      if (res.status === 409 && retry) {
        busy = false
        return void (await check(false))
      }
      const feed = Feed.parse(await res.json())
      if (!mine || isNewer(feed.v, mine)) useStore.getState().setRemote(feed.v, feed.places.map(toPlace))
      // dev only: lets the e2e test wait for the feed instead of sleeping
      if (import.meta.env.DEV) (window as unknown as { __remoteIds?: string[] }).__remoteIds = feed.places.map((p) => p.id)
    } catch {
      /* offline or the server is down: the map keeps what it already shows */
    } finally {
      busy = false
    }
  }
  const onWake = () => void check()
  const timer = setInterval(onWake, EVERY_MS)
  document.addEventListener("visibilitychange", onWake)
  window.addEventListener("focus", onWake)
  window.addEventListener("online", onWake)
  void check()
  return () => {
    clearInterval(timer)
    document.removeEventListener("visibilitychange", onWake)
    window.removeEventListener("focus", onWake)
    window.removeEventListener("online", onWake)
  }
}
```

- [ ] **צעד 2: החנות, הטיפוסים והנתב**

- **`src/types.ts`:** ב־`LocalFields` מוסיפים `remoteId?: string` ו־`trackingToken?: string`.
- **`src/store.ts`:**
  - מוסיפים ל־`State`:
    - `remote: Place[]`;
    - `feedVersion: string | null`;
    - `setRemote: (v: string, places: Place[]) => void`.
  - ערכים התחלתיים: `remote: []`, `feedVersion: null`, `setRemote: (feedVersion, remote) => set({ feedVersion, remote })`.
  - `linkedPlaceId` סומך גם על `p_`. אלה מקומות מהפיד, שנטענים מאוחר יותר:

```ts
return id.startsWith("local-") || id.startsWith("p_") || (seed as Place[]).some((p) => p.id === id) ? id : null
```

  - מחליפים את `allPlaces`:

```ts
/** Seed, approved places from the server, and this device's own places; once its place is approved, the local copy steps aside. */
export const allPlaces = (s: Pick<State, "seed" | "remote" | "local">) => {
  const published = new Set(s.remote.map((p) => p.id))
  return [...s.seed, ...s.remote, ...s.local.filter((p) => !p.local?.remoteId || !published.has(p.local.remoteId))]
}
```

- **בכל אחד מששת הקוראים:**
  - מוסיפים `const remote = useStore((s) => s.remote)`.
  - קוראים ל־`allPlaces({ seed, remote, local })`.
  - מוסיפים את `remote` לרשימת התלויות של `useMemo`.
- **ב־`src/App.tsx`, `useHashRoute`:** התנאי `pid.startsWith("local-")` הופך ל־`pid.startsWith("local-") || pid.startsWith("p_")`.
- **ב־`src/App.tsx`, `App`:** מוסיפים אפקט שמפעיל את הסנכרון כשמגיעים ליום. הסנכרון נטען דינמית, כדי שהחבילה הראשונה תישאר נקייה:

```tsx
useEffect(() => {
  if (phase !== "day") return
  let stop: (() => void) | undefined
  let cancelled = false
  void import("@/lib/feed").then((m) => {
    if (!cancelled) stop = m.startFeedSync()
  })
  return () => {
    cancelled = true
    stop?.()
  }
}, [phase])
```

- [ ] **צעד 3: `add-place.tsx` שולח לשרת**

**`DESCRIPTIONS[2]`** הופך ל:

```ts
"ההצעה תישלח לבדיקה ותופיע לכולם אחרי אישור. עד אז היא מוצגת רק אצלכם."
```

**ב־`save()`**, אחרי שבונים את `place` ולפני `await addLocal(place)`:

```ts
const sent = await submitPlace({
  kind: kind as SubmissionInput["kind"],
  name_he: name.trim(),
  lat: place.lat,
  lng: place.lng,
  place_he: placeHe.trim() || undefined,
  in_memory_of: inMemoryOf.trim() || undefined,
  story_he: story.trim() || undefined,
  link_url: link ? `https://${stripScheme(link)}` : undefined,
  submitter_name: submitter.trim() || undefined,
  on_private_property: false,
  consent_version: "notice.submission@2026-10-1",
})
if (sent && place.local) {
  place.local.remoteId = sent.id
  place.local.trackingToken = sent.trackingToken
}
```

**ב־toast** מחליפים את התיאור:

```ts
sent
  ? "ההצעה נשלחה לבדיקה. היא תופיע לכולם אחרי אישור."
  : "לא הצלחנו לשלוח כרגע. המקום נשמר במכשיר הזה."
```

**imports:** מוסיפים `submitPlace` מ־`@/lib/api`, ואת הטיפוס `SubmissionInput` מ־`@/shared/contract`.

**הערה:** התמונה עדיין נשמרת רק במכשיר. ההעלאה שלה לשרת מגיעה בשלב 2.

- [ ] **צעד 4: typecheck, lint, format, ובדיקות e2e קיימות**

```bash
npm run typecheck && npm run lint && npm run format && npm run format:check
```
```bash
scripts/heavy npx playwright test e2e/routing.spec.ts e2e/mobile-sheet.spec.ts
```

צפוי: הכל עובר.

- [ ] **צעד 5: commit**

```bash
git add -A && git commit -m "Send places to the server and show approved places from the versioned feed"
```

### משימה 7: עמוד ניהול מינימלי, ובדיקת הזרימה מקצה לקצה

**קבצים:**
- ליצור:
  - `admin/index.html`
  - `src/admin/main.tsx`, `src/admin/queue.tsx`
  - `e2e/backend-flow.spec.ts`
- לשנות: `vite.config.ts`, `playwright.config.ts`

- [ ] **צעד 1: בדיקת e2e שנכשלת**

```ts
// e2e/backend-flow.spec.ts
import { expect, test, type Browser } from "@playwright/test"

const skipIntro = async (b: Browser, opts = {}) => {
  const ctx = await b.newContext(opts)
  const page = await ctx.newPage()
  await page.goto("/")
  await page.getByRole("button", { name: "דילוג" }).click()
  return page
}

test("a place submitted without email is moderated, published, and seen in another browser", async ({ browser }) => {
  const name = `ספסל דמו ${Date.now()}`

  // A visitor submits, using the device's location, and gives no email at all.
  const visitor = await skipIntro(browser, { geolocation: { latitude: 31.42, longitude: 34.49 }, permissions: ["geolocation"] })
  await visitor.getByRole("button", { name: "הוספת מקום" }).first().click()
  const dialog = visitor.getByRole("dialog")
  await dialog.getByRole("button", { name: "המיקום הנוכחי שלי" }).click()
  await dialog.getByRole("button", { name: "המשך" }).click()
  await dialog.getByLabel("שם המקום").fill(name)
  await dialog.getByRole("button", { name: "המשך" }).click()
  for (const box of await dialog.getByRole("checkbox").all()) await box.check()
  const sent = visitor.waitForResponse((r) => r.url().endsWith("/api/v1/submissions") && r.status() === 201)
  await dialog.getByRole("button", { name: "שמירה והנחת כלנית" }).click()
  const { id } = (await (await sent).json()) as { id: string }

  // Someone else already has the map open before the place is approved.
  const other = await skipIntro(browser)

  // A moderator approves it.
  const modCtx = await browser.newContext()
  await modCtx.request.post("/__dev/login", { data: { email: "dev@example.test" } })
  const mod = await modCtx.newPage()
  await mod.goto("/admin/")
  const item = mod.getByRole("article", { name })
  await item.getByRole("button", { name: "אישור" }).click()
  await expect(item).toHaveCount(0)

  // The other browser's next check (it also runs whenever the tab comes back into view) brings the place in.
  await other.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
  await other.getByRole("button", { name: "חיפוש", exact: true }).click()
  await other.getByRole("dialog").getByRole("combobox").fill(name)
  await expect(other.getByRole("option", { name: new RegExp(name) })).toBeVisible()

  // The submitter sees one copy, not their local one beside the published one.
  await visitor.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
  await expect.poll(() => visitor.evaluate((pid) => (window as unknown as { __remoteIds?: string[] }).__remoteIds?.includes(pid), id)).toBe(true)
  await visitor.getByRole("button", { name: "חיפוש", exact: true }).click()
  await visitor.getByRole("dialog").getByRole("combobox").fill(name)
  await expect(visitor.getByRole("option", { name: new RegExp(name) })).toHaveCount(1)

  // A shared link to the new place opens it, even though the place arrives only with the feed.
  const linked = await (await browser.newContext()).newPage()
  await linked.goto(`/#/place/${id}`)
  await expect(linked.getByRole("heading", { name })).toBeVisible()
})

test("the opening finishes and the site works while the API is down", async ({ page }) => {
  await page.route("**/api/**", (r) => r.abort())
  await page.goto("/")
  await page.getByRole("button", { name: "דילוג" }).click()
  await expect(page.getByRole("button", { name: "חיפוש", exact: true })).toBeVisible()
})
```

- [ ] **צעד 2: מריצים ומוודאים שהבדיקה נכשלת**

```bash
scripts/heavy npx playwright test e2e/backend-flow.spec.ts
```

צפוי: FAIL, כי `/admin/` לא קיים.

- [ ] **צעד 3: עמוד הניהול, וקלט לשני עמודים**

```html
<!-- admin/index.html -->
<!doctype html>
<html lang="he" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex" />
    <title>ניהול · מקום לזכור</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/admin/main.tsx"></script>
  </body>
</html>
```

```tsx
// src/admin/main.tsx
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@/index.css"
import { Queue } from "./queue"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Queue />
  </StrictMode>,
)
```

```tsx
// src/admin/queue.tsx
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"

interface Item {
  id: string
  rev: number
  revisionId: string
  name_he: string
  place_he: string | null
  in_memory_of: string | null
  story_he: string | null
}

/** The moderation queue: read a submission, approve or reject it. Moderators never edit what a contributor wrote. */
export function Queue() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState("")
  const load = useCallback(async () => {
    const res = await fetch("/api/admin/queue")
    if (!res.ok) return setError(res.status === 401 ? "צריך להתחבר." : "אין הרשאה.")
    setItems(((await res.json()) as { items: Item[] }).items)
  }, [])
  useEffect(() => void load(), [load])

  const decide = async (item: Item, action: "approve" | "reject") => {
    const res = await fetch(`/api/admin/places/${item.id}/transitions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, revisionId: item.revisionId, expectedRev: item.rev }),
    })
    if (res.status === 409) setError("מישהו אחר כבר טיפל בהצעה הזו.")
    await load()
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-title-2 text-ink-1">הצעות שממתינות לבדיקה</h1>
      {error && (
        <p role="alert" className="mt-3 text-label text-destructive">
          {error}
        </p>
      )}
      {items?.length === 0 && <p className="mt-6 text-ink-2">אין הצעות ממתינות.</p>}
      <div className="mt-6 grid gap-4">
        {items?.map((item) => (
          <article key={item.id} aria-label={item.name_he} className="rounded-2xl border border-line p-4">
            <h2 className="text-label font-bold text-ink-1">{item.name_he}</h2>
            <p className="text-caption text-ink-2">{[item.place_he, item.in_memory_of && `לזכר ${item.in_memory_of}`].filter(Boolean).join(" · ")}</p>
            {item.story_he && <p className="mt-2 whitespace-pre-line text-ink-1">{item.story_he}</p>}
            <div className="mt-3 flex gap-2">
              <Button className="pressable" onClick={() => decide(item, "approve")}>
                אישור
              </Button>
              <Button className="pressable" variant="ghost" onClick={() => decide(item, "reject")}>
                דחייה
              </Button>
            </div>
          </article>
        ))}
      </div>
    </main>
  )
}
```

ב־`vite.config.ts` מוסיפים קלט ברמה העליונה. ב־Vite 8 זו ההמלצה, כי הוא משמש גם בפיתוח:

```ts
input: { main: resolve(import.meta.dirname, "index.html"), admin: resolve(import.meta.dirname, "admin/index.html") },
```

אם הגרסה המותקנת לא מכירה את `input` ברמה העליונה, כותבים במקומו `build: { rolldownOptions: { input: { … } } }`.

ב־`playwright.config.ts`, בפקודת ה־`webServer` של הפיתוח, מוסיפים את המיגרציה המקומית לפני השרת:

```ts
command: prod ? `npm run build && npx vite preview --port ${port} --strictPort` : `npm run db:migrate:local && npm run dev -- --port ${port} --strictPort`,
```

- [ ] **צעד 4: מריצים ומוודאים שהבדיקות עוברות**

```bash
scripts/heavy npx playwright test e2e/backend-flow.spec.ts
```

צפוי: שתי הבדיקות עוברות.

```bash
scripts/heavy npm run e2e
```

צפוי: כל הסוויטה ירוקה, כולל מבחני הפריימים של הפתיחה.

- [ ] **צעד 5: typecheck, lint, format, commit, milestone**

```bash
npm run typecheck && npm run lint && npm run format && npm run format:check
git add -A && git commit -m "Moderate from a minimal admin page; e2e: submit, approve, seen elsewhere"
scripts/milestone "Backend phase 1: local Worker, D1, submit without email, moderate, versioned feed (store.ts allPlaces now takes remote)"
```

---

## סקירה עצמית (בוצעה)

**כיסוי ה־spec בשלב 1:**

| נושא ב־spec | איפה בתוכנית |
|---|---|
| 2: הזרימות 1, 3, 4 (חלקית, בלי Workflow) | משימות 3–7 |
| 3.1 ו־3.2: הטבלאות הנדרשות וה־CHECKs | משימה 2 |
| 3.3: `pending` → `published`/`rejected` | משימה 4 |
| 5: פיד, גרסה וכותרות | משימה 5 |
| 10: חוזה, שגיאות, נקודות הקצה הרלוונטיות | משימות 3–5 |
| 11: קישור המעקב, Access (מדומה), CSRF, ניקוי טקסט | משימות 2–4 |
| 13: workerd, property-based, e2e, שעון שרת | לאורך כל השלב |

כל שאר ה־spec משויך לשלבים 2 עד 7 בטבלה.

**סריקה ל־placeholders:** אין "TBD". כל צעד של קוד מכיל את הקוד עצמו. הקירוב של 12 החודשים מסומן במפורש, ויוחלף בשלב 5.

**עקביות טיפוסים:** השמות הבאים זהים בכל המשימות:
- `SubmissionInput`, `PublicPlace`, `Feed`, `isNewer`;
- `insertSubmission`, `submissionStatus`, `listQueue`, `transition`, `readFeed`;
- `moderator`, `problem`, `PRIVATE`, `clock`;
- `submitPlace`, `startFeedSync`, `setRemote`, `allPlaces({ seed, remote, local })`.

**מוקדי סקירה:** לכל אחד מחמשת המוקדים יש בדיקה במשימה שאחראית עליו:
- 1 במשימה 2;
- 2 במשימה 4;
- 3 מומש במשימה 6, דרך `allPlaces`, ונבדק ב־e2e של משימה 7: למגיש מופיעה תוצאה אחת בחיפוש;
- 4 במשימה 7;
- 5 מומש במשימה 6, דרך `linkedPlaceId` והנתב, ונבדק ב־e2e של משימה 7: קישור `/#/place/p_…` פותח את המקום.

</div>
