import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page, type Route } from "./fixtures"
import { openItem } from "./admin"
import { published } from "./publish"

/** The place as the public feed has it now. */
async function inFeed(request: APIRequestContext, id: string) {
  const { v } = (await (await request.get("/api/v1/version")).json()) as { v: string }
  const { places } = (await (await request.get(`/api/v1/feed?v=${v}`)).json()) as { places: { id: string; name_he: string }[] }
  return places.find((p) => p.id === id)
}

test(
  "a family's request hides the name as a precaution; a restoration is refused without the moderator's confirmation and accepted with it",
  { tag: "@core-family" },
  async ({ browser, request }) => {
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
    const card = await openItem(mod, `בקשה על ${name}`)
    await expect(card).toBeVisible()
    await expect(card.getByText("הוסתר מהאתר עד החלטה", { exact: false })).toBeVisible()

    await card.getByRole("button", { name: "החזרה לאתר" }).click()
    await card.getByLabel("מה בדקתם ומה מצאתם").fill("בדקנו מול אתר המועצה: השם פורסם שם ברשות המשפחה.")
    await card.getByLabel("שיחה עם המשפחה או עם מי שהקים את האנדרטה").fill("שוחחנו עם האחות בטלפון, היא מסכימה")
    await card.getByLabel("תאריך השיחה").fill("2026-10-06")
    // Only one of the two statements: refused, and nothing comes back.
    await card.getByLabel("יש סיבה ברורה וכתובה להחזיר").check()
    await card.getByRole("button", { name: /^החזרת השם/ }).click()
    await expect(mod.getByRole("alert")).toHaveText(/שתי תיבות האישור/, DAY)
    expect((await inFeed(request, id))?.name_he).toBe("גן זיכרון")

    await card.getByLabel("הסיבה איננה «לא ענו לנו», ואיננה ויכוח בין בני משפחה").check()
    await card.getByRole("button", { name: /^החזרת השם/ }).click()
    await expect(card.getByText("שום דבר לא מוסתר.")).toBeVisible()
    await expect.poll(async () => (await inFeed(request, id))?.name_he).toBe(name)
    await ctx.close()
  },
)

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
  await expect(mod.getByRole("button", { name: "בקשה על ספסל דמו חדש", exact: true })).toBeVisible()
  await expect(mod.getByRole("button", { name: "בקשה על ספסל דמו ישן", exact: true })).toHaveCount(0)
  await mod.getByRole("button", { name: "להציג בקשות ישנות יותר" }).click()
  await expect(await openItem(mod, "בקשה על ספסל דמו ישן")).toBeVisible()
  await expect(mod.getByRole("button", { name: "להציג בקשות ישנות יותר" })).toHaveCount(0)

  const attention = mod.getByRole("list", { name: "פעולות שלא הושלמו" })
  await expect(attention.getByRole("listitem")).toHaveText([/p_op_new/])
  await mod.getByRole("button", { name: "להציג עוד פעולות שלא הושלמו" }).click()
  await expect(attention.getByRole("listitem")).toHaveText([/p_op_new/, /p_op_old/])
  await expect(mod.getByRole("button", { name: "להציג עוד פעולות שלא הושלמו" })).toHaveCount(0)
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
  await expect(mod.getByRole("alert")).toHaveText(/רשימת הפעולות שלא הושלמו לא נטענה/, DAY)
  await expect(mod.getByRole("list", { name: "פעולות שלא הושלמו" })).toHaveCount(0)
  fail = false
  await mod.getByRole("button", { name: "לנסות שוב לטעון את הרשימה" }).click()
  await expect(mod.getByRole("list", { name: "פעולות שלא הושלמו" }).getByRole("listitem")).toHaveText([/p_op_back/])
  await expect(mod.getByRole("alert")).toHaveCount(0)
  await expect(mod.getByRole("button", { name: "לנסות שוב לטעון את הרשימה" })).toHaveCount(0)
  await ctx.close()
})

