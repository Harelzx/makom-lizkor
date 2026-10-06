import { expect, test, type APIRequestContext, type Browser, type Page, type Route } from "@playwright/test"
import { published } from "./publish"

/** The place as the public feed has it now. */
async function inFeed(request: APIRequestContext, id: string) {
  const { v } = (await (await request.get("/api/v1/version")).json()) as { v: string }
  const { places } = (await (await request.get(`/api/v1/feed?v=${v}`)).json()) as { places: { id: string; name_he: string }[] }
  return places.find((p) => p.id === id)
}

test("a family's request hides the name as a precaution; a restoration is refused without the moderator's confirmation and accepted with it", async ({
  browser,
  request,
}) => {
  const name = "גן דמו לבקשת הסרה"
  const { id } = await published(browser, name)

  const res = await request.post("/api/v1/reports", {
    headers: { "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""), "Turnstile-Token": "XXXX.DUMMY.TOKEN.XXXX" },
    data: {
      placeId: id,
      elements: ["name_he"],
      requesterType: "family",
      relationship: "אחות",
      explanation: "שם המשפחה מופיע כאן בלי שביקשנו, אנא הסירו אותו בינתיים.",
      noticeVersion: "notice.report@2026-10-1",
    },
  })
  expect(res.status()).toBe(202)
  expect(((await res.json()) as { outcome: string }).outcome).toBe("hidden_for_review")
  await expect.poll(async () => (await inFeed(request, id))?.name_he).toBe("גן זיכרון")

  const ctx = await browser.newContext()
  await ctx.request.post("/__dev/login", { data: { email: "dev@example.test" } })
  const mod = await ctx.newPage()
  await mod.goto("/admin/")
  const card = mod.getByRole("article", { name: `בקשה על ${name}` })
  await expect(card).toBeVisible()
  await expect(card.getByText("הוסתר באופן זהיר", { exact: false })).toBeVisible()

  await card.getByRole("button", { name: "החזרה עם בסיס מתועד" }).click()
  await card.getByLabel("הנימוק בכתב").fill("בדקנו מול אתר המועצה: השם פורסם שם ברשות המשפחה.")
  await card.getByLabel("הפנייה למשפחה או לגוף שהקים את האנדרטה").fill("שוחחנו עם האחות בטלפון, היא מסכימה")
  await card.getByLabel("תאריך הפנייה").fill("2026-10-06")
  // Only one of the two statements: refused, and nothing comes back.
  await card.getByLabel("יש בסיס חיובי ומתועד להחזרה").check()
  await card.getByRole("button", { name: /^החזרת השם/ }).click()
  await expect(mod.getByRole("alert")).toHaveText(/שתי ההצהרות/)
  expect((await inFeed(request, id))?.name_he).toBe("גן זיכרון")

  await card.getByLabel("הבסיס אינו היעדר תגובה, ואינו מחלוקת בין בני משפחה").check()
  await card.getByRole("button", { name: /^החזרת השם/ }).click()
  await expect(card.getByText("שום דבר לא מוסתר.")).toBeVisible()
  await expect.poll(async () => (await inFeed(request, id))?.name_he).toBe(name)
  await ctx.close()
})

/** An operation needing attention, as the admin API lists it. */
const operation = (id: string, place: string, at: string) => ({
  id,
  place_id: place,
  kind: "hide",
  problem: "ledger_repair",
  created_at: at,
})

test("the moderators' page reaches older requests and operations a page at a time, and stops at the end", async ({ browser }) => {
  const ctx = await browser.newContext()
  await ctx.request.post("/__dev/login", { data: { email: "dev@example.test" } })
  const mod = await ctx.newPage()
  const request = (id: string, name: string, at: string) => ({
    id,
    place_id: `p_${id}`,
    origin: "contribution",
    elements: '["name_he"]',
    requester_type: "other",
    relationship: null,
    explanation: "דמו",
    has_contact: 0,
    outcome: "received",
    status: "open",
    received_at: at,
    handling_note: null,
    place_name: name,
  })
  // The list answered here, one request a page, so the test controls where the first page ends.
  await mod.route("**/api/admin/reports**", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor")
    return route.fulfill({
      json: cursor
        ? { items: [request("r_old", "ספסל דמו ישן", "2029-01-01T00:00:00.000Z")], next: null }
        : { items: [request("r_new", "ספסל דמו חדש", "2029-01-02T00:00:00.000Z")], next: "2029-01-02T00:00:00.000Z|r_new" },
    })
  })
  // The operations needing attention, two pages of one, the same way.
  await mod.route("**/api/admin/attention**", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor")
    return route.fulfill({
      json: cursor
        ? { ops: [operation("op_old", "p_op_old", "2029-01-01T00:00:00.000Z")], next: null }
        : { ops: [operation("op_new", "p_op_new", "2029-01-02T00:00:00.000Z")], next: "2029-01-02T00:00:00.000Z|op_new" },
    })
  })
  await mod.goto("/admin/")
  await expect(mod.getByRole("article", { name: "בקשה על ספסל דמו חדש" })).toBeVisible()
  await expect(mod.getByRole("article", { name: "בקשה על ספסל דמו ישן" })).toHaveCount(0)
  await mod.getByRole("button", { name: "בקשות ישנות יותר" }).click()
  await expect(mod.getByRole("article", { name: "בקשה על ספסל דמו ישן" })).toBeVisible()
  await expect(mod.getByRole("button", { name: "בקשות ישנות יותר" })).toHaveCount(0)

  const attention = mod.getByRole("list", { name: "דורש תשומת לב" })
  await expect(attention.getByRole("listitem")).toHaveText([/p_op_new/])
  await mod.getByRole("button", { name: "פעולות נוספות שדורשות תשומת לב" }).click()
  await expect(attention.getByRole("listitem")).toHaveText([/p_op_new/, /p_op_old/])
  await expect(mod.getByRole("button", { name: "פעולות נוספות שדורשות תשומת לב" })).toHaveCount(0)
  await ctx.close()
})

