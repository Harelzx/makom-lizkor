import { expect, test } from "@playwright/test"
import { published } from "./publish"

const DAY = { timeout: 20_000 }

test("a share page opens the site at its place, skipping the opening, under the usual address", async ({ page }) => {
  await page.goto("/place/car-wall-tkuma")
  await expect(page.getByRole("heading", { name: "קיר המכוניות ליד תקומה" })).toBeVisible(DAY)
  await expect(page.getByRole("button", { name: "עם צליל" })).toHaveCount(0)
  // The address becomes the hash route the rest of the site reads, so reload and Back work as for any card.
  await expect(page).toHaveURL(/\/#\/place\/car-wall-tkuma$/)
  await page.reload()
  await expect(page.getByRole("heading", { name: "קיר המכוניות ליד תקומה" })).toBeVisible(DAY)
  await page.getByRole("button", { name: "כל המקומות" }).click()
  await expect(page).toHaveURL(/\/#\/$/)
})

test("an approved contribution's share page opens its card before the feed answers", async ({ browser }) => {
  const name = `גינת דמו שיתוף ${Date.now()}`
  const { id } = await published(browser, name)
  const page = await (await browser.newContext()).newPage()
  // No feed at all: the card can only come from the fields the page carries.
  await page.route("**/api/v1/{version,feed}*", (route) => route.abort())
  await page.goto(`/place/${id}`)
  await expect(page.getByRole("heading", { name })).toBeVisible(DAY)
  await expect(page).toHaveURL(new RegExp(`/#/place/${id}$`))
})

test("the share button gives the share page's address, which link previews can read", async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] })
  const page = await ctx.newPage()
  await page.goto("/#/place/car-wall-tkuma")
  await page.getByRole("button", { name: "שיתוף" }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/^http:\/\/[^/]+\/place\/car-wall-tkuma$/)
})

test("a place taken back opens the overview, even where this browser's offline copy still has it", async ({ browser }) => {
  const name = `גינת דמו שנמשכה ${Date.now()}`
  const { id, trackingToken } = await published(browser, name)
  const page = await (await browser.newContext()).newPage()
  // Seen once, so the browser's offline copy of the feed holds it.
  const saved = page.waitForResponse((r) => r.url().includes("/api/v1/feed"))
  await page.goto(`/#/place/${id}`)
  await expect(page.getByRole("heading", { name })).toBeVisible(DAY)
  await saved
  await page.waitForTimeout(500)
  await page.request.post(`/api/v1/submissions/${id}/withdraw`, { headers: { Authorization: `Bearer ${trackingToken}` } })

  await page.route("**/api/v1/{version,feed}*", (route) => route.abort())
  const res = await page.goto(`/place/${id}`)
  expect(res!.status()).toBe(410)
  await expect(page).toHaveURL(/\/#\/$/)
  await expect(page.getByRole("heading", { name })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "עם צליל" })).toHaveCount(0)
  // Off the map and the list too, though the offline copy (the only feed this page has) still holds it; a search for
  // a place that is listed (the site's own) proves the search itself works.
  await page.getByRole("button", { name: /^חיפוש מקום/ }).click()
  const box = page.getByRole("dialog").getByRole("combobox")
  await box.fill("קיר המכוניות")
  await expect(page.getByRole("option", { name: /קיר המכוניות/ }).first()).toBeVisible(DAY)
  await box.fill(name)
  await page.waitForTimeout(500)
  await expect(page.getByRole("option", { name: new RegExp(name) })).toHaveCount(0)
})
