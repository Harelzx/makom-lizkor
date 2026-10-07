import { devices, expect, test } from "./fixtures"

test.use({ ...devices["Pixel 7"], viewport: { width: 390, height: 844 } })

test("on a phone, a shared link lifts the sheet so the place can be read", async ({ page }) => {
  await page.goto("/#/place/car-wall-tkuma")
  await expect(page.getByRole("heading", { name: "קיר המכוניות ליד תקומה" })).toBeAttached()
  await expect.poll(async () => (await page.locator("[data-vaul-drawer]").boundingBox())?.y ?? 844).toBeLessThan(844 * 0.5)
})