test("operations needing attention that fail to load say so, and come with a retry instead of reading as none", async ({ browser }) => {
  const ctx = await browser.newContext()
  await ctx.request.post("/__dev/login", { data: { email: "dev@example.test" } })
  const mod = await ctx.newPage()
  let fail = true
  await mod.route("**/api/admin/attention**", (route) =>
    fail
      ? route.fulfill({ status: 503, json: { code: "unavailable" } })
      : route.fulfill({ json: { ops: [operation("op_back", "p_op_back", "2029-01-03T00:00:00.000Z")], next: null } }),
  )
  await mod.goto("/admin/")
  await expect(mod.getByRole("alert")).toHaveText(/הפעולות שדורשות תשומת לב לא נטענו/)
  await expect(mod.getByRole("list", { name: "דורש תשומת לב" })).toHaveCount(0)
  fail = false
  await mod.getByRole("button", { name: "לנסות שוב לטעון את הפעולות" }).click()
  await expect(mod.getByRole("list", { name: "דורש תשומת לב" }).getByRole("listitem")).toHaveText([/p_op_back/])
  await expect(mod.getByRole("alert")).toHaveCount(0)
  await expect(mod.getByRole("button", { name: "לנסות שוב לטעון את הפעולות" })).toHaveCount(0)
  await ctx.close()
})

// The privacy session's result texts, word for word.
const HIDDEN = "מה שציינתם הוסתר באופן זמני, כאמצעי זהירות, עד שאדם יבדוק את הבקשה. ההסתרה אינה הכרעה בבקשה."
const RECEIVED = "הבקשה התקבלה. אדם יבדוק אותה בדחיפות."
const RECEIVED_CURATED = "הבקשה התקבלה. אדם יבדוק אותה בדחיפות. במקומות שהאתר הוסיף בעצמו, שום דבר לא מוסתר לפני הבדיקה."
const DAY = { timeout: 20_000 }

