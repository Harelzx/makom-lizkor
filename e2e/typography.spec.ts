import { test, expect } from "./fixtures"

test.use({ reducedMotion: "reduce" })
const DAY = { timeout: 20_000 }

test("the phone step indicator stays readable when text alone is doubled", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto("/")
  await page.getByRole("button", { name: "דילוג", exact: true }).click()
  await expect(page.locator("#places")).toBeVisible(DAY)
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" })
  await page.getByRole("button", { name: "הוספת מקום", exact: true }).click()
  const form = page.getByRole("dialog", { name: "איפה המקום?", exact: true })
  await expect(form).toBeVisible()
  const steps = form.getByRole("list", { name: "שלב 1 מתוך 3" })
  const fits = await steps.locator("li").evaluateAll((items) =>
    items.every((item) => {
      const bounds = item.getBoundingClientRect()
      return Array.from(item.children).every((child) => {
        const rect = child.getBoundingClientRect()
        return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1
      })
    }),
  )
  expect(fits, "step numbers and labels must stay within their own column").toBe(true)
  const footer = form.getByRole("button", { name: "המשך", exact: true })
  const box = await footer.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(320)
  expect(box!.y + box!.height).toBeLessThanOrEqual(844)
})

test("privacy copy reflows with the reader's text spacing on a narrow phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto("/")
  await page.getByRole("button", { name: "דילוג", exact: true }).click()
  await expect(page.locator("#places")).toBeVisible(DAY)
  await page.getByRole("button", { name: "על הפרויקט", exact: true }).click()
  const about = page.getByRole("dialog", { name: "על מקום לזכור", exact: true })
  await expect(about).toBeVisible()
  await about.getByRole("button", { name: "פרטיות", exact: true }).click()
  await page.addStyleTag({
    content:
      "* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }",
  })
  const copy = about.locator("#privacy [data-slot='accordion-content']")
  await expect(copy).toBeVisible()
  expect(await copy.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  expect(await about.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  await expect(about.getByRole("button", { name: "סגירה", exact: true })).toBeVisible()
})
