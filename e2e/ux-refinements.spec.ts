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
    async function artFits(src: string) {
      await expect(artwork).toHaveCount(1)
      await expect(artwork).toHaveAttribute("src", src)
      await expect.poll(() => artwork.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)
      // Read both boxes in one browser frame: the whole dialog can move as the next step changes its height.
      const fits = await artwork.evaluate((el) => {
        const rect = el.getBoundingClientRect()
        const frame = el.parentElement!.getBoundingClientRect()
        return (
          rect.y >= frame.y - 0.01 && rect.bottom <= frame.bottom + 0.01 && rect.x >= frame.x - 0.01 && rect.right <= frame.right + 0.01
        )
      })
      expect(fits).toBe(true)
      expect(await artwork.evaluate((el) => getComputedStyle(el).objectFit)).toBe("contain")
    }
    await artFits("/art/bud.webp")
    await f.getByRole("button", { name: "המיקום הנוכחי שלי", exact: true }).click()
    await page.getByRole("button", { name: "זה המקום", exact: true }).click({ timeout: 15_000 })
    await expect(f.getByText("סומן מיקום", { exact: false })).toBeVisible()
    await f.getByRole("button", { name: "המשך", exact: true }).click()
    await artFits("/art/anemone-watercolor.webp")
    await f.getByLabel("שם המקום", { exact: true }).fill("ספסל בדיקת אישור נגיש")
    await f.getByRole("button", { name: "המשך", exact: true }).click()
    await artFits("/art/bouquet.webp")
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
    const dismiss = toast.getByRole("button", { name: "סגירת ההודעה", exact: true })
    const dismissRect = await dismiss.boundingBox()
    // Chromium can report a 44px transformed box as 43.999998px.
    expect(dismissRect!.height).toBeGreaterThanOrEqual(44 - 0.01)
    const titleRect = await toast.locator("[data-title]").boundingBox()
    expect(titleRect!.x + titleRect!.width).toBeLessThanOrEqual(dismissRect!.x)
    if (width < 600) {
      const notification = await toast.boundingBox()
      expect(notification!.y).toBeGreaterThan(844 * 0.3)
      expect(notification!.y + notification!.height).toBeLessThan(844 * 0.75)
    }
    await dismiss.click({ timeout: 5000 })
    await expect(toast).toBeHidden()
  })