/** The place's card, opened from a link, with the request form open. */
async function requestForm(browser: Browser, id: string, heading: string | RegExp) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(`/#/place/${id}`)
  await expect(page.getByRole("heading", { name: heading })).toBeVisible(DAY)
  await page.getByRole("button", { name: "בקשת הסרה או תיקון" }).click()
  return { ctx, page, form: page.getByRole("region", { name: "בקשת הסרה או תיקון" }) }
}

/** The requests the server holds about a place, as the moderators' list has them. */
async function casesAbout(browser: Browser, id: string) {
  const mod = await browser.newContext()
  await mod.request.post("/__dev/login", { data: { email: "dev@example.test" } })
  const { items } = (await (await mod.request.get("/api/admin/reports")).json()) as { items: { place_id: string }[] }
  await mod.close()
  return items.filter((r) => r.place_id === id).length
}

/** Each request the page sends, by its key and body (the browser check's token is fresh each time, so it isn't compared). */
function recordReports(page: Page, first: (route: Route) => Promise<void>) {
  const sent: { key: string; body: string }[] = []
  void page.route("**/api/v1/reports", async (route) => {
    sent.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() ?? "" })
    return sent.length === 1 ? first(route) : route.continue()
  })
  return sent
}

test("a family member asks from the place card: the name is hidden for now, and the answer says it is no decision", async ({
  browser,
  request,
}) => {
  const name = `גן דמו לבקשה מהכרטיס ${Date.now()}`
  const { id } = await published(browser, name)
  const { form } = await requestForm(browser, id, name)
  // Only what the place shows can be named, and the place as a whole.
  await expect(form.getByRole("checkbox", { name: "התמונה" })).toHaveCount(0)
  await expect(form.getByRole("checkbox", { name: "המקום כולו" })).toBeVisible()
  await form.getByRole("checkbox", { name: "השם" }).check()
  await form.getByRole("radio", { name: "בן או בת משפחה" }).check()
  await form.getByLabel(/^הקשר שלכם/).fill("אחות")
  // Worded apart from the other tests': the same explanation twice in a day is a spam signal, and nothing is hidden.
  await form.getByLabel("מה לבדוק, ולמה").fill("השם של אבא שלנו מופיע כאן, והמשפחה לא נשאלה. נבקש להסתיר אותו עד שנדבר.")
  await form.getByText("הודעת הפרטיות", { exact: true }).click()
  await expect(form.getByText("אין בטופס שדה לשם", { exact: false })).toBeVisible()
  await form.getByRole("button", { name: "שליחת הבקשה" }).click()
  await expect(form.getByRole("status")).toHaveText(HIDDEN)
  await expect.poll(async () => (await inFeed(request, id))?.name_he).toBe("גן זיכרון")
})

test("a request about one of the site's own places: received, and the answer says nothing is hidden before the review", async ({
  browser,
}) => {
  const { form } = await requestForm(browser, "nova-memorial-reim", /נובה/)
  await form.getByRole("checkbox", { name: "הסיפור" }).check()
  await form.getByRole("radio", { name: /^אחר/ }).check()
  await form.getByLabel("מה לבדוק, ולמה").fill("יש טעות בתאריך שמופיע בתיאור של המקום הזה.")
  await form.getByRole("button", { name: "שליחת הבקשה" }).click()
  await expect(form.getByRole("status")).toHaveText(RECEIVED_CURATED)
})

