import { expect, test } from "@playwright/test"

test("a shared link to a place opens that place and keeps its address", async ({ page }) => {
  await page.goto("/#/place/car-wall-tkuma")
  await expect(page.getByRole("heading", { name: "קיר המכוניות ליד תקומה" })).toBeVisible()
  await page.waitForTimeout(800)
  await expect(page).toHaveURL(/#\/place\/car-wall-tkuma$/)
  // the panel's own back button returns to the list and the overview address
  await page.getByRole("button", { name: "כל המקומות" }).click()
  await expect(page).toHaveURL(/#\/$/)
})
