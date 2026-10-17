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

test("a tap on a flower lifts the sheet to that place's story", async ({ page }) => {
  // A flower wholly on screen and on top where it is tapped (a neighbour or the sheet can cover one).
  const flower = page.locator(".mk-flower").filter({ visible: true })
  let point: { x: number; y: number } | null = null
  await expect
    .poll(async () => {
      point = await flower.evaluateAll((all) => {
        for (const f of all) {
          const r = f.getBoundingClientRect(),
            x = r.x + r.width / 2,
            y = r.y + r.height / 2
          if (y > 80 && y < 680 && x > 10 && x < 380 && document.elementFromPoint(x, y)?.closest(".mk-flower") === f) return { x, y }
        }
        return null
      })
      return point
    })
    .not.toBeNull()
  const sheet = page.locator("#places")
  const folded = (await sheet.boundingBox())!.y
  await page.mouse.click(point!.x, point!.y)
  await expect(page).toHaveURL(/#\/place\//)
  // lifted, every time: the lift used to be lost now and then, leaving the story folded away under the map
  await expect.poll(async () => (await sheet.boundingBox())!.y).toBeLessThan(folded - 300)
})