test("a request whose answer was lost says so without claiming it arrived, and sending it again opens no second request", async ({
  browser,
}) => {
  const name = `גן דמו לבקשה שאבדה ${Date.now()}`
  const { id } = await published(browser, name)
  const { page, form } = await requestForm(browser, id, name)
  let posts = 0
  await page.route("**/api/v1/reports", async (route) => {
    posts++
    // The first reaches the server, and its answer never comes back.
    if (posts === 1) {
      await route.fetch()
      return route.abort("failed")
    }
    return route.continue()
  })
  await form.getByRole("checkbox", { name: "השם" }).check()
  await form.getByRole("radio", { name: /^אחר/ }).check()
  await form.getByLabel("מה לבדוק, ולמה").fill("השם כאן כתוב בשגיאה, כדאי לבדוק מול אתר המועצה.")
  await form.getByRole("button", { name: "שליחת הבקשה" }).click()
  await expect(form.getByRole("alert")).toHaveText(/לא ברור אם הבקשה הגיעה אלינו/)
  // Sent again as it was: the form can't be changed in between.
  await expect(form.getByLabel("מה לבדוק, ולמה")).toBeDisabled()
  await form.getByRole("button", { name: "שליחה שוב" }).click()
  await expect(form.getByRole("status")).toHaveText(RECEIVED)
  expect(posts).toBe(2)
  const mod = await browser.newContext()
  await mod.request.post("/__dev/login", { data: { email: "dev@example.test" } })
  const { items } = (await (await mod.request.get("/api/admin/reports")).json()) as { items: { place_id: string }[] }
  expect(items.filter((r) => r.place_id === id)).toHaveLength(1)
  await mod.close()
})

