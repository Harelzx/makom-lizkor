import { expect, test } from "./fixtures"
import { openPlace, record } from "./frames"

const PANEL = 'aside[aria-label="מקומות וקהילות"]'

test.describe("desktop panel", () => {
  test("collapses and opens again without losing its rounded corners or jumping", async ({ page }) => {
    await openPlace(page)
    const viewport = page.viewportSize()!

    for (const name of [/כיווץ הרשימה/, /פתיחת הרשימה/]) {
      const frames = await record(page, PANEL, () => page.getByRole("button", { name }).click())
      expect(frames.length).toBeGreaterThan(20)
      // any frame with squared corners or a panel running off the screen is listed in full when this fails
      expect.soft(frames.filter((f) => f.radius <= 20 || f.y + f.h > viewport.height)).toEqual([])
      // a spring, not a snap: no single frame covers more than half the distance
      const travel = Math.abs(frames.at(-1)!.h - frames[0].h)
      const biggestStep = Math.max(...frames.slice(1).map((f, i) => Math.abs(f.h - frames[i].h)))
      expect.soft(biggestStep, "largest per-frame height change").toBeLessThan(travel / 2)
      expect(frames.at(-1)!.radius).toBeCloseTo(28, 0)
    }
  })
})

test.describe("desktop panel scroll", () => {
  const body = 'aside[aria-label="מקומות וקהילות"] .scroll-fade'

  test("a place opens at its top, and the list returns to where the reader left it", async ({ page }) => {
    await page.goto("/")
    await page.getByRole("button", { name: "דילוג" }).click()
    const list = page.locator(body)
    await list.waitFor()
    await page.waitForTimeout(1200)
    await list.evaluate((e) => (e.scrollTop = 900))
    await page.waitForTimeout(300)
    await page.locator(`${body} li button`).nth(14).click()
    await expect(page.getByRole("button", { name: "כל המקומות" })).toBeVisible()
    await expect.poll(() => list.evaluate((e) => e.scrollTop)).toBe(0)

    await page.getByRole("button", { name: "כל המקומות" }).click()
    await expect.poll(() => list.evaluate((e) => Math.round(e.scrollTop))).toBe(900)
  })
})

test.describe("desktop details", () => {
  test("opening the panel shows its content while it grows, not an empty sheet", async ({ page }) => {
    await openPlace(page)
    await page.getByRole("button", { name: /כיווץ הרשימה/ }).click()
    await page.waitForTimeout(900)
    const body = page.locator('aside[aria-label="מקומות וקהילות"] .scroll-fade')
    await page.getByRole("button", { name: /פתיחת הרשימה/ }).click()
    await page.waitForTimeout(150)
    expect(await body.evaluate((e) => +getComputedStyle(e).opacity)).toBeGreaterThan(0.3)
  })

  test("the return count plays once, not every time the tab comes back", async ({ page }) => {
    await page.goto("/")
    await page.getByRole("button", { name: "דילוג" }).click()
    await page.getByRole("tab", { name: "קהילות" }).click()
    const heading = page.getByRole("heading", { name: /מהמפונים כבר חזרו הביתה/ })
    await expect(heading).toContainText("90")
    await page.getByRole("tab", { name: "מקומות" }).click()
    await page.getByRole("tab", { name: "קהילות" }).click()
    await expect(heading).toContainText("90", { timeout: 100 })
  })

  test("a flower on the map opens its place", async ({ page }) => {
    await page.goto("/")
    await page.getByRole("button", { name: "דילוג" }).click()
    await page.getByRole("button", { name: "כל המקומות" }).waitFor({ state: "detached" })
    const flower = page.locator(".mk .mk-flower").first()
    await expect(flower).toBeAttached({ timeout: 15000 })
    const name = await flower.getAttribute("aria-label")
    await flower.dispatchEvent("click")
    // clicked during the sunrise, the place opens when the day view arrives (the sunrise takes 7 s)
    await expect(page.getByRole("heading", { name: name! })).toBeVisible({ timeout: 10_000 })
  })
})