// The privacy session's result texts, word for word.
const HIDDEN = "מה שציינתם הוסתר באופן זמני, כאמצעי זהירות, עד שאדם יבדוק את הבקשה. ההסתרה אינה הכרעה בבקשה."
const RECEIVED = "הבקשה התקבלה. אדם יבדוק אותה בדחיפות."
const RECEIVED_CURATED = "הבקשה התקבלה. אדם יבדוק אותה בדחיפות. במקומות שהאתר הוסיף בעצמו, שום דבר לא מוסתר לפני הבדיקה."
// A wait for the server: the page's own day, and every answer to a request, sent first or again (CI's runner has left
// one still out after the default 5 s: reports:444 on main's first run, reports:563 on bcf95fd's, reports:260 and
// reports:353 on 7e1dba7's, each answer arriving just after).
const DAY = { timeout: 20_000 }

/** The place's card, opened from a link, with the request form open. */
// The server allows a few requests a minute from one address; each visitor here comes from its own (a documentation
// range, synthetic), so one test's requests never count against another's.
// Only the requests themselves carry it: the map's tile servers would refuse an unknown header.
let visitors = Date.now() % 200
const visitorHeaders = new WeakMap<BrowserContext, Record<string, string>>()
async function visitor(browser: Browser, more: Record<string, string> = {}) {
  const ctx = await browser.newContext()
  visitorHeaders.set(ctx, { "cf-connecting-ip": `198.51.100.${visitors++ % 250}`, ...more })
  await ctx.route("**/api/v1/reports", (route) => route.continue({ headers: from(route, ctx) }))
  return ctx
}
const from = (route: Route, ctx: BrowserContext) => ({ ...route.request().headers(), ...visitorHeaders.get(ctx) })

async function requestForm(
  browser: Browser,
  id: string,
  heading: string | RegExp,
  more: Record<string, string> = {},
  /** Runs in the page before the site's own code, in this context only. */
  init?: () => void,
) {
  const ctx = await visitor(browser, more)
  if (init) await ctx.addInitScript(init)
  const page = await ctx.newPage()
  await page.goto(`/#/place/${id}`)
  await expect(page.getByRole("heading", { name: heading })).toBeVisible(DAY)
  await page.getByRole("button", { name: "בקשת הסרה או תיקון" }).click()
  return { ctx, page, form: page.getByRole("dialog", { name: "בקשת הסרה או תיקון" }) }
}

/** A kept request, or its answer, waits in the card's row; the window opens when the visitor asks for it. */
async function reopen(page: Page) {
  await page.getByRole("button", { name: "בקשת הסרה או תיקון" }).click()
  return page.getByRole("dialog", { name: "בקשת הסרה או תיקון" })
}

/** The requests the server holds about a place, as the moderators' list has them. */
async function casesAbout(browser: Browser, id: string) {
  const mod = await browser.newContext()
  await mod.request.post("/__dev/login", { data: { email: "dev@example.test" } })
  const { items } = (await (await mod.request.get("/api/admin/reports")).json()) as { items: { place_id: string }[] }
  await mod.close()
  return items.filter((r) => r.place_id === id).length
}

/** A store that refuses (to open, and to read or write) while the tab's `idb-refuses` flag is set, as a blocked one does. */
async function refusingStore(ctx: BrowserContext) {
  await ctx.addInitScript(() => {
    const refuses = () => !!sessionStorage.getItem("idb-refuses")
    const open = IDBFactory.prototype.open
    IDBFactory.prototype.open = function (this: IDBFactory, ...args: Parameters<IDBFactory["open"]>) {
      if (refuses()) throw new DOMException("blocked", "SecurityError")
      return open.apply(this, args)
    }
    const transaction = IDBDatabase.prototype.transaction
    IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args: Parameters<IDBDatabase["transaction"]>) {
      if (refuses()) throw new DOMException("blocked", "InvalidStateError")
      return transaction.apply(this, args)
    }
  })
}
const refuse = (page: Page, on: boolean) =>
  page.evaluate((v) => (v ? sessionStorage.setItem("idb-refuses", "1") : sessionStorage.removeItem("idb-refuses")), on)

/** Each request the page sends, by its key and body (the browser check's token is fresh each time, so it isn't compared). */
function recordReports(page: Page, first: (route: Route, headers: Record<string, string>) => Promise<void>) {
  const sent: { key: string; body: string }[] = []
  void page.route("**/api/v1/reports", async (route) => {
    sent.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() ?? "" })
    const headers = from(route, page.context())
    return sent.length === 1 ? first(route, headers) : route.continue({ headers })
  })
  return sent
}