test("a card open while its place is hidden whole closes quietly when the feed catches up", async ({ browser }) => {
  const name = `גן דמו שהוסתר ${Date.now()}`
  const { id } = await published(browser, name)
  const page = await (await browser.newContext()).newPage()
  await page.goto(`/#/place/${id}`)
  await expect(page.getByRole("heading", { name })).toBeVisible(DAY)
  const mod = await browser.newContext()
  await mod.request.post("/__dev/login", { data: { email: "dev@example.test" } })
  const { rev } = (await (await mod.request.get(`/api/admin/places/${id}`)).json()) as { rev: number }
  const hid = await mod.request.post("/api/admin/suppressions", {
    headers: { "Sec-Fetch-Site": "same-origin" },
    data: { placeId: id, fields: ["whole"], expectedRev: rev, reason: "בקשת משפחה בטלפון" },
  })
  expect(hid.status()).toBe(200)
  await mod.close()
  const fed = page.waitForResponse((r) => r.url().includes("/api/v1/feed?") && r.status() === 200)
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
  await fed
  await expect(page.getByText("המקום הזה אינו מוצג כרגע")).toBeVisible()
  await expect(page.getByRole("heading", { name })).toHaveCount(0)
  await expect(page).toHaveURL(/#\/$/)
})

test("a request the server stored but answered with an error comes back after a reload, locked, and goes again as the same request: one case", async ({
  browser,
}) => {
  const name = `גן דמו לבקשה ששמורה ${Date.now()}`
  const { id } = await published(browser, name)
  const { ctx, page, form } = await requestForm(browser, id, name)
  // The first reaches the server and is stored there; the answer that comes back is a server error.
  const sent = recordReports(page, async (route) => {
    await route.fetch()
    await route.fulfill({ status: 500, json: { code: "internal" } })
  })
  const why = "השם כתוב כאן בטעות, כך כתוב באתר המועצה. כדאי לבדוק."
  await form.getByRole("checkbox", { name: "השם" }).check()
  await form.getByRole("radio", { name: /^אחר/ }).check()
  await form.getByLabel("מה לבדוק, ולמה").fill(why)
  await form.getByRole("button", { name: "שליחת הבקשה" }).click()
  await expect(form.getByRole("alert")).toHaveText(/לא ברור אם הבקשה הגיעה אלינו/)
  await expect(form.getByLabel("מה לבדוק, ולמה")).toBeDisabled()

  await page.reload()
  await expect(page.getByRole("heading", { name })).toBeVisible(DAY)
  const back = page.getByRole("region", { name: "בקשת הסרה או תיקון" })
  await expect(back.getByRole("alert")).toHaveText(/עוד לא אושרה כמתקבלת/)
  await expect(back.getByLabel("מה לבדוק, ולמה")).toHaveValue(why)
  await expect(back.getByLabel("מה לבדוק, ולמה")).toBeDisabled()
  await expect(back.getByRole("checkbox", { name: "השם" })).toBeChecked()
  await back.getByRole("button", { name: "שליחה שוב" }).click()
  await expect(back.getByRole("status")).toHaveText(RECEIVED)
  expect(sent).toHaveLength(2)
  expect(sent[1]).toEqual(sent[0])
  expect(await casesAbout(browser, id)).toBe(1)

  // Settled, so it is let go: the next visit finds an empty form.
  await page.reload()
  await expect(page.getByRole("heading", { name })).toBeVisible(DAY)
  await expect(page.getByRole("button", { name: "בקשת הסרה או תיקון" })).toBeVisible()
  await expect(page.getByRole("region", { name: "בקשת הסרה או תיקון" })).toHaveCount(0)
  await ctx.close()
})

test("a request whose fate is unknown stays with its own place: another place's form is empty and open, and the first goes again unchanged", async ({
  browser,
}) => {
  const one = `גן דמו ראשון ${Date.now()}`
  const two = `גן דמו שני ${Date.now()}`
  const { id } = await published(browser, one)
  const { id: other } = await published(browser, two)
  const { ctx, page, form } = await requestForm(browser, id, one)
  const sent = recordReports(page, async (route) => {
    await route.fetch()
    await route.abort("failed")
  })
  const why = "בסיפור של המקום יש פרט שגוי על התאריך שבו הוקם."
  await form.getByRole("checkbox", { name: "השם" }).check()
  await form.getByRole("radio", { name: /^אחר/ }).check()
  await form.getByLabel("מה לבדוק, ולמה").fill(why)
  await form.getByRole("button", { name: "שליחת הבקשה" }).click()
  await expect(form.getByRole("alert")).toHaveText(/לא ברור אם הבקשה הגיעה אלינו/)

  await page.evaluate((p) => (location.hash = `#/place/${p}`), other)
  await expect(page.getByRole("heading", { name: two })).toBeVisible()
  await expect(page.getByRole("region", { name: "בקשת הסרה או תיקון" })).toHaveCount(0)
  await page.getByRole("button", { name: "בקשת הסרה או תיקון" }).click()
  const second = page.getByRole("region", { name: "בקשת הסרה או תיקון" })
  await expect(second.getByLabel("מה לבדוק, ולמה")).toHaveValue("")
  await expect(second.getByLabel("מה לבדוק, ולמה")).toBeEnabled()
  await expect(second.getByRole("alert")).toHaveCount(0)

  await page.evaluate((p) => (location.hash = `#/place/${p}`), id)
  await expect(page.getByRole("heading", { name: one })).toBeVisible()
  const first = page.getByRole("region", { name: "בקשת הסרה או תיקון" })
  await expect(first.getByLabel("מה לבדוק, ולמה")).toHaveValue(why)
  await expect(first.getByLabel("מה לבדוק, ולמה")).toBeDisabled()
  await first.getByRole("button", { name: "שליחה שוב" }).click()
  await expect(first.getByRole("status")).toHaveText(RECEIVED)
  expect(sent).toHaveLength(2)
  expect(sent[1]).toEqual(sent[0])
  expect(await casesAbout(browser, id)).toBe(1)
  expect(await casesAbout(browser, other)).toBe(0)
  await ctx.close()
})

test("a link to a place approved after the page's last feed stays open, and the place shows once a fresh feed has it", async ({
  browser,
}) => {
  const first = `גן דמו קודם ${Date.now()}`
  const { id } = await published(browser, first)
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(`/#/place/${id}`)
  await expect(page.getByRole("heading", { name: first })).toBeVisible(DAY)
  // Approved now: the feed the page holds, live as it is, doesn't have it yet.
  const later = `גן דמו שאושר אחר כך ${Date.now()}`
  const { id: fresh } = await published(browser, later)
  await page.evaluate((p) => (location.hash = `#/place/${p}`), fresh)
  const fed = page.waitForResponse((r) => r.url().includes("/api/v1/feed?") && r.status() === 200)
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
  await fed
  await expect(page.getByRole("heading", { name: later })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`#/place/${fresh}$`))
  await expect(page.getByText("המקום הזה אינו מוצג כרגע")).toHaveCount(0)
  await ctx.close()
})
