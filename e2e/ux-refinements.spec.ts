import { test, expect, type Page } from "./fixtures"
import { readFileSync } from "node:fs"
import { audit } from "./axe"
const demo = JSON.parse(readFileSync(new URL("../fixtures/ux-preview.json", import.meta.url), "utf8"))
test.use({ reducedMotion: "reduce", geolocation: { latitude: 31.42, longitude: 34.51 }, permissions: ["geolocation"] })
async function day(page: Page) {
  await page.route("**/api/v1/version", (r) => r.fulfill({ json: { v: "0.99999" } }))
  await page.route("**/api/v1/feed?*", (r) => r.fulfill({ json: { v: "0.99999", places: demo } }))
  await page.goto("/")
  await page.getByRole("button", { name: "דילוג", exact: true }).click()
  await page.getByRole("button", { name: "הוספת מקום", exact: true }).first().click()
}
for (const width of [320, 390, 1280])
  test(`whole header artwork at every step and a durable centered receipt at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await day(page)
    const f = page.locator('[role="dialog"][data-slot="dialog-content"]')
    const artwork = f.locator("[data-add-art]")
    async function artFits() {
      await expect(artwork).toHaveCount(1)
      await expect.poll(() => artwork.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)
      const rect = await artwork.boundingBox()
      const frame = await artwork.locator("..").boundingBox()
      expect(rect!.y).toBeGreaterThanOrEqual(frame!.y)
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(frame!.y + frame!.height)
      expect(rect!.x).toBeGreaterThanOrEqual(frame!.x)
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(frame!.x + frame!.width)
      expect(await artwork.evaluate((el) => getComputedStyle(el).objectFit)).toBe("contain")
    }
    await artFits()
    await f.getByRole("button", { name: "המיקום הנוכחי שלי", exact: true }).click()
    await expect(f.getByText("סומן מיקום", { exact: false })).toBeVisible()
    await f.getByRole("button", { name: "המשך", exact: true }).click()
    await artFits()
    await f.getByLabel("שם המקום", { exact: true }).fill("ספסל בדיקת אישור נגיש")
    await f.getByRole("button", { name: "המשך", exact: true }).click()
    await artFits()
    for (const box of await f.getByRole("checkbox").all()) await box.check()
    await page.route("**/api/v1/submissions", (r) =>
      r.fulfill({ status: 201, json: { id: "p_preview_receipt", trackingToken: "test_tracking_token" } }),
    )
    await f.getByRole("button", { name: "שליחה לבדיקה", exact: true }).click()
    const receipt = page.locator("[data-submission-result]")
    await expect(receipt.getByRole("heading", { name: "תודה שהוספתם מקום לזכור", exact: true })).toBeVisible()
    await expect(receipt).toContainText("עדיין לא פורסמה")
    await page.waitForTimeout(2000) // Explicitly checks the old timed-close regression, even for an immediate response.
    await expect(receipt).toBeVisible()
    const box = await receipt.boundingBox()
    expect(Math.abs(box!.y + box!.height / 2 - 422)).toBeLessThan(4)
    await expect(receipt.getByRole("button", { name: "לצפייה בהצעה", exact: true })).toBeInViewport({ ratio: 1 })
    await audit(page)
    await receipt.getByRole("button", { name: "לצפייה בהצעה", exact: true }).click()
    await page.getByRole("button", { name: "מחיקת העותק מהמכשיר", exact: true }).click()
    await page.getByRole("button", { name: "מחיקת העותק", exact: true }).click()
    const toast = page.locator("[data-sonner-toast]").filter({ hasText: "העותק נמחק מהמכשיר" })
    await expect(toast).toBeVisible()
    if (width < 600) {
      const notification = await toast.boundingBox()
      expect(notification!.y).toBeGreaterThan(844 * 0.3)
      expect(notification!.y + notification!.height).toBeLessThan(844 * 0.75)
      const dismiss = toast.getByRole("button", { name: "סגירת ההודעה", exact: true })
      const dismissRect = await dismiss.boundingBox()
      expect(dismissRect!.height).toBeGreaterThanOrEqual(44)
      const titleRect = await toast.locator("[data-title]").boundingBox()
      expect(titleRect!.x + titleRect!.width).toBeLessThanOrEqual(dismissRect!.x)
      await dismiss.click({ timeout: 5000 })
      await expect(toast).toBeHidden()
    }
  })