test("a family member asks from the place card: the name is hidden for now, and the answer says it is no decision", async ({
  browser,
  request,
}) => {
  const name = `גן דמו לבקשה מהכרטיס ${Date.now()}`
  const { id } = await published(browser, name)
  const { ctx, form } = await requestForm(browser, id, name)
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
  await expect(form.getByRole("status")).toHaveText(HIDDEN, DAY)
  await expect.poll(async () => (await inFeed(request, id))?.name_he).toBe("גן זיכרון")
  await ctx.close()
})

test("a request about one of the site's own places: received, and the answer says nothing is hidden before the review", async ({
  browser,
}) => {
  const { ctx, form } = await requestForm(browser, "nova-memorial-reim", /נובה/)
  await form.getByRole("checkbox", { name: "הסיפור" }).check()
  await form.getByRole("radio", { name: /^אחר/ }).check()
  await form.getByLabel("מה לבדוק, ולמה").fill("יש טעות בתאריך שמופיע בתיאור של המקום הזה.")
  await form.getByRole("button", { name: "שליחת הבקשה" }).click()
  await expect(form.getByRole("status")).toHaveText(RECEIVED_CURATED, DAY)
  await ctx.close()
})

test("a request whose answer was lost says so without claiming it arrived, and sending it again opens no second request", async ({
  browser,
}) => {
  const name = `גן דמו לבקשה שאבדה ${Date.now()}`
  const { id } = await published(browser, name)
  const { ctx, page, form } = await requestForm(browser, id, name)
  // The first reaches the server, and its answer never comes back.
  const sent = recordReports(page, async (route, headers) => {
    await route.fetch({ headers })
    await route.abort("failed")
  })
  await form.getByRole("checkbox", { name: "השם" }).check()
  await form.getByRole("radio", { name: /^אחר/ }).check()
  await form.getByLabel("מה לבדוק, ולמה").fill("השם כאן כתוב בשגיאה, כדאי לבדוק מול אתר המועצה.")
  await form.getByRole("button", { name: "שליחת הבקשה" }).click()
  await expect(form.getByRole("alert")).toHaveText(/לא ברור אם הבקשה הגיעה אלינו/, DAY)
  // Sent again as it was: the form can't be changed in between.
  await expect(form.getByLabel("מה לבדוק, ולמה")).toBeDisabled()
  await form.getByRole("button", { name: "שליחה שוב" }).click()
  await expect(form.getByRole("status")).toHaveText(RECEIVED, DAY)
  expect(sent).toHaveLength(2)
  expect(sent[1]).toEqual(sent[0])
  expect(await casesAbout(browser, id)).toBe(1)
  await ctx.close()
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
  // The first reaches the server and is stored there; what comes back is a server error whose body is JSON null.
  const sent = recordReports(page, async (route, headers) => {
    await route.fetch({ headers })
    await route.fulfill({ status: 500, contentType: "application/json", body: "null" })
  })
  const why = "השם כתוב כאן בטעות, כך כתוב באתר המועצה. כדאי לבדוק."
  await form.getByRole("checkbox", { name: "השם" }).check()
  await form.getByRole("radio", { name: /^אחר/ }).check()
  await form.getByLabel("מה לבדוק, ולמה").fill(why)
  await form.getByRole("button", { name: "שליחת הבקשה" }).click()
  await expect(form.getByRole("alert")).toHaveText(/לא ברור אם הבקשה הגיעה אלינו/, DAY)
  await expect(form.getByLabel("מה לבדוק, ולמה")).toBeDisabled()
  // Free for another try, not stuck mid-send.
  await expect(form.getByRole("button", { name: "שליחה שוב" })).toBeEnabled()

  await page.reload()
  await expect(page.getByRole("heading", { name })).toBeVisible(DAY)
  const back = await reopen(page)
  await expect(back.getByRole("alert")).toHaveText(/עוד לא אושרה כמתקבלת/, DAY)
  await expect(back.getByLabel("מה לבדוק, ולמה")).toHaveValue(why)
  await expect(back.getByLabel("מה לבדוק, ולמה")).toBeDisabled()
  await expect(back.getByRole("checkbox", { name: "השם" })).toBeChecked()
  await back.getByRole("button", { name: "שליחה שוב" }).click()
  await expect(back.getByRole("status")).toHaveText(RECEIVED, DAY)
  expect(sent).toHaveLength(2)
  expect(sent[1]).toEqual(sent[0])
  expect(await casesAbout(browser, id)).toBe(1)

  // Settled, so it is let go: the next visit finds an empty form.
  await page.reload()
  await expect(page.getByRole("heading", { name })).toBeVisible(DAY)
  await expect(page.getByRole("button", { name: "בקשת הסרה או תיקון" })).toBeVisible()
  await expect(page.getByRole("dialog", { name: "בקשת הסרה או תיקון" })).toHaveCount(0)
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
  const sent = recordReports(page, async (route, headers) => {
    await route.fetch({ headers })
    await route.abort("failed")
  })
  const why = "בסיפור של המקום יש פרט שגוי על התאריך שבו הוקם."
  await form.getByRole("checkbox", { name: "השם" }).check()
  await form.getByRole("radio", { name: /^אחר/ }).check()
  await form.getByLabel("מה לבדוק, ולמה").fill(why)
  await form.getByRole("button", { name: "שליחת הבקשה" }).click()
  await expect(form.getByRole("alert")).toHaveText(/לא ברור אם הבקשה הגיעה אלינו/, DAY)

  await page.evaluate((p) => (location.hash = `#/place/${p}`), other)
  await expect(page.getByRole("heading", { name: two })).toBeVisible()
  await expect(page.getByRole("dialog", { name: "בקשת הסרה או תיקון" })).toHaveCount(0)
  await page.getByRole("button", { name: "בקשת הסרה או תיקון" }).click()
  const second = page.getByRole("dialog", { name: "בקשת הסרה או תיקון" })
  await expect(second.getByLabel("מה לבדוק, ולמה")).toHaveValue("")
  await expect(second.getByLabel("מה לבדוק, ולמה")).toBeEnabled()
  await expect(second.getByRole("alert")).toHaveCount(0)

  await page.evaluate((p) => (location.hash = `#/place/${p}`), id)
  await expect(page.getByRole("heading", { name: one })).toBeVisible()
  // The other card is gone (it animates out), so only this one's form is on the page.
  await expect(page.getByRole("heading", { name: two })).toHaveCount(0)
  const first = await reopen(page)
  await expect(first.getByLabel("מה לבדוק, ולמה")).toHaveValue(why)
  await expect(first.getByLabel("מה לבדוק, ולמה")).toBeDisabled()
  await first.getByRole("button", { name: "שליחה שוב" }).click()
  await expect(first.getByRole("status")).toHaveText(RECEIVED, DAY)
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

test("a browser that keeps nothing still holds the request in the open page: another place's card and back, it is there, and it says a reload loses it", async ({
  browser,
}) => {
  const one = `גן דמו בלי אחסון ${Date.now()}`
  const two = `גן דמו שני בלי אחסון ${Date.now()}`
  const { id } = await published(browser, one)
  const { id: other } = await published(browser, two)
  const ctx = await visitor(browser)
  await ctx.addInitScript(() => Object.defineProperty(window, "indexedDB", { value: undefined }))
  const page = await ctx.newPage()
  await page.goto(`/#/place/${id}`)
  await expect(page.getByRole("heading", { name: one })).toBeVisible(DAY)
  await page.getByRole("button", { name: "בקשת הסרה או תיקון" }).click()
  const form = page.getByRole("dialog", { name: "בקשת הסרה או תיקון" })
  const sent = recordReports(page, async (route, headers) => {
    await route.fetch({ headers })
    await route.abort("failed")
  })
  const why = "התאריך בסיפור של המקום לא נכון, כדאי לבדוק מול המועצה."
  await form.getByRole("checkbox", { name: "השם" }).check()
  await form.getByRole("radio", { name: /^אחר/ }).check()
  await form.getByLabel("מה לבדוק, ולמה").fill(why)
  await form.getByRole("button", { name: "שליחת הבקשה" }).click()
  await expect(form.getByRole("alert")).toHaveText(/לא ברור אם הבקשה הגיעה אלינו.*נשמרת רק בדף הפתוח/, DAY)

  // Another place's card, then no card at all, so the first card is gone from the page before it opens again.
  await page.evaluate((p) => (location.hash = `#/place/${p}`), other)
  await expect(page.getByRole("heading", { name: two })).toBeVisible()
  await page.evaluate(() => (location.hash = "#/"))
  await expect(page.getByRole("heading", { name: two })).toHaveCount(0)
  await expect(page.getByRole("heading", { name: one })).toHaveCount(0)
  await page.evaluate((p) => (location.hash = `#/place/${p}`), id)
  await expect(page.getByRole("heading", { name: one })).toBeVisible()
  const back = await reopen(page)
  await expect(back.getByLabel("מה לבדוק, ולמה")).toHaveValue(why)
  await expect(back.getByLabel("מה לבדוק, ולמה")).toBeDisabled()
  await back.getByRole("button", { name: "שליחה שוב" }).click()
  await expect(back.getByRole("status")).toHaveText(RECEIVED, DAY)
  expect(sent).toHaveLength(2)
  expect(sent[1]).toEqual(sent[0])
  expect(await casesAbout(browser, id)).toBe(1)
  await ctx.close()
})

test("a family's request that hides the whole place and loses its answer stays recoverable after the card closes and the page reloads, under its first key, showing nothing of the place", async ({
  browser,
}) => {
  const name = `גן דמו שהוסתר בבקשה ${Date.now()}`
  const { id } = await published(browser, name)
  // A week on (the dev server's test clock), so the site-wide hourly and daily quotas the other tests used up don't
  // stop this request's precaution: those safeguards are tested in the Worker's own tests.
  const later = { "x-test-now": new Date(Date.now() + 7 * 86_400_000).toISOString() }
  const { ctx, page, form } = await requestForm(browser, id, name, later)
  const sent = recordReports(page, async (route, headers) => {
    await route.fetch({ headers })
    await route.abort("failed")
  })
  await form.getByRole("checkbox", { name: "המקום כולו" }).check()
  await form.getByRole("radio", { name: "בן או בת משפחה" }).check()
  // Complete (a family member says how), so the automatic precaution may act on it.
  await form.getByLabel(/^הקשר שלכם/).fill("אח")
  await form.getByLabel("מה לבדוק, ולמה").fill("המקום כולו מנציח את אחי בלי שהמשפחה נשאלה. נבקש להסתיר אותו עד שנדבר.")
  await form.getByRole("button", { name: "שליחת הבקשה" }).click()
  await expect(form.getByRole("alert")).toHaveText(/לא ברור אם הבקשה הגיעה אלינו/, DAY)

  // The request hid the place; the next feed closes its card.
  const fed = page.waitForResponse((r) => r.url().includes("/api/v1/feed?") && r.status() === 200)
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
  await fed
  await expect(page.getByText("המקום הזה אינו מוצג כרגע")).toBeVisible()
  await expect(page.getByRole("heading", { name })).toHaveCount(0)
  await expect(page.getByRole("region", { name: "בקשה ששלחתם" })).toBeVisible()

  // A new load of the page (a query, so it isn't only a hash change).
  await page.goto(`/?again=1#/place/${id}`)
  const pending = page.getByRole("region", { name: "בקשה ששלחתם" })
  await expect(pending).toBeVisible(DAY)
  await expect(pending.getByRole("alert")).toHaveText(/על מקום שאינו מוצג כרגע/, DAY)
  await expect(page.getByText(name)).toHaveCount(0)
  await pending.getByRole("button", { name: "שליחה שוב" }).click()
  // The server's answer to the second try: on main's first CI run it was still out after 5 s (both buttons disabled).
  await expect(pending.getByRole("status")).toHaveText(HIDDEN, DAY)
  expect(sent).toHaveLength(2)
  expect(sent[1]).toEqual(sent[0])
  expect(await casesAbout(browser, id)).toBe(1)
  await pending.getByRole("button", { name: "סגירה" }).click()
  await expect(pending).toHaveCount(0)
  await ctx.close()
})

test("a card closed and opened while its request is out finds that same request, locked, and the try's answer reaches it: no second request, no removal mid-send", async ({
  browser,
}) => {
  const name = `גן דמו לבקשה בדרך ${Date.now()}`
  const { id } = await published(browser, name)
  // This test watches the request while it is out, not the client's own 10 s report timeout (src/lib/api.ts, the only
  // 10 s deadline there): on a slow runner closing and reopening the card alone outlasted it (CI 37630978452, 11.7 s),
  // and the form then showed the recoverable failure instead. So in this test's context that one deadline is 60 s,
  // which keeps the pending state apart from the navigation's speed; every other deadline is the native one. The
  // normal 10 s timeout isn't what this test checks.
  const { ctx, page, form } = await requestForm(browser, id, name, {}, () => {
    const native = AbortSignal.timeout
    const extended: number[] = []
    Object.assign(window, { __extendedDeadlines: extended })
    AbortSignal.timeout = function (this: typeof AbortSignal, ms: number) {
      if (ms !== 10_000) return native.call(this, ms)
      extended.push(60_000)
      return native.call(this, 60_000)
    }
  })
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  // The first reaches the server, and its answer waits until the card has been closed and opened again; then it is lost.
  const sent = recordReports(page, async (route, headers) => {
    await route.fetch({ headers })
    await held
    await route.abort("failed")
  })
  const why = "בתיאור כתוב שהספסל הוקם בשנה אחרת. כדאי לבדוק מול המועצה."
  await form.getByRole("checkbox", { name: "השם" }).check()
  await form.getByRole("radio", { name: /^אחר/ }).check()
  await form.getByLabel("מה לבדוק, ולמה").fill(why)
  await form.getByRole("button", { name: "שליחת הבקשה" }).click()
  await expect.poll(() => sent.length).toBe(1)
  // The report request, and only it, took the extended deadline.
  expect(await page.evaluate(() => (window as unknown as { __extendedDeadlines: number[] }).__extendedDeadlines)).toEqual([60_000])

  // The window is modal: the card closes only once it has.
  await page.keyboard.press("Escape")
  await expect(form).toBeHidden()
  await page.evaluate(() => (location.hash = "#/"))
  await expect(page.getByRole("heading", { name })).toHaveCount(0)
  await page.evaluate((p) => (location.hash = `#/place/${p}`), id)
  await expect(page.getByRole("heading", { name })).toBeVisible()
  const again = await reopen(page)
  await expect(again.getByLabel("מה לבדוק, ולמה")).toHaveValue(why)
  // The three locked controls are read together, in one round trip: the request is out only until the client's own
  // 10 s timeout (src/lib/api.ts), and on a slow runner each separate check cost seconds of it (CI 37615772991). All
  // three must be there and disabled; a missing one fails.
  const locked = again
    .getByLabel("מה לבדוק, ולמה")
    .or(again.getByRole("button", { name: "שליחה שוב" }))
    .or(again.getByRole("button", { name: "הסרה מהמכשיר הזה" }))
  await expect
    .poll(() =>
      locked.evaluateAll((els) =>
        els
          .map((e) => ({
            control: e instanceof HTMLTextAreaElement ? "why" : (e.textContent ?? "").trim(),
            // As toBeDisabled reads it: disabled itself or by its fieldset (:disabled), or marked aria-disabled.
            disabled: e.matches(":disabled") || e.getAttribute("aria-disabled") === "true",
          }))
          .sort((a, b) => a.control.localeCompare(b.control)),
      ),
    )
    .toEqual(
      [
        { control: "why", disabled: true },
        { control: "שליחה שוב", disabled: true },
        { control: "הסרה מהמכשיר הזה", disabled: true },
      ].sort((a, b) => a.control.localeCompare(b.control)),
    )

  release()
  await expect(again.getByRole("alert")).toHaveText(/לא ברור אם הבקשה הגיעה אלינו/, DAY)
  await again.getByRole("button", { name: "שליחה שוב" }).click()
  await expect(again.getByRole("status")).toHaveText(RECEIVED, DAY)
  expect(sent).toHaveLength(2)
  expect(sent[1]).toEqual(sent[0])
  expect(await casesAbout(browser, id)).toBe(1)
  await ctx.close()
})

test("a request about a hidden place, in a browser whose store can't be read after a reload: the page says it couldn't check, without anything of the place, and checking again once it can brings back the original request", async ({
  browser,
}) => {
  const name = `גן דמו לבקשה שלא נקראה ${Date.now()}`
  const { id } = await published(browser, name)
  // Nine days on, clear of the quotas the other tests used (see the hidden-place test above).
  const later = { "x-test-now": new Date(Date.now() + 9 * 86_400_000).toISOString() }
  const { ctx, page, form } = await requestForm(browser, id, name, later)
  await refusingStore(ctx)
  const sent = recordReports(page, async (route, headers) => {
    await route.fetch({ headers })
    await route.abort("failed")
  })
  await form.getByRole("checkbox", { name: "המקום כולו" }).check()
  await form.getByRole("radio", { name: "בן או בת משפחה" }).check()
  await form.getByLabel(/^הקשר שלכם/).fill("אחות")
  await form.getByLabel("מה לבדוק, ולמה").fill("המקום מנציח את אמא שלנו, והמשפחה לא נשאלה. נבקש להסתיר אותו עד שנדבר.")
  await form.getByRole("button", { name: "שליחת הבקשה" }).click()
  await expect(form.getByRole("alert")).toHaveText(/לא ברור אם הבקשה הגיעה אלינו/, DAY)

  await refuse(page, true)
  await page.goto(`/?unread=1#/place/${id}`)
  const box = page.getByRole("region", { name: "בקשה ששלחתם" })
  await expect(box.getByRole("alert")).toHaveText(/לא הצלחנו לבדוק/, DAY)
  await expect(page.getByText(name)).toHaveCount(0)

  await refuse(page, false)
  await box.getByRole("button", { name: "לבדוק שוב" }).click()
  await expect(box.getByRole("alert")).toHaveText(/על מקום שאינו מוצג כרגע/, DAY)
  await expect(page.getByText(/לא הצלחנו לבדוק/)).toHaveCount(0)
  await expect(page.getByText(name)).toHaveCount(0)
  await box.getByRole("button", { name: "שליחה שוב" }).click()
  await expect(box.getByRole("status")).toHaveText(HIDDEN, DAY)
  expect(sent).toHaveLength(2)
  expect(sent[1]).toEqual(sent[0])
  expect(await casesAbout(browser, id)).toBe(1)
  await ctx.close()
})

test("an answer that comes while the card is closed is there when it opens again, with no request sent again", async ({ browser }) => {
  const name = `גן דמו לתשובה בזמן שהכרטיס סגור ${Date.now()}`
  const { id } = await published(browser, name)
  const { ctx, page, form } = await requestForm(browser, id, name)
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  // The first goes through, and its answer is held until the card is closed.
  const sent = recordReports(page, async (route, headers) => {
    const answer = await route.fetch({ headers })
    await held
    await route.fulfill({ response: answer })
  })
  await form.getByRole("checkbox", { name: "השם" }).check()
  await form.getByRole("radio", { name: /^אחר/ }).check()
  await form.getByLabel("מה לבדוק, ולמה").fill("השם של המקום כתוב באיות אחר מזה שבשלט. כדאי לבדוק.")
  await form.getByRole("button", { name: "שליחת הבקשה" }).click()
  await expect.poll(() => sent.length).toBe(1)
  // The window is modal: the card closes only once it has.
  await page.keyboard.press("Escape")
  await expect(form).toBeHidden()
  await page.evaluate(() => (location.hash = "#/"))
  await expect(page.getByRole("heading", { name })).toHaveCount(0)
  const answered = page.waitForResponse((r) => r.url().endsWith("/api/v1/reports"))
  release()
  await answered
  await page.evaluate((p) => (location.hash = `#/place/${p}`), id)
  await expect(page.getByRole("heading", { name })).toBeVisible()
  await expect((await reopen(page)).getByRole("status")).toHaveText(RECEIVED)
  expect(sent).toHaveLength(1)
  expect(await casesAbout(browser, id)).toBe(1)
  await ctx.close()
})

test("a card open over a store that couldn't be read takes up its request once the page reads it again, locked, as it was sent", async ({
  browser,
}) => {
  const name = `גן דמו לכרטיס שנקרא שוב ${Date.now()}`
  const { id } = await published(browser, name)
  const { ctx, page, form } = await requestForm(browser, id, name)
  await refusingStore(ctx)
  const sent = recordReports(page, async (route, headers) => {
    await route.fetch({ headers })
    await route.abort("failed")
  })
  const why = "התמונה במקום הזה היא של אתר אחר, כדאי לבדוק."
  await form.getByRole("checkbox", { name: "השם" }).check()
  await form.getByRole("radio", { name: /^אחר/ }).check()
  await form.getByLabel("מה לבדוק, ולמה").fill(why)
  await form.getByRole("button", { name: "שליחת הבקשה" }).click()
  await expect(form.getByRole("alert")).toHaveText(/לא ברור אם הבקשה הגיעה אלינו/, DAY)

  await refuse(page, true)
  await page.goto(`/?again=1#/place/${id}`)
  await expect(page.getByRole("heading", { name })).toBeVisible(DAY)
  const box = page.getByRole("region", { name: "בקשה ששלחתם" })
  await expect(box.getByRole("alert")).toHaveText(/לא הצלחנו לבדוק/, DAY)
  await refuse(page, false)
  await box.getByRole("button", { name: "לבדוק שוב" }).click()
  // The card, open all along, now shows the request it couldn't read: not a new form.
  const card = await reopen(page)
  await expect(card.getByLabel("מה לבדוק, ולמה")).toHaveValue(why)
  await expect(card.getByLabel("מה לבדוק, ולמה")).toBeDisabled()
  await card.getByRole("button", { name: "שליחה שוב" }).click()
  await expect(card.getByRole("status")).toHaveText(RECEIVED, DAY)
  expect(sent).toHaveLength(2)
  expect(sent[1]).toEqual(sent[0])
  expect(await casesAbout(browser, id)).toBe(1)
  await ctx.close()
})

test("a first try refused before anything was stored, whose copy the browser won't remove, stays the only request: no new one in its place, and after a reload it goes as it was, one case", async ({
  browser,
}) => {
  const name = `גן דמו לסירוב שלא נמחק ${Date.now()}`
  const { id } = await published(browser, name)
  const { ctx, page, form } = await requestForm(browser, id, name)
  await refusingStore(ctx)
  // The store's stand-in applies from the next load.
  await page.reload()
  await expect(page.getByRole("heading", { name })).toBeVisible(DAY)
  await page.getByRole("button", { name: "בקשת הסרה או תיקון" }).click()
  // Refused at the door (nothing reaches the server), and by then the store refuses to remove the copy.
  const sent = recordReports(page, async (route) => {
    await refuse(page, true)
    await route.fulfill({ status: 403, json: { code: "turnstile_failed" } })
  })
  const why = "יש כאן טעות בשם המקום, כדאי לבדוק מול השלט."
  await form.getByRole("checkbox", { name: "השם" }).check()
  await form.getByRole("radio", { name: /^אחר/ }).check()
  await form.getByLabel("מה לבדוק, ולמה").fill(why)
  await form.getByRole("button", { name: "שליחת הבקשה" }).click()
  await expect(form.getByRole("alert")).toHaveText(/בדיקת הדפדפן לא עברה.*עוד אי אפשר לכתוב במקומה בקשה חדשה/, DAY)
  await expect(form.getByLabel("מה לבדוק, ולמה")).toHaveValue(why)
  await expect(form.getByLabel("מה לבדוק, ולמה")).toBeDisabled()
  await expect(form.getByRole("button", { name: "שליחת הבקשה" })).toHaveCount(0)

  await refuse(page, false)
  await page.reload()
  await expect(page.getByRole("heading", { name })).toBeVisible(DAY)
  const back = await reopen(page)
  await expect(back.getByLabel("מה לבדוק, ולמה")).toHaveValue(why)
  await back.getByRole("button", { name: "שליחה שוב" }).click()
  await expect(back.getByRole("status")).toHaveText(RECEIVED, DAY)
  expect(sent).toHaveLength(2)
  expect(sent[1]).toEqual(sent[0])
  expect(await casesAbout(browser, id)).toBe(1)
  await ctx.close()
})
