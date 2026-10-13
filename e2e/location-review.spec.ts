import { expect, test } from "./fixtures"
import { audit } from "./axe"

test.use({ reducedMotion: "reduce", geolocation: { latitude: 31.42, longitude: 34.51 }, permissions: ["geolocation"] })

for (const textSize of [100, 200])
  test(
    `GPS point review at ${textSize}% text exposes the pin and keeps the form while correcting it`,
    { tag: "@phone" },
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto("/#/place/car-wall-tkuma")
      await expect(page.getByRole("heading", { name: "קיר המכוניות ליד תקומה", exact: true })).toBeVisible({ timeout: 20000 })
      if (textSize === 200) await page.addStyleTag({ content: "html { font-size: 200% !important; }" })
      const writes: string[] = []
      page.on("request", (request) => {
        if (request.method() !== "GET" && new URL(request.url()).pathname.startsWith("/api/v1/submissions")) writes.push(request.method())
      })
      await page.getByRole("button", { name: "הוספת מקום", exact: true }).click()
      const form = page.getByRole("dialog")
      await form.getByRole("button", { name: "המיקום הנוכחי שלי", exact: true }).click()
      const review = page.getByRole("region", { name: "בחירת נקודה על המפה", exact: true })
      await expect(review).toBeVisible({ timeout: 15000 })
      await expect(form).toBeHidden()
      await expect(page.locator(".draft-pin")).toBeVisible()
      await test.info().attach(`point-review-${textSize}`, { body: await page.screenshot(), contentType: "image/png" })
      await expect
        .poll(() =>
          page.locator(".draft-pin").evaluate((el) => {
            const pin = el.getBoundingClientRect(),
              bar = document.querySelector('[aria-label="בחירת נקודה על המפה"]')!.getBoundingClientRect()
            return pin.left >= 0 && pin.right <= innerWidth && pin.top >= 0 && pin.bottom < bar.top
          }),
        )
        .toBe(true)
      await expect(review.getByRole("button", { name: "זה המקום", exact: true })).toBeInViewport({ ratio: 0.999 })
      if (textSize === 200) {
        const instructions = review.getByRole("group", { name: "הנחיות לבחירת הנקודה", exact: true })
        await expect.poll(() => instructions.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0)
        await instructions.press("ArrowDown")
        await expect(instructions).toBeFocused()
        await expect.poll(() => instructions.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
      }
      await audit(page)
      await review.getByRole("button", { name: "זה המקום", exact: true }).press("Enter")
      await expect(form.getByText("סומן מיקום", { exact: false })).toContainText("31.42000")
      await form.getByRole("button", { name: "המשך", exact: true }).click()
      await form.getByLabel("שם המקום", { exact: true }).fill("טיוטה שנשמרת בבדיקת הנקודה")
      await form.getByLabel("כמה מילים על המקום (לא חובה)", { exact: true }).fill("הפרטים צריכים להישאר בלי לשלוח הצעה")
      await form.getByRole("button", { name: "חזרה", exact: true }).click()
      const before = await form.getByText("סומן מיקום", { exact: false }).textContent()
      await form.getByRole("button", { name: "בדיקת הנקודה במפה", exact: true }).click()
      await expect(review).toBeVisible()
      const map = page.locator(".maplibregl-canvas")
      const size = await map.boundingBox()
      await map.click({ position: { x: size!.width / 2 + 60, y: size!.height / 2 - 60 } })
      await review.getByRole("button", { name: "זה המקום", exact: true }).click()
      await expect(form.getByText("סומן מיקום", { exact: false })).not.toHaveText(before!)
      await form.getByRole("button", { name: "המשך", exact: true }).click()
      await expect(form.getByLabel("שם המקום", { exact: true })).toHaveValue("טיוטה שנשמרת בבדיקת הנקודה")
      await expect(form.getByLabel("כמה מילים על המקום (לא חובה)", { exact: true })).toHaveValue("הפרטים צריכים להישאר בלי לשלוח הצעה")
      await test.info().attach(`preserved-form-${textSize}`, { body: await page.screenshot(), contentType: "image/png" })
      expect(writes).toEqual([])
    },
  )
