import { test, expect, type Page } from "./fixtures"
import { audit } from "./axe"
test.use({ reducedMotion: "reduce" })
// The day phase and its lazy UI are separate. CI 38030128446 reached day while Shell was still rendering;
// one trace showed the control only after the default 5 s assertion had expired. Use the same bounded
// day-readiness budget as the other functional specs, without changing any feature assertion or retry.
const DAY = { timeout: 20_000 }
async function day(page: Page) {
  await page.goto("/")
  await page.getByRole("button", { name: "דילוג", exact: true }).click()
  await expect(page.getByRole("button", { name: "על הפרויקט", exact: true })).toBeVisible(DAY)
}
test("feedback waits for the lazy interface when its module arrives after the assertion default", async ({ page }) => {
  // Production chunks and the development module both use the real response; only arrival is delayed.
  // Opening/map behavior is not mocked. No real contact message or submission is sent.
  let delayed = 0
  await page.route(/\/(?:assets\/shell-[^/]+\.js|src\/components\/shell\.tsx)(?:\?.*)?$/, async (route) => {
    const response = await route.fetch()
    await new Promise((resolve) => setTimeout(resolve, 6_000))
    await route.fulfill({ response })
    delayed++
  })
  await day(page)
  expect(delayed).toBe(1)
  const form = await write(page)
  await expect(form.getByRole("button", { name: "שליחת הפנייה", exact: true })).toBeDisabled()
})
async function write(page: Page) {
  await page.getByRole("button", { name: "על הפרויקט", exact: true }).click()
  await page.getByRole("button", { name: "כתבו לנו", exact: true }).click()
  const form = page.getByRole("dialog", { name: "כתבו לנו", exact: true })
  await expect(form).toBeVisible()
  return form
}
test("groups support one open section, keyboard toggling and visible search results", async ({ page }) => {
  await day(page)
  if (page.viewportSize()!.width < 768) await page.getByRole("button", { name: "הצגת המקומות", exact: true }).click()
  const panel = page.locator("#places")
  const envelope = panel.getByRole("button", { name: /^עוטף עזה/ })
  const country = panel.getByRole("button", { name: /^המרכז והשרון/ })
  await expect(envelope).toHaveAttribute("aria-expanded", "true")
  await expect(country).toHaveAttribute("aria-expanded", "false")
  await country.press("Enter")
  await expect(country).toHaveAttribute("aria-expanded", "true")
  await expect(envelope).toHaveAttribute("aria-expanded", "false")
  await country.press("Enter")
  await expect(country).toHaveAttribute("aria-expanded", "false")
  await panel.getByRole("searchbox", { name: "חיפוש", exact: true }).fill("מצפה")
  await expect(panel.getByRole("button", { name: /מצפה עמית/ })).toBeVisible()
  await panel.getByRole("searchbox", { name: "חיפוש", exact: true }).fill("")
  await expect(country).toHaveAttribute("aria-expanded", "false")
  await audit(page)
})
test("About uses the project illustration and timeless copy, with a simple night tooltip", async ({ page }) => {
  await day(page)
  // Hover is tested on a desktop; phone users do not depend on hover to identify the control.
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByRole("button", { name: "מעבר למצב לילה", exact: true }).hover()
  await expect(page.getByRole("tooltip")).toHaveText("מצב לילה")
  await page.getByRole("button", { name: "על הפרויקט", exact: true }).click()
  const about = page.getByRole("dialog", { name: "על מקום לזכור", exact: true })
  await expect(about.getByText("איור למיזם", { exact: true })).toHaveCount(0)
  await expect(about.getByText(/כרגע במפה \d+ מקומות/)).toHaveCount(0)
  await expect(about.locator('img[src="/art/memorial-corner.webp"]')).toBeVisible()
  expect(
    await about.locator('img[src="/art/memorial-corner.webp"]').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
  ).toBe(true)
})
test("only the staging preview build names its protected actions and asks crawlers not to index it", async ({ page }) => {
  await day(page)
  const preview = process.env.VITE_PUBLIC_PREVIEW === "true"
  const robots = page.locator('meta[name="robots"][content="noindex, nofollow"]')
  await expect(robots).toHaveCount(preview ? 1 : 0)
  await page.getByRole("button", { name: "על הפרויקט", exact: true }).click()
  await expect(page.getByRole("link", { name: "כניסה לבדיקות", exact: true })).toHaveCount(preview ? 1 : 0)
  if (preview) await audit(page)
})
for (const width of [320, 390, 1280])
  test(`map attribution stays by the real bottom bar at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await day(page)
    const credit = page.locator(".maplibregl-ctrl-bottom-right .maplibregl-ctrl-attrib")
    const osm = credit.getByRole("link", { name: "© OpenStreetMap contributors", exact: true })
    // At every width the credit folds to its (i) five seconds after the map appears (OpenStreetMap's guidelines allow
    // it), and a tap opens the whole credit again, links and all.
    await expect(credit).toHaveClass(/maplibregl-compact(?!-show)/)
    await expect(credit).not.toHaveClass(/maplibregl-compact-show/, DAY)
    await expect(osm).toBeHidden()
    const button = credit.locator('summary[aria-label="קרדיטים למפה"]')
    await expect(button).toBeInViewport({ ratio: 1 })
    if (width < 768) {
      const box = await credit.boundingBox()
      const bar = await page.locator("[data-sheet-grip]").locator("..").boundingBox()
      expect(bar!.y - (box!.y + box!.height)).toBeGreaterThanOrEqual(0)
      expect(bar!.y - (box!.y + box!.height)).toBeLessThan(20)
      expect(box!.x + box!.width).toBeGreaterThan(width - 25)
    }
    await button.click()
    await expect(osm).toBeVisible()
    await expect(credit.getByRole("link", { name: "Terrain: Mapzen", exact: true })).toBeVisible()
    await expect(credit).toBeInViewport({ ratio: 1 })
    if (width >= 768) {
      // Beside the open list it sits by the exposed map; with the list folded, in the screen's own corner.
      await page.getByRole("button", { name: "כיווץ הרשימה, כדי לראות יותר מהמפה", exact: true }).click()
      await expect
        .poll(async () => {
          const rect = await credit.boundingBox()
          return rect!.x + rect!.width
        })
        .toBeGreaterThan(width - 25)
    }
  })

test("contact reports repeated failures, confirmed success and erases fields on close", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route("**/api/v1/contact", async (r) => {
    if (r.request().method() === "GET") return r.fulfill({ json: { enabled: true } })
    attempts++
    return r.fulfill(attempts < 3 ? { status: 503, json: { code: "mail_unavailable" } } : { status: 202, json: { accepted: true } })
  })
  let attempts = 0
  // Synthetic browser-check stand-in; no external email or CAPTCHA is sent by this test.
  await page.addInitScript(() => {
    const w = window as unknown as {
      turnstile: { render: (el: HTMLElement, options: Record<string, unknown>) => string; remove: () => void }
    }
    w.turnstile = {
      render: (_el: HTMLElement, options: Record<string, unknown>) => {
        queueMicrotask(() => (options.callback as (token: string) => void)("test-contact"))
        return "fake"
      },
      remove: () => {},
    }
  })
  await day(page)
  const form = await write(page)
  await form.getByLabel("כתובת אימייל לתשובה", { exact: true }).fill("synthetic@example.test")
  await form.getByLabel("מה תרצו לומר לנו?", { exact: true }).fill("בדיקת טופס בלבד")
  await form.getByRole("button", { name: "שליחת הפנייה", exact: true }).click()
  await expect(form.getByRole("alert")).toContainText("ניסיון 1:")
  await form.getByRole("button", { name: "ניסיון שליחה נוסף", exact: true }).click()
  await expect(form.getByRole("alert")).toContainText("ניסיון 2:")
  await expect(form.getByRole("alert")).toBeFocused()
  await audit(page)
  await form.getByRole("button", { name: "ניסיון שליחה נוסף", exact: true }).click()
  const receipt = page.getByRole("dialog", { name: "תודה שכתבתם לנו", exact: true })
  await expect(receipt).toBeVisible()
  expect(attempts).toBe(3)
  await receipt.getByRole("button", { name: "חזרה למפה", exact: true }).click()
  const again = await write(page)
  await expect(again.getByLabel("מה תרצו לומר לנו?", { exact: true })).toHaveValue("")
  await again.getByLabel("מה תרצו לומר לנו?", { exact: true }).fill("טיוטה שלא נשלחה")
  await again.getByRole("button", { name: "סגירה", exact: true }).click()
  const cleared = await write(page)
  await expect(cleared.getByLabel("מה תרצו לומר לנו?", { exact: true })).toHaveValue("")
})
test("unconfigured mail never offers sending or shows a fictitious success", async ({ page }) => {
  await day(page)
  const form = await write(page)
  await expect(form.getByText("השליחה מתוך האתר עדיין אינה פעילה.", { exact: false })).toBeVisible()
  await expect(form.getByRole("button", { name: "שליחת הפנייה", exact: true })).toBeDisabled()
  await audit(page)
})
test("a stalled bot script returns to an actionable contact form without sending", async ({ page }) => {
  await page.route("**/api/v1/contact", (r) => r.fulfill({ json: { enabled: true } }))
  // Leave just this synthetic SDK request pending. No Cloudflare challenge or email reaches the network.
  await page.route("**/turnstile/v0/api.js*", () => {})
  await day(page)
  const form = await write(page)
  await form.getByLabel("כתובת אימייל לתשובה", { exact: true }).fill("synthetic@example.test")
  await form.getByLabel("מה תרצו לומר לנו?", { exact: true }).fill("בדיקת המתנה בלבד")
  await page.clock.install()
  const script = page.waitForRequest("**/turnstile/v0/api.js*")
  await form.getByRole("button", { name: "שליחת הפנייה", exact: true }).click()
  await script
  await page.clock.fastForward(15_001)
  await expect(form.getByRole("alert")).toContainText("ההודעה לא נשלחה")
  await expect(form.getByRole("button", { name: "ניסיון שליחה נוסף", exact: true })).toBeEnabled()
  await expect(form.getByRole("button", { name: "סגירה", exact: true })).toBeEnabled()
  await expect(page.locator('script[src*="turnstile/v0/api.js"]')).toHaveCount(0)
})
