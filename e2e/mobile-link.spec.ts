import { devices, expect, test, type Page } from "./fixtures"

test.use({ ...devices["Pixel 7"], viewport: { width: 390, height: 844 } })

async function readSharedPlace(page: Page) {
  await page.goto("/#/place/car-wall-tkuma")
  // First-load feed/UI readiness uses the same bounded budget as routing.spec.ts. The local dev trace
  // reached the real place's photo requests only near the original five-second heading deadline.
  await expect(page.getByRole("heading", { name: "קיר המכוניות ליד תקומה" })).toBeVisible({ timeout: 20_000 })
  // Measure in one browser call. Resolving a handle before boundingBox consumed the polling deadline on CI,
  // although its screencast already showed the raised sheet. Keep the same geometry and five-second assertion.
  const sheetTop = () =>
    page.evaluate(() => {
      const sheets = document.querySelectorAll("[data-vaul-drawer]")
      if (sheets.length !== 1) return 844
      const sheet = sheets[0]
      return sheet.getClientRects().length ? sheet.getBoundingClientRect().top : 844
    })
  await expect.poll(sheetTop).toBeLessThan(844 * 0.5)
  // The measurement must also distinguish a folded sheet from a readable one.
  await page.getByRole("button", { name: "חזרה למפה", exact: true }).click()
  await expect.poll(sheetTop).toBeGreaterThanOrEqual(844 * 0.5)
  await page.getByRole("button", { name: "לסיפור ולפרטי הביקור", exact: true }).click()
  await expect.poll(sheetTop).toBeLessThan(844 * 0.5)
}

test("on a phone, a shared link lifts the sheet so the place can be read", async ({ page }) => {
  await readSharedPlace(page)
})

test("a phone shared link waits for its real feed before checking sheet geometry", async ({ page }) => {
  let delayed = 0
  await page.route("**/api/v1/feed?*", async (route) => {
    const response = await route.fetch()
    await new Promise((resolve) => setTimeout(resolve, 6_000))
    await route.fulfill({ response })
    delayed++
  })
  await readSharedPlace(page)
  expect(delayed).toBe(1)
})
