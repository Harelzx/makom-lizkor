import { expect, test } from "./fixtures"

test("a shared link to a place opens that place and keeps its address", async ({ page }) => {
  await page.goto("/#/place/car-wall-tkuma")
  // A first load: the panel's code and the map arrive before the card (other specs give the day 20 s too).
  await expect(page.getByRole("heading", { name: "קיר המכוניות ליד תקומה" })).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(800)
  await expect(page).toHaveURL(/#\/place\/car-wall-tkuma$/)
  // the panel's own back button returns to the list and the overview address
  await page.getByRole("button", { name: "כל המקומות" }).click()
  await expect(page).toHaveURL(/#\/$/)
})
