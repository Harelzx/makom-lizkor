import { expect, test } from "./fixtures"
import { audit } from "./axe"

// The phone layout gets its own file, so it can be set for the whole file. A phone's size and touch rather than a whole
// device profile, which would pin the browser to Chromium and keep this check out of the WebKit run.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

test("the map and the sheet on a phone", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "דילוג" }).click()
  await page.locator("[data-vaul-drawer]").waitFor()
  await page.waitForTimeout(1500)
  await audit(page)
  // nothing on the page is wider than the phone
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
