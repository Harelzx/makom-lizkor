import { devices, expect, test } from "./fixtures"

// The phone layout: a bottom sheet that is always open and never modal, under a row of map buttons.
test.use({ ...devices["Pixel 7"], viewport: { width: 390, height: 844 } })

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "דילוג" }).click()
  await page.locator("[data-vaul-drawer]").waitFor()
  await page.waitForTimeout(1500)
})

test("the sheet leaves the header and the map reachable for screen readers and keyboards", async ({ page }) => {
  await expect(page.getByRole("button", { name: "חיפוש", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "על הפרויקט" })).toBeVisible()
  await expect(page.locator("[data-aria-hidden]")).toHaveCount(0)
  // not modal, and still not dismissible: a tap on the map leaves the sheet where it is
  await page.mouse.click(195, 200)
  await expect(page.locator("[data-vaul-drawer]")).toBeVisible()
  await page.getByRole("button", { name: "חיפוש", exact: true }).click()
  await expect(page.getByRole("dialog").getByPlaceholder(/./)).toBeVisible()
})

test("after the add dialog closes, the page still answers taps", async ({ page }) => {
  await page.getByRole("button", { name: "הוספת מקום", exact: true }).click()
  await expect(page.getByRole("dialog", { name: /איפה המקום/ })).toBeVisible()
  // the dialog listens for Esc once it has taken focus
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true)
  await page.keyboard.press("Escape")
  await expect(page.locator("[data-vaul-drawer]")).toBeVisible()
  await page.waitForTimeout(800)
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).pointerEvents)).not.toBe("none")
  await page.locator('header button[aria-label="על הפרויקט"]').click({ timeout: 3000 })
  await expect(page.getByRole("dialog")).toBeVisible()
})
