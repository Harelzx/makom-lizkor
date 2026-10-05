import { expect, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test"

const DAY = { timeout: 20_000 }
const GEO: BrowserContextOptions = { geolocation: { latitude: 31.42, longitude: 34.49 }, permissions: ["geolocation"] }

async function submit(b: Browser, name: string): Promise<Page> {
  const page = await (await b.newContext(GEO)).newPage()
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
  await expect(dialog).toBeHidden({ timeout: 15_000 })
  await expect(page.getByText("נשלח לבדיקה, ויופיע לכולם אחרי אישור.")).toBeVisible()
  return page
}

async function queued(b: Browser, name: string) {
  const ctx = await b.newContext()
  await ctx.request.post("/__dev/login", { data: { email: "dev@example.test" } })
  const { items } = (await (await ctx.request.get("/api/admin/queue")).json()) as { items: { name_he: string }[] }
  return items.filter((i) => i.name_he === name).length
}

test("the sender follows a submission by its private link, from any browser, and withdraws it", async ({ browser }) => {
  test.setTimeout(90_000)
  const name = `ספסל דמו מעקב ${Date.now()}`
  const page = await submit(browser, name)

  // From the place's own card.
  await page.getByRole("button", { name: "מעקב אחרי ההצעה" }).click()
  const view = page.getByRole("dialog", { name: "מצב ההצעה" })
  await expect(view.getByText("ממתינה לבדיקה")).toBeVisible()
  await expect(view.getByText(name)).toBeVisible()
  const link = await view.getByLabel("קישור המעקב").inputValue()
  expect(link).toMatch(/#\/track\/p_[0-9A-Z]{26}\/[A-Za-z0-9_-]{22}$/)

  // The link opens the same view in a browser that never saw the place, and the token leaves the address bar.
  const other = await (await browser.newContext()).newPage()
  await other.goto(link.replace(/^https?:\/\/[^/]+/, ""))
  const there = other.getByRole("dialog", { name: "מצב ההצעה" })
  await expect(there.getByText("ממתינה לבדיקה")).toBeVisible(DAY)
  await expect(other).toHaveURL(/#\/$/)

  // Withdrawing asks first, then erases it: gone from the moderators' queue.
  await there.getByRole("button", { name: "משיכת ההצעה" }).click()
  await other.getByRole("alertdialog").getByRole("button", { name: "למשוך ולמחוק" }).click()
  await expect(there.getByText("נמשכה", { exact: false })).toBeVisible()
  expect(await queued(browser, name)).toBe(0)
})

test("a tracking link with a wrong token says nothing about the place", async ({ page }) => {
  await page.goto("/#/track/p_01ZZZZZZZZZZZZZZZZZZZZZZZZ/AAAAAAAAAAAAAAAAAAAAAA")
  await expect(page.getByRole("dialog", { name: "מצב ההצעה" }).getByText("לא מצאנו הצעה בקישור הזה")).toBeVisible(DAY)
})
