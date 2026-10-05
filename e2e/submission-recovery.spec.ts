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
    return route.fulfill({
      status: 400,
      contentType: "application/problem+json",
      body: JSON.stringify({ status: 400, code: "invalid_input" }),
    })
  })
  await fillAndSave(page, `ספסל דמו נדחה ${Date.now()}`)
  await expect(page.getByText("ההצעה לא התקבלה", { exact: false }).first()).toBeVisible()
  // A resend would first fetch a fresh Turnstile token (a few seconds), so give it time to show itself.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
  await page.waitForTimeout(8000)
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
  // The next visit sends it once the day begins, as the feed does: nothing reaches the network during the opening.
  const next = await ctx.newPage()
  await next.goto("/")
  await next.getByRole("button", { name: "דילוג", exact: true }).click()
  await expect.poll(() => queued(browser, name), { timeout: 20_000 }).toBe(1)
})

test("a full review queue stops the form politely, keeps the place, and waits before sending again", async ({ browser }) => {
  const page = await day(browser)
  let posts = 0
  await page.route("**/api/v1/submissions", (route) => {
    posts++
    return route.fulfill({
      status: 503,
      headers: { "Retry-After": "3600" },
      contentType: "application/problem+json",
      body: JSON.stringify({ status: 503, code: "queue_full" }),
    })
  })
  await fillAndSave(page, `ספסל דמו תור מלא ${Date.now()}`)
  await expect(page.getByText("יותר הצעות ממה שאפשר לבדוק", { exact: false }).first()).toBeVisible()
  // A resend would first fetch a fresh Turnstile token (a few seconds), so give it time to show itself.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
  await page.waitForTimeout(8000)
  expect(posts).toBe(1)
})
